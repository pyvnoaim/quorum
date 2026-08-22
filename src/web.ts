import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ChannelType, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { FORMATS, TIERS, guildAllowed, type Format, type Tier } from './config.js';
import {
  getConfig,
  getMatch,
  getRankSpread,
  getRanks,
  isSplit,
  rankChannels,
  getScenarios,
  guildStats,
  leaderboard,
  listOpenMatches,
  playersInGuild,
  matchPlayers,
  getPlayer,
  setConfig,
  setRankChannels,
  setRankRole,
  setRankSpread,
  setVoltaic,
  setRanks,
  setScenarios,
  setTier,
  type Match,
  type Player,
  type Rank,
  type RankChannels,
} from './db.js';
import { panelMessage } from './embeds.js';
import { searchScenarios, voltaicS5 } from './kovaaks.js';
import { PAGE } from './page.js';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';
const BASE_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.PORT ?? 3000);
const REDIRECT = `${BASE_URL}/callback`;
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
 *  Channels are deliberately NOT locked to their rank role. A player has no
 *  rank role until their first match finishes, so locking would leave a new
 *  player unable to see any queue they could join. The gate already refuses
 *  them; the names and the pings are the signpost. */
async function syncRankChannelsToDiscord(
  guild: Guild,
  ranks: Rank[],
  orphaned: Rank[],
  split: boolean,
) {
  const drop = async (rank: Rank) => {
    const { category, ...rest } = rankChannels(rank);
    // children first: deleting a category in Discord does not delete what is
    // inside it, it turns them loose at the root of the server.
    for (const id of Object.values(rest)) {
      await guild.channels.cache.get(id)?.delete().catch(() => {});
    }
    if (category) await guild.channels.cache.get(category)?.delete().catch(() => {});
    setRankChannels(rank.id, {});
  };

  for (const gone of orphaned) await drop(gone);
  if (!split) {
    for (const rank of ranks) await drop(rank);
    return;
  }

  for (const rank of ranks) {
    const have = rankChannels(rank);
    const next: RankChannels = {};

    const category =
      (have.category && guild.channels.cache.get(have.category)) ||
      (await guild.channels
        .create({ name: rank.name, type: ChannelType.GuildCategory })
        .catch(() => null));
    if (!category) continue;
    if (category.name !== rank.name) await category.edit({ name: rank.name }).catch(() => {});
    next.category = category.id;

    const kinds = [...(Object.keys(FORMATS) as Format[]), 'results' as const];
    for (const kind of kinds) {
      const name = `${slug(rank.name)}-${kind}`;
      const existing = have[kind] && guild.channels.cache.get(have[kind]!);
      if (existing) {
        if (existing.name !== name || existing.parentId !== category.id) {
          await existing.edit({ name, parent: category.id }).catch(() => {});
        }
        next[kind] = existing.id;
        continue;
      }
      const made = await guild.channels
        .create({ name, type: ChannelType.GuildText, parent: category.id })
        .catch(() => null);
      if (!made) continue;
      next[kind] = made.id;
      // a queue channel is useless without its panel, and this is the only
      // moment we know the channel is new.
      if (kind !== 'results' && made.isSendable()) {
        await made.send(panelMessage([kind])).catch(() => {});
      }
    }
    setRankChannels(rank.id, next);
  }
}

/** The bot owns match lifecycle; the dashboard only asks it to act. Passing the
 *  two hooks in beats importing index.ts back into here. */
interface Hooks {
  concludeMatch: (match: Match) => Promise<void>;
  cancelMatch: (match: Match) => Promise<void>;
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
            invite: `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=285213200&guild_id=${g.id}&disable_guild_select=true`,
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
          categories: guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildCategory)
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
          tiers: TIERS,
          formats: Object.keys(FORMATS),
          spread: getRankSpread(guildId),
          split: isSplit(guildId),
          stats: guildStats(guildId),
          top: leaderboard(guildId, 5),
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
        const pick = (v: unknown) => (typeof v === 'string' && /^\d{1,32}$/.test(v) ? v : null);
        json(
          res,
          200,
          setConfig(guildId, {
            panel_channel_id: pick(body.panel_channel_id),
            results_channel_id: pick(body.results_channel_id),
            voice_category_id: pick(body.voice_category_id),
            ping_role_id: pick(body.ping_role_id),
          }),
        );
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
        await syncRankRolesToDiscord(guild, ranks, orphaned);
        await syncRankChannelsToDiscord(guild, getRanks(guildId), orphaned, isSplit(guildId));
        json(res, 200, { ranks: getRanks(guildId) });
        return;
      }

      if (action === '/split' && req.method === 'POST') {
        const body = await readJson(req);
        const on = !!body.on;
        setConfig(guildId, { split_channels: on ? 1 : 0 });
        // Turning it off deletes the channels it made. Everything it created is
        // tracked, so nothing else in the server is touched.
        await syncRankChannelsToDiscord(guild, getRanks(guildId), [], on);
        json(res, 200, { split: on, ranks: getRanks(guildId) });
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

      if (action === '/tiers' && req.method === 'PUT') {
        const body = await readJson(req);
        // setTier reseeds the rating of anyone who hasn't played, so an id from
        // the request is not enough - it has to be someone this server has.
        const mine = new Set(playersInGuild(guildId).map((p) => p.discord_id));
        for (const row of Array.isArray(body.tiers) ? body.tiers : []) {
          const id = String(row.discord_id ?? '');
          const tier = String(row.tier ?? '') as Tier;
          if (mine.has(id) && TIERS.includes(tier)) setTier(id, tier);
        }
        json(res, 200, { players: playersInGuild(guildId) });
        return;
      }

      if (action === '/category' && req.method === 'POST') {
        const body = await readJson(req);
        const name = String(body.name ?? '').slice(0, 90).trim();
        if (!name) {
          json(res, 400, { error: 'name required' });
          return;
        }
        const category = await guild.channels
          .create({ name, type: ChannelType.GuildCategory })
          .catch(() => null);
        if (!category) {
          json(res, 502, { error: 'missing Manage Channels' });
          return;
        }
        setConfig(guildId, { voice_category_id: category.id });
        json(res, 200, { id: category.id, name: category.name });
        return;
      }

      if (action === '/panel' && req.method === 'POST') {
        const channelId = getConfig(guildId).panel_channel_id;
        const channel = channelId ? guild.channels.cache.get(channelId) : null;
        if (!channel?.isSendable()) {
          json(res, 400, { error: 'pick and save a queue channel first' });
          return;
        }
        await channel.send(panelMessage());
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
