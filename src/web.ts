import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
} from 'discord.js';
import { FORMATS, PANEL_FORMATS, SEED_MODES, guildAllowed, type Format, type SeedMode } from './config.js';
import {
  getConfig,
  getMatch,
  getSeedMode,
  getRankSpread,
  getRanks,
  rankChannels,
  getScenarios,
  guildStats,
  leaderboard,
  listOpenMatches,
  matchHistory,
  playersInGuild,
  matchPlayers,
  getPlayer,
  purgeGuild,
  setConfig,
  setRankChannels,
  setRankRole,
  setRankSpread,
  setVoltaic,
  setRanks,
  setScenarios,
  seedPlayer,
  type Match,
  type Player,
  type Rank,
  type RankChannels,
} from './db.js';
import { panelMessage } from './embeds.js';
import { bandsInReach } from './rating.js';
import { searchScenarios, voltaicS5 } from './kovaaks.js';
import { PAGE } from './page.js';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';
const BASE_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.PORT ?? 3000);
const REDIRECT = `${BASE_URL}/callback`;
/** What the dashboard's invite link asks for, built from the flags rather than
 *  written as a number - the old hand-typed one asked for Stream (bit 9) where
 *  it meant ViewChannel (bit 10), and nothing noticed for months. */
const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  // A match runs in its own private thread: make it, talk in it, delete it.
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
].reduce((all, flag) => all | flag, 0n).toString();
const SESSION_MS = 12 * 60 * 60 * 1000;

interface Session {
  user: { id: string; username: string; global_name: string | null; avatar: string | null };
  /** guild ids this user may configure - the ONLY thing the API trusts. */
  guildIds: Set<string>;
  guilds: { id: string; name: string; icon: string | null }[];
  expires: number;
}

// ponytail: sessions in a Map, not a table - a restart signing admins out of a
// settings page is not worth a session store. Same for the oauth state set.
const sessions = new Map<string, Session>();
const states = new Set<string>();

