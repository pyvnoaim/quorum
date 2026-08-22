import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import { getConfig, setConfig } from './db.js';
import { panelMessage } from './embeds.js';
import { PAGE } from './page.js';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';
const BASE_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.PORT ?? 3000);
const REDIRECT = `${BASE_URL}/callback`;
const SESSION_MS = 12 * 60 * 60 * 1000;

interface Session {
  user: { id: string; username: string; avatar: string | null };
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

export function startWeb(client: Client) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('web: DISCORD_CLIENT_ID/SECRET unset, dashboard disabled');
    return;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', BASE_URL);
    const path = url.pathname;

    try {
      if (path === '/' && req.method === 'GET') {
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
            g.owner ||
            (BigInt(g.permissions) & PermissionFlagsBits.ManageGuild) ===
              PermissionFlagsBits.ManageGuild,
        );
        const sid = randomUUID();
        sessions.set(sid, {
          user: { id: user.id, username: user.username, avatar: user.avatar },
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

      if (path === '/api/me') {
        json(res, 200, {
          user: session.user,
          guilds: session.guilds.map((g) => ({
            ...g,
            installed: client.guilds.cache.has(g.id),
            invite: `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=285213200&guild_id=${g.id}`,
          })),
        });
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
        json(res, 200, {
          config: getConfig(guildId),
          channels: guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildText)
            .map((c) => ({ id: c.id, name: c.name })),
          categories: guild.channels.cache
            .filter((c) => c.type === ChannelType.GuildCategory)
            .map((c) => ({ id: c.id, name: c.name })),
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
          }),
        );
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
