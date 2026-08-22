/** Dev harness: runs the real dashboard against a fake Discord.
 *  `npm run dev:web`, then open http://localhost:3001 to land signed in.
 *  ponytail: no OAuth app, no bot, no gateway - global fetch is stubbed for
 *  discord.com and the Client is a couple of Collections. Delete this file if
 *  you'd rather test against real credentials. */
import { createServer } from 'node:http';
import { Collection } from 'discord.js';

process.env.DISCORD_CLIENT_ID = 'dev';
process.env.DISCORD_CLIENT_SECRET = 'dev';
process.env.WEB_URL = 'http://localhost:3010';
process.env.PORT = '3010';
process.env.DB_PATH = process.env.DB_PATH ?? '/tmp/pug-dev.db';
// mirrors a locked-down deploy: only the dev guild is allowed through.
process.env.ALLOWED_GUILD_IDS = process.env.ALLOWED_GUILD_IDS ?? '111111111111111111';

const GUILD_ID = '111111111111111111';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!url.startsWith('https://discord.com/api')) return realFetch(input, init);
  const body = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/oauth2/token')) return body({ access_token: 'dev' });
  if (url.endsWith('/users/@me')) return body({ id: '900000000000000001', username: 'devadmin', global_name: 'Dev Admin', avatar: null });
  if (url.endsWith('/users/@me/guilds'))
    return body([
      { id: GUILD_ID, name: 'Dev Server', icon: null, owner: true, permissions: '8' },
      // the bot is deliberately not in this one, so the "add quorum to" list
      // has something in it. DEV_EMPTY=1 empties the installed list too.
      { id: '222222222222222222', name: 'Uninvited Server', icon: null, owner: true, permissions: '8' },
    ]);
  return new Response('{}', { status: 404 });
}) as typeof fetch;

// env has to be set before these read it at module load.
const { db, ensurePlayer } = await import('./src/db.js');
const { startWeb } = await import('./src/web.js');

const channel = (id: string, name: string, type: number, parentId: string | null = null) => ({
  id,
  name,
  type,
  parentId,
  isSendable: () => true,
  send: (msg: unknown) => {
    console.log(`  #${name} <- panel`);
    return Promise.resolve({ id: '1' });
  },
  edit: async (patch: any) => {
    console.log(`  edit ${name} -> ${JSON.stringify(patch)}`);
    return null;
  },
  delete: async () => {
    channels.delete(id);
    console.log(`  deleted ${type === 4 ? 'category ' : '#'}${name}`);
  },
});
const role = (id: string, name: string, color = 0) => ({
  id,
  name,
  color,
  managed: false,
  edit: async (patch: any) => console.log(`role ${name} -> ${JSON.stringify(patch)}`),
  delete: async () => console.log(`role ${name} deleted`),
});

const channels = new Collection<string, any>([
  ['201', channel('201', 'queue', 0)],
  ['202', channel('202', 'results', 0)],
  ['203', channel('203', 'Quorum', 4)],
]);
const roles = new Collection<string, any>([
  [GUILD_ID, role(GUILD_ID, '@everyone')],
  ['301', role('301', 'Pug Ping')],
]);

let nextId = 400;
const guild: any = {
  id: GUILD_ID,
  name: 'Dev Server',
  memberCount: 1284,
  channels: {
    cache: channels,
    create: async ({ name, type, parent }: any) => {
      const c = channel(String(++nextId), name, type, parent ?? null);
      channels.set(c.id, c);
      console.log(`  created ${type === 4 ? 'category ' : '#'}${name}`);
      return c;
    },
  },
  roles: {
    cache: roles,
    create: async ({ name, color }: any) => {
      const r = role(String(++nextId), name, color);
      roles.set(r.id, r);
      console.log(`created role ${name}`);
      return r;
    },
  },
};
const client: any = {
  guilds: { cache: new Collection(process.env.DEV_EMPTY ? [] : [[GUILD_ID, guild]]) },
  // no avatar hashes, so the page falls back to Discord's default avatars.
  users: { cache: new Collection<string, any>([
    ['900000000000000001', { id: '900000000000000001', avatar: null }],
    ['900000000000000002', { id: '900000000000000002', avatar: null }],
  ]) },
};

// something to look at: two players and one live match.
ensurePlayer('900000000000000001', 'devadmin', '76561199174645837', 'advanced');
ensurePlayer('900000000000000002', 'challenger', null, 'novice');
if (!db.prepare('select 1 from match').get()) {
  db.prepare(
    `insert into match (guild_id, channel_id, host_id, format, status, scenarios, created_at, started_at)
     values (?, '201', '900000000000000001', '1v1', 'live', ?, 1750000000000, 1750000000000)`,
  ).run(GUILD_ID, JSON.stringify(['poleTS', 'CircleTS', 'darkSwitch']));
  const id = (db.prepare('select max(id) as id from match').get() as any).id;
  for (const p of ['900000000000000001', '900000000000000002'])
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(id, p);

  // finished history, so the overview has stats and a ladder to draw.
  for (let n = 0; n < 7; n++) {
    db.prepare(
      `insert into match (guild_id, channel_id, host_id, format, status, created_at, ended_at)
       values (?, '201', '900000000000000001', '1v1', 'done', 0, ?)`,
    ).run(GUILD_ID, Date.now() - n * 36 * 60 * 60 * 1000);
  }
  db.prepare(
    `insert into match (guild_id, channel_id, host_id, format, status, scenarios, created_at)
     values (?, '201', '900000000000000001', '2v2', 'banning', ?, ?)`,
  ).run(GUILD_ID, JSON.stringify(['poleTS', 'CircleTS', 'darkSwitch', 'domiSwitch Harder', 'FloatTS Angelic']), Date.now());
  const banId = (db.prepare('select max(id) as id from match').get() as any).id;
  for (const p of ['900000000000000001', '900000000000000002'])
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(banId, p);

  db.prepare("update player set elo = 1312, wins = 5, losses = 2 where kovaaks_username = 'devadmin'").run();
  db.prepare("update player set elo = 1188, wins = 2, losses = 5 where kovaaks_username = 'challenger'").run();
}

startWeb(client, {
  concludeMatch: async (m) => {
    db.prepare("update match set status = 'done' where id = ?").run(m.id);
    console.log(`match ${m.id} finished`);
  },
  cancelMatch: async (m) => {
    db.prepare("update match set status = 'cancelled' where id = ?").run(m.id);
    console.log(`match ${m.id} cancelled`);
  },
});

// /login's state is single-use and expires, so mint a fresh one per visit
// instead of printing one URL that goes stale.
createServer(async (_req, res) => {
  const login = await realFetch('http://localhost:3010/login', { redirect: 'manual' });
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  res.writeHead(302, { location: `http://localhost:3010/callback?code=dev&state=${state}` }).end();
}).listen(3011, () => console.log('dev login: http://localhost:3011'));