function sessionOf(req: IncomingMessage) {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

async function discord<T>(path: string, accessToken: string): Promise<T | null> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

/** Makes the ladder real in Discord: a role per rank, named and coloured to
 *  match, created on first save and edited after. Deleting a rank deletes its
 *  role, so an old band can't linger on people forever. */
async function syncRankRolesToDiscord(guild: Guild, ranks: Rank[], orphaned: Rank[]) {
  for (const rank of ranks) {
    const color = Number.parseInt(rank.color.slice(1), 16);
    const existing = rank.discord_role_id ? guild.roles.cache.get(rank.discord_role_id) : null;
    if (existing) {
      if (existing.name !== rank.name || existing.color !== color || !existing.mentionable) {
        await existing.edit({ name: rank.name, color, mentionable: true }).catch(() => {});
      }
      continue;
    }
    const role = await guild.roles
      // mentionable, because the bot has no Mention Everyone permission and a
      // call has to be able to ping the bands it will admit.
      .create({ name: rank.name, color, hoist: true, mentionable: true })
      .catch(() => null);
    if (role) setRankRole(rank.id, role.id);
  }
  for (const gone of orphaned) {
    // an orphan can carry channels but no role, so this is no longer a given
    if (gone.discord_role_id) {
      await guild.roles.cache.get(gone.discord_role_id)?.delete().catch(() => {});
    }
  }
}

const VOLTAIC_TTL_MS = 24 * 60 * 60 * 1000;

/** Tops up Voltaic standings that have gone stale.
 *  ponytail: bounded to a handful per request - a benchmark rank moves maybe
 *  once a month, so a big server catches up over a few page loads instead of
 *  making one of them wait on two hundred lookups. Raise the slice, or move it
 *  onto the tick loop, if that ever feels slow. */
async function refreshVoltaic(players: Player[]) {
  const stale = players
    .filter((p) => p.steam_id && Date.now() - (p.voltaic_at ?? 0) > VOLTAIC_TTL_MS)
    .slice(0, 8);
  // Bounded in wall time as well as count: eight lookups that each time out
  // would hold the dashboard for sixteen seconds. Whatever misses the budget
  // still lands in the database and shows up on the next load.
  await Promise.race([
    Promise.all(
      stale.map(async (p) => {
        const got = await voltaicS5(p.steam_id!);
        setVoltaic(p.discord_id, got);
        p.voltaic = got ? JSON.stringify(got) : null;
      }),
    ),
    new Promise((done) => setTimeout(done, 2500).unref()),
  ]);
}

function readVoltaic(raw: string | null) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** A slug Discord will accept: lowercase, no spaces, no punctuation. */
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'rank';

/** Mirrors the ladder into Discord as a category per rank holding a channel per
 *  format plus a results channel.
 *
 *  The ladder is the single source of truth, so this is the same contract as
 *  the roles: renaming a rank renames its category and channels, deleting one
 *  deletes them, and turning the mode off deletes the lot. Nothing here is
 *  created twice - a channel we already have an id for is edited, never
 *  replaced, so a server's history survives a rename.
 *
 *  Locking a channel to its rank role is only safe in MANUAL mode. On automatic
 *  ranks a player holds no role until their first match finishes, so locking
 *  would leave every new player staring at a server with no queue they can see.
 *  With staff handing roles out first, that deadlock cannot happen. */
async function syncRankChannelsToDiscord(
  guild: Guild,
  ranks: Rank[],
  orphaned: Rank[],
  teardown = false,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getConfig(guild.id);

  // Everything a rank owns goes, whichever shape it was made in: `category` is
  // from the old one-category-per-rank layout, everything else is a channel.
  // Children first - deleting a Discord category does not delete what is inside
  // it, it turns them loose at the root of the server.
  const drop = async (rank: Rank) => {
    const have = rankChannels(rank);
    for (const [key, id] of Object.entries(have)) {
      if (key === 'category') continue;
      await guild.channels.cache.get(id)?.delete().catch(() => {});
    }
    if (have.category) await guild.channels.cache.get(have.category)?.delete().catch(() => {});
    setRankChannels(rank.id, {});
  };

  for (const gone of orphaned) await drop(gone);

  if (teardown) {
    for (const rank of ranks) await drop(rank);
    if (cfg.split_results_id) {
      await guild.channels.cache.get(cfg.split_results_id)?.delete().catch(() => {});
    }
    if (cfg.split_category_id) {
      await guild.channels.cache.get(cfg.split_category_id)?.delete().catch(() => {});
    }
    setConfig(guild.id, { split_category_id: null, split_results_id: null });
    return { ok: true };
  }
  if (!ranks.length) return { ok: true };

  // Nothing is built until every rank has its Discord role. The channels are
  // locked to those roles, so making them first would either publish a wall of
  // channels to the whole server or leave them locked to nothing - and the
  // panel in each is a message everyone in it gets pinged by. Roles first,
  // then channels, then panels.
  const roleless = ranks.filter((r) => !r.discord_role_id);
  if (roleless.length) {
    return {
      ok: false,
      error: `save the ladder first - ${roleless.map((r) => r.name).join(', ')} ${
        roleless.length === 1 ? 'has' : 'have'
      } no Discord role yet`,
    };
  }

  // The bot names itself in the overwrite. Denying @everyone would hide the
  // channel from the bot too, and a channel the bot cannot see is one it cannot
  // put a panel in - or find again to delete when the rank goes, which is how a
  // server ends up with the old ladder's channels beside the new one's.
  const open = [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel] }];

  // A rank channel is private to its rank. The bot names itself in the deny, or
  // it loses sight of a channel it still has to post panels in and delete later.
  const me = guild.members.me?.id;
  const onlyRank = (roleIds: string[]) => [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...roleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel] })),
    ...(me
      ? [
          {
            id: me,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ]
      : []),
  ];

  // One category for the whole thing, whichever the server picked - or one of
  // ours if they picked none. Seven categories, one per rank, buried the
  // server's own channels under a wall of Quorum.
  const picked = cfg.split_category_id
    ? guild.channels.cache.get(cfg.split_category_id)
    : undefined;
  const category =
    (picked && picked.type === ChannelType.GuildCategory ? picked : null) ||
    (await guild.channels
      .create({ name: 'Quorum', type: ChannelType.GuildCategory, permissionOverwrites: open })
      .catch(() => null));
  if (!category) return { ok: false, error: 'could not create the Quorum category' };

  // One results channel, first in the category: every rank's results land here,
  // because a ladder is only a ladder if the whole server can read it.
  const results =
    (cfg.split_results_id && guild.channels.cache.get(cfg.split_results_id)) ||
    (await guild.channels
      .create({ name: 'results', type: ChannelType.GuildText, parent: category.id })
      .catch(() => null));
  if (results && 'parentId' in results && results.parentId !== category.id) {
    await results.edit({ parent: category.id, lockPermissions: true }).catch(() => {});
  }
  setConfig(guild.id, {
    split_category_id: category.id,
    split_results_id: results?.id ?? null,
  });

  // One channel per rank, holding one panel with every format's button: the
  // channel is the rank, the buttons are the format. A channel per rank PER
  // format split a pick-up queue too many ways to ever fill.
  for (const rank of ranks) {
    const have = rankChannels(rank);
    const name = slug(rank.name);

    // anything from the old shape that is not the rank's one queue channel
    for (const [key, id] of Object.entries(have)) {
      if (key === 'queue') continue;
      await guild.channels.cache.get(id)?.delete().catch(() => {});
    }

    // Every role this channel's queue can admit, not just its own rank: the
    // admin already said who queues with whom, per format, in the queues pane -
    // so the widest spread across the formats decides who can see it. The join
    // gate is still per format, so a Platinum who can see #diamond joins the
    // 2v2 there and is turned away from the 1v1.
    const admits = new Set<string>();
    for (const spread of Object.values(getRankSpread(guild.id))) {
      for (const band of bandsInReach(ranks, rank.min_elo, spread)) {
        if (band.discord_role_id) admits.add(band.discord_role_id);
      }
    }
    const perms = onlyRank([...admits]);
    const existing = have.queue && guild.channels.cache.get(have.queue);
    if (existing) {
      // re-applied every sync: a renamed or recoloured rank keeps its channel,
      // and a rank whose role was recreated needs the new id in the overwrite.
      await existing
        .edit({ name, parent: category.id, permissionOverwrites: perms })
        .catch(() => {});
      setRankChannels(rank.id, { queue: existing.id });
      continue;
    }

    const made = await guild.channels
      .create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: perms,
      })
      .catch(() => null);
    if (!made) continue;
    setRankChannels(rank.id, { queue: made.id });
    // a queue channel is useless without its panel, and this is the only moment
    // we know the channel is new.
    if (made.isSendable()) await made.send(panelMessage()).catch(() => {});
  }
  return { ok: true };
}

