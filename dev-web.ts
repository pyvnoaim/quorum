/** Dev harness: runs the real dashboard against a fake Discord.
 *  `npm run dev:web`, then open http://localhost:3011 to land signed in
 *  (the dashboard itself is on :3010; :3011 is the one-hit fake login, and
 *  PORT=3020 moves both if you already have one up).
 *  ponytail: no OAuth app, no bot, no gateway - global fetch is stubbed for
 *  discord.com and the Client is a couple of Collections. Delete this file if
 *  you'd rather test against real credentials. */
import { createServer } from 'node:http';
import { Collection } from 'discord.js';

process.env.DISCORD_CLIENT_ID = 'dev';
process.env.DISCORD_CLIENT_SECRET = 'dev';
// Overridable, so a second copy can run beside one you already have up:
// `PORT=3020 npm run dev:web`. The fake login sits on the next port up.
process.env.PORT ??= '3010';
process.env.WEB_URL = `http://localhost:${process.env.PORT}`;
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
  send: (msg: any) => {
    const embed = msg?.embeds?.[0]?.data ?? msg?.embeds?.[0];
    console.log(`  #${name} <- ${embed?.title ?? 'message'}`);
    if (embed?.description) console.log(`     ${embed.description.replace(/\n/g, '\n     ')}`);
    return Promise.resolve({ id: String(nextId++) });
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

let nextId = 400;
const channels = new Collection<string, any>([
  ['201', channel('201', 'queue', 0)],
  ['202', channel('202', 'results', 0)],
  ['204', channel('204', 'announcements', 0)],
  ['203', channel('203', 'Quorum', 4)],
]);
const roles = new Collection<string, any>([
  [GUILD_ID, role(GUILD_ID, '@everyone')],
  ['301', role('301', 'Pug Ping')],
]);

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
  // the bot's own member, named in every locked channel's overwrite so it does
  // not hide the channel from itself.
  members: { me: { id: '999000000000000001' } },
  roles: {
    cache: roles,
    // discord.js always has this; the sync reads it to build permission
    // overwrites, so the fake guild needs it too.
    everyone: roles.get(GUILD_ID),
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
ensurePlayer('900000000000000001', 'devadmin', '76561199174645837', { elo: 1150, from: 'Platinum' });
ensurePlayer('900000000000000002', 'challenger', null, { elo: 950, from: 'flat' });
if (!db.prepare('select 1 from match').get()) {
  // Eight minutes in, so the card reads like a match someone is actually
  // playing rather than one from last year.
  const started = Date.now() - 8 * 60 * 1000;
  db.prepare(
    `insert into match (guild_id, channel_id, host_id, format, status, scenarios, created_at, started_at)
     values (?, '201', '900000000000000001', '1v1', 'live', ?, ?, ?)`,
  ).run(GUILD_ID, JSON.stringify(['poleTS', 'CircleTS', 'darkSwitch']), started, started);
  const id = (db.prepare('select max(id) as id from match').get() as any).id;
  for (const p of ['900000000000000001', '900000000000000002'])
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(id, p);

  // finished history, so the overview has stats and a ladder to draw - and so
  // the history table has rows with players, placings and deltas in them.
  for (let n = 0; n < 7; n++) {
    // Both shortlists the pick phase put on the table, and the three that came
    // out of it - so history has something to expand onto. The third scenario
    // is a plain roll, which is why it is not in the pool.
    const pool = ['poleTS', 'CircleTS', 'darkSwitch', 'domiSwitch Harder', 'FloatTS Angelic',
      'popcorn v2', 'Ground Plaza', 'Bounce 180 Tracking', 'Pasu Voltaic Easy', 'Air Angelic 4'];
    const play = ['poleTS', 'popcorn v2', 'tamTargetSwitch Control Hard'];
    db.prepare(
      `insert into match (guild_id, channel_id, host_id, format, status, scenarios, ban_pool, created_at, ended_at)
       values (?, '201', '900000000000000001', '1v1', 'done', ?, ?, 0, ?)`,
    ).run(
      GUILD_ID,
      JSON.stringify(play),
      JSON.stringify(pool),
      Date.now() - n * 36 * 60 * 60 * 1000,
    );
    const doneId = (db.prepare('select max(id) as id from match').get() as any).id;
    // devadmin took five of the seven, which is the 5W-2L the ladder shows.
    const adminWon = n < 5;
    for (const [discordId, won, elo] of [
      ['900000000000000001', adminWon, 1312],
      ['900000000000000002', !adminWon, 1188],
    ] as const) {
      const delta = won ? 16 : -16;
      const scores = Object.fromEntries(
        play.map((sc, i) => [sc, Math.round((won ? 900 : 820) + i * 37 + n * 5)]),
      );
      db.prepare(
        `insert into match_player (match_id, discord_id, team, done, scores, placing, elo_before, elo_after)
         values (?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(
        doneId,
        discordId,
        discordId.endsWith('1') ? 0 : 1,
        JSON.stringify(scores),
        won ? 1 : 2,
        elo - delta,
        elo,
      );
    }
  }
  // Mid pick phase, in the shape the bot stores: scenario one settled, scenario
  // two down to its last three after both bans, so the card shows a match
  // waiting on side 1's pick.
  const phase = {
    picked: ['poleTS'],
    cats: ['Speed', 'Evasive', 'Precision'],
    pool: ['CircleTS', 'darkSwitch', 'domiSwitch Harder'],
    size: 5,
  };
  db.prepare(
    `insert into match (guild_id, channel_id, host_id, format, status, scenarios, ban_pool, created_at)
     values (?, '201', '900000000000000001', '1v1', 'banning', ?, ?, ?)`,
  ).run(
    GUILD_ID,
    JSON.stringify(phase),
    JSON.stringify(['poleTS', 'FloatTS Angelic', 'Ground Plaza', 'popcorn v2', 'Pasu Voltaic Easy']),
    Date.now() - 40 * 1000,
  );
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
  const login = await realFetch(`${process.env.WEB_URL}/login`, { redirect: 'manual' });
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  res.writeHead(302, { location: `${process.env.WEB_URL}/callback?code=dev&state=${state}` }).end();
}).listen(Number(process.env.PORT) + 1, () =>
  console.log(`dev login: http://localhost:${Number(process.env.PORT) + 1}`),
);