/** Puts a panel at the bottom of a channel, taking any older one with it.
 *
 *  "Post panel" is a repair tool - the panel is a plain message, so anyone with
 *  Manage Messages can delete one - and a repair tool has to be safe to press
 *  twice. Only the bot's own panels go; a call carries `pug:join`, not
 *  `pug:open`, and must survive. */
async function clearPanels(channel: GuildBasedChannel | undefined) {
  if (!channel?.isSendable()) return;
  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  for (const msg of recent?.values() ?? []) {
    const mine = msg.author.id === channel.client.user?.id;
    const isPanel = msg.components.some((row) =>
      'components' in row &&
      row.components.some((c) => 'customId' in c && c.customId?.startsWith('pug:open:')),
    );
    if (mine && isPanel) await msg.delete().catch(() => {});
  }
}

async function postPanel(channel: GuildBasedChannel | undefined, formats: readonly Format[]) {
  if (!channel?.isSendable()) return false;
  await clearPanels(channel);
  // A refused send is nearly always a missing Send Messages in that one
  // channel. It must not take the other twenty down with it, and it must not
  // be swallowed either - a queue channel with no panel is a dead queue, and
  // the whole reason this button exists is that nobody could tell.
  return !!(await channel.send(panelMessage(formats)).catch(() => null));
}

/** The bot owns match lifecycle; the dashboard only asks it to act. Passing the
 *  two hooks in beats importing index.ts back into here. */
interface Hooks {
  concludeMatch: (match: Match) => Promise<void>;
  cancelMatch: (match: Match) => Promise<void>;
  /** Put these players in the rank role their rating earns. Seeding calls it so
   *  a staff-seeded player holds their role before their first match - which is
   *  what makes locking a rank channel to its role safe. */
  syncRankRoles: (guildId: string, discordIds: string[]) => Promise<void>;
}

export function startWeb(client: Client, hooks: Hooks) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('web: DISCORD_CLIENT_ID/SECRET unset, dashboard disabled');
    return;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', BASE_URL);
    const path = url.pathname;

    try {
      // Every server gets its own url. Same page either way - the client reads
      // the path and decides, so there's no routing to keep in sync.
      if ((path === '/' || /^\/g\/\d{1,32}$/.test(path)) && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }

      if (path === '/login') {
        // /login is the one thing here anyone can reach, and every hit parks a
        // uuid and a timer for ten minutes. Nobody has ten thousand logins in
        // flight, so hitting this means someone is filling the heap, not
        // signing in - drop the lot rather than carry it.
        if (states.size >= 10_000) states.clear();
        const state = randomUUID();
        states.add(state);
        setTimeout(() => states.delete(state), 10 * 60 * 1000).unref();
        const params = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT,
          response_type: 'code',
          scope: 'identify guilds',
          state,
        });
        res.writeHead(302, { location: `https://discord.com/oauth2/authorize?${params}` });
        res.end();
        return;
      }

      if (path === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        // state is single-use: without deleting it here a leaked callback url
        // could be replayed.
        if (!code || !state || !states.delete(state)) {
          res.writeHead(400).end('bad oauth state');
          return;
        }
        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT,
          }),
        }).catch(() => null);
        const token = tokenRes?.ok ? ((await tokenRes.json()) as { access_token: string }) : null;
        if (!token) {
          res.writeHead(502).end('discord rejected the login');
          return;
        }

        const user = await discord<Session['user']>('/users/@me', token.access_token);
        const guilds = await discord<
          { id: string; name: string; icon: string | null; owner: boolean; permissions: string }[]
        >('/users/@me/guilds', token.access_token);
        if (!user || !guilds) {
          res.writeHead(502).end('could not read your Discord account');
          return;
        }

        // Manage Server (or ownership) is the bar, same one Discord uses for
        // adding a bot. Anything below it has no business editing these.
        const manageable = guilds.filter(
          (g) =>
            // the allowlist is enforced here too, not just in the bot: otherwise
            // the dashboard would offer an invite link for a server the bot
            // leaves the moment it arrives.
            guildAllowed(g.id) &&
            (g.owner ||
              (BigInt(g.permissions) & PermissionFlagsBits.ManageGuild) ===
                PermissionFlagsBits.ManageGuild),
        );
        // opportunistic sweep: without it a long-running bot keeps every
        // session it ever issued, since sessionOf only drops the one it is asked for.
        for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
        const sid = randomUUID();
        sessions.set(sid, {
          user: {
            id: user.id,
            username: user.username,
            global_name: user.global_name ?? null,
            avatar: user.avatar,
          },
          guildIds: new Set(manageable.map((g) => g.id)),
          guilds: manageable.map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
          expires: Date.now() + SESSION_MS,
        });
        res.writeHead(302, {
          location: '/',
          'set-cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${BASE_URL.startsWith('https') ? '; Secure' : ''}`,
        });
        res.end();
        return;
      }

      if (path === '/logout') {
        const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        if (sid) sessions.delete(sid);
        res.writeHead(302, { location: '/', 'set-cookie': 'sid=; Path=/; Max-Age=0' });
        res.end();
        return;
      }

      const session = sessionOf(req);
      if (!session) {
        json(res, 401, { error: 'signed out' });
        return;
      }

      // KovaaK's scenario search, so the pool can only ever hold names the
      // score lookup will actually find. Session-gated: it is our rate limit.
      if (path === '/api/scenarios' && req.method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
        json(res, 200, { scenarios: q.length < 2 ? [] : await searchScenarios(q) });
        return;
      }

      if (path === '/api/me') {
        json(res, 200, {
          user: session.user,
          guilds: session.guilds.map((g) => ({
            ...g,
            installed: client.guilds.cache.has(g.id),
            // off the gateway's GUILD_CREATE, so it costs nothing and needs no
            // privileged intent. Null until the bot is in there to count.
            members: client.guilds.cache.get(g.id)?.memberCount ?? null,
            // guild is pinned and the picker disabled - the dashboard already
            // asked which server, so Discord shouldn't ask again.
            // ManageChannels + ManageRoles for the ladder's roles and channels,
            // the thread permissions for a match's own room, and View/Send/Embed/History so the
            // bot holds those itself. It cannot lean on @everyone for them: the
            // first thing a locked rank category does is take them away.
            invite: `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}&guild_id=${g.id}&disable_guild_select=true`,
          })),
        });
        return;
      }

      const matchAction = /^\/api\/guild\/(\d{1,32})\/match\/(\d+)\/(finish|cancel)$/.exec(path);
      if (matchAction && req.method === 'POST') {
        const [, gid, mid, verb] = matchAction;
        if (!session.guildIds.has(gid)) {
          json(res, 403, { error: 'not your server' });
          return;
        }
        const target = getMatch(Number(mid));
        // The match must belong to the server you're authorized for, or the id
        // alone would reach into someone else's games.
        if (!target || target.guild_id !== gid) {
          json(res, 404, { error: 'no such match' });
          return;
        }
        if (target.status !== 'lobby' && target.status !== 'banning' && target.status !== 'live') {
          json(res, 409, { error: 'that match is already over' });
          return;
        }
        // Only a live match has scores worth scoring; finishing a lobby would
        // hand out Elo for a game nobody played.
        if (verb === 'finish' && target.status !== 'live') {
          json(res, 409, { error: 'that one never started' });
          return;
        }
        await (verb === 'finish' ? hooks.concludeMatch(target) : hooks.cancelMatch(target));
        json(res, 200, { matches: listOpenMatches(gid).map((m) => ({ id: m.id })) });
        return;
      }

      const match = /^\/api\/guild\/(\d{1,32})(\/[a-z]+)?$/.exec(path);
      if (!match) {
        res.writeHead(404).end('not found');
        return;
      }
      const [, guildId, action] = match;
      // The posted guild id is untrusted - authorize against the session, never
      // against what the browser claims.
      if (!session.guildIds.has(guildId)) {
        json(res, 403, { error: 'not your server' });
        return;
      }
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        json(res, 404, { error: 'bot is not in that server' });
        return;
      }

      if (!action && req.method === 'GET') {
        const players = playersInGuild(guildId);
        await refreshVoltaic(players);
        json(res, 200, {
          config: getConfig(guildId),
          channels: guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildText)
            .map((c) => ({ id: c.id, name: c.name })),
          roles: guild.roles.cache
            .filter((r) => r.id !== guild.id && !r.managed)
            .map((r) => ({ id: r.id, name: r.name })),
          ranks: getRanks(guildId),
          scenarios: getScenarios(guildId),
          players: players.map((p) => ({
            ...p,
            avatar: client.users.cache.get(p.discord_id)?.avatar ?? null,
            voltaic: readVoltaic(p.voltaic),
          })),
          formats: Object.keys(FORMATS),
          spread: getRankSpread(guildId),
          categories: guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildCategory)
            .map((c) => ({ id: c.id, name: c.name })),
          seedMode: getSeedMode(guildId),
          seedModes: SEED_MODES,
          stats: guildStats(guildId),
          top: leaderboard(guildId, 5).map((p) => ({ ...p, voltaic: readVoltaic(p.voltaic) })),
          // One line per finished match: who played, where they placed, what it
          // cost them. Trimmed here because the page shows nothing else.
          history: matchHistory(guildId, 25).map(({ match, players }) => {
            const played: string[] = JSON.parse(match.scenarios);
            const pool: string[] = match.ban_pool ? JSON.parse(match.ban_pool) : [];
            return {
              id: match.id,
              format: match.format,
              ended_at: match.ended_at,
              played,
              // What is in the pool but not in the end is exactly what was
              // banned. Empty for group and for any match that never had a
              // ban phase to record.
              banned: pool.filter((s) => !played.includes(s)),
              players: players.map((r) => ({
                name: r.kovaaks_username,
                placing: r.placing,
                delta: (r.elo_after ?? 0) - (r.elo_before ?? 0),
                scores: JSON.parse(r.scores) as Record<string, number | null>,
              })),
            };
          }),
          matches: listOpenMatches(guildId).map((m) => ({
            id: m.id,
            format: m.format,
            status: m.status,
            started_at: m.started_at,
            created_at: m.created_at,
            scenarios: JSON.parse(m.scenarios),
            players: matchPlayers(m.id).map((r) => ({
              id: r.discord_id,
              name: getPlayer(r.discord_id)?.kovaaks_username ?? r.discord_id,
              // whatever the gateway already cached; the page falls back to
              // Discord's default avatar rather than us fetching anyone.
              avatar: client.users.cache.get(r.discord_id)?.avatar ?? null,
              done: !!r.done,
            })),
          })),
        });
        return;
      }

      if (!action && req.method === 'PUT') {
        const body = await readJson(req);
        // Against this guild's own caches, not just the shape of a snowflake:
        // the category is created into and fetched by id, so a well-formed id
        // from another server would hang this server's channels off it.
        const category = (v: unknown) =>
          typeof v === 'string' &&
          guild.channels.cache.get(v)?.type === ChannelType.GuildCategory
            ? v
            : null;
        const role = (v: unknown) => (typeof v === 'string' && guild.roles.cache.has(v) ? v : null);
        const ttl = (v: unknown) => {
          if (v == null) return null;
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n <= 0) return 0;
          return Math.min(Math.max(n, 5), 1440);
        };
        setConfig(guildId, {
          // Naming no category keeps the one already in use, and only falls
          // through to null - "make one" - when there is none, or when the one
          // on file has since been deleted in Discord. Taking the body at its
          // word would orphan the current category and build a second one on
          // every save.
          split_category_id:
            category(body.category_id) ?? category(getConfig(guildId).split_category_id),
          ping_role_id: role(body.ping_role_id),
          // 0 is off and null is "use the default", so both have to survive the
          // trip. Anything else is clamped: a one-minute window bins calls
          // before anyone sees them, and a one-year one is off with extra steps.
          call_ttl_min: ttl(body.call_ttl_min),
        });
        // A different category means the channels move into it, so the save has
        // to reach Discord and not just the database. Awaited, so a failure is
        // reported rather than swallowed into a background promise, and so two
        // saves in a row cannot have their syncs interleave.
        const built = await syncRankChannelsToDiscord(guild, getRanks(guildId), []);
        json(res, 200, { ...getConfig(guildId), error: built.error });
        return;
      }

      if (action === '/ranks' && req.method === 'PUT') {
        const body = await readJson(req);
        const rows = Array.isArray(body.ranks) ? body.ranks : [];
        const clean = rows
          .map((r: Record<string, unknown>) => ({
            id: typeof r.id === 'number' ? r.id : undefined,
            name: String(r.name ?? '').trim().slice(0, 90),
            min_elo: Math.trunc(Number(r.min_elo)),
            color: /^#[0-9a-f]{6}$/i.test(String(r.color)) ? String(r.color) : '#ffffff',
          }))
          .filter((r: { name: string; min_elo: number }) => r.name && Number.isFinite(r.min_elo));
        if (!clean.length) {
          json(res, 400, { error: 'a ladder needs at least one rank' });
          return;
        }
        // every rank becomes a Discord role, and a guild caps at 250 - without
        // this, one request could ask the bot to hammer the role API forever.
        if (clean.length > 50) {
          json(res, 400, { error: 'a ladder tops out at 50 ranks' });
          return;
        }
        const { ranks, orphaned } = setRanks(guildId, clean);
        // Roles first, always: the channels below are locked to them.
        await syncRankRolesToDiscord(guild, ranks, orphaned);
        const built = await syncRankChannelsToDiscord(guild, getRanks(guildId), orphaned);
        json(res, 200, { ranks: getRanks(guildId), error: built.error });
        return;
      }

      if (action === '/seedmode' && req.method === 'POST') {
        const mode = String((await readJson(req)).mode ?? '') as SeedMode;
        if (!SEED_MODES.includes(mode)) {
          json(res, 400, { error: 'unknown seed mode' });
          return;
        }
        setConfig(guildId, { seed_mode: mode });
        json(res, 200, { mode });
        return;
      }

      if (action === '/queues' && req.method === 'PUT') {
        const body = await readJson(req);
        const clean: Record<string, number> = {};
        for (const format of Object.keys(FORMATS)) {
          const n = Math.trunc(Number(body.spread?.[format]));
          // out-of-range is dropped, not clamped, so getRankSpread falls back
          // to the default rather than silently inventing a gate.
          if (Number.isFinite(n) && n >= 0 && n <= 6) clean[format] = n;
        }
        json(res, 200, { spread: setRankSpread(guildId, clean) });
        return;
      }

      if (action === '/scenarios' && req.method === 'PUT') {
        const body = await readJson(req);
        const rows = Array.isArray(body.scenarios) ? body.scenarios : [];
        const clean = rows
          .map((r: Record<string, unknown>) => ({
            category: String(r.category ?? '').trim().slice(0, 60),
            name: String(r.name ?? '').trim().slice(0, 120),
          }))
          .filter((r: { category: string; name: string }) => r.category && r.name);
        // An empty pool would start matches with nothing to play, so it is
        // refused rather than saved.
        if (!clean.length) {
          json(res, 400, { error: 'the pool needs at least one scenario' });
          return;
        }
        if (clean.length > 500) {
          json(res, 400, { error: 'the pool tops out at 500 scenarios' });
          return;
        }
        json(res, 200, { scenarios: setScenarios(guildId, clean) });
        return;
      }

      if (action === '/seeds' && req.method === 'PUT') {
        const body = await readJson(req);
        // seedPlayer rewrites the rating of anyone who has not played, so an id
        // from the request is not enough - it has to be someone this server has.
        const mine = new Set(playersInGuild(guildId).map((p) => p.discord_id));
        const ranks = getRanks(guildId);
        const moved: string[] = [];
        for (const row of Array.isArray(body.seeds) ? body.seeds : []) {
          const id = String(row.discord_id ?? '');
          const rank = ranks.find((r) => r.name === String(row.rank ?? ''));
          if (mine.has(id) && rank && seedPlayer(id, rank.min_elo, rank.name)) moved.push(id);
        }
        // Hand out the roles now rather than after their first match: a rank
        // channel is private to its role, so a seeded player who holds none
        // would be seeded into a queue they cannot see.
        if (moved.length) await hooks.syncRankRoles(guildId, moved);
        json(res, 200, { players: playersInGuild(guildId) });
        return;
      }

      if (action === '/panel' && req.method === 'POST') {
        // Queues live in a channel per rank, each with the same panel - and
        // those were only ever posted the moment the channel was created, so a
        // deleted one had no way back. One button, every queue channel the
        // server actually has.
        {
          let posted = 0;
          let missed = 0;
          for (const rank of getRanks(guildId)) {
            const id = rankChannels(rank).queue;
            if (!id) continue;
            if (await postPanel(guild.channels.cache.get(id), PANEL_FORMATS)) posted++;
            else missed++;
          }
          if (!posted && !missed) {
            json(res, 400, { error: 'no rank channels yet - save the ladder first' });
            return;
          }
          json(res, 200, { ok: true, posted, missed });
          return;
        }
      }

      // Quorum leaves, optionally taking everything it made with it.
      //
      // This has to be a button here rather than something that fires when the
      // bot is kicked: Discord tells a bot it has been removed, it does not let
      // it act afterwards. By the time `guildDelete` arrives there is no
      // permission left to delete a single role. So the tidy-up happens while
      // it is still a member, and leaving is the last thing it does.
      if (action === '/leave' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.purge) {
          // Calls first. Cancelling one deletes its message and its thread,
          // neither of which the rank sweep below knows anything about.
          for (const open of listOpenMatches(guildId)) await hooks.cancelMatch(open);
          const ranks = getRanks(guildId);
          await syncRankChannelsToDiscord(guild, [], ranks, true);
          await syncRankRolesToDiscord(guild, [], ranks);
          // Every channel holding a panel was Quorum's own and went with the
          // category above, so there is no stray panel left to chase.
          purgeGuild(guildId);
        }
        const left = await guild.leave().then(() => true).catch(() => false);
        if (!left) {
          json(res, 502, { error: "Discord wouldn't let the bot leave - remove it by hand" });
          return;
        }
        json(res, 200, { ok: true });
        return;
      }

      res.writeHead(405).end('method not allowed');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'server error' });
    }
  });

  server.listen(PORT, () => console.log(`web: ${BASE_URL} (listening on :${PORT})`));
}
