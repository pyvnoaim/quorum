/** Everything you'd want to tune without reading the rest of the bot. */

/** Servers this bot will run in. Set it and the bot leaves anywhere else the
 *  moment it is added, and the dashboard won't list those servers either -
 *  a public invite link can't be used to quietly park it somewhere.
 *  Empty (the default) means no restriction. */
export const ALLOWED_GUILDS = new Set(
  (process.env.ALLOWED_GUILD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{1,32}$/.test(id)),
);
export const guildAllowed = (id: string) => !ALLOWED_GUILDS.size || ALLOWED_GUILDS.has(id);

export const FORMATS = {
  '1v1': { min: 2, max: 2, teamSize: 1 },
  '2v2': { min: 4, max: 4, teamSize: 2 },
  group: { min: 3, max: 8, teamSize: 1 },
} as const;
export type Format = keyof typeof FORMATS;

/** Tiers are assigned by hand off Voltaic rank (`/pug tier`). They do two jobs:
 *  seed a new player's Elo, and decide who may play whom. */
export const TIERS = ['novice', 'intermediate', 'advanced', 'elite'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_SEED: Record<Tier, number> = {
  novice: 950,
  intermediate: 1050,
  advanced: 1150,
  elite: 1275,
};
/** How many rank bands apart two players may be, per format. 0 locks a queue
 *  to one rank; 1 lets the band either side in. Seeded into a server's config
 *  on first read and owned by the dashboard after that. */
export const DEFAULT_RANK_SPREAD: Record<Format, number> = {
  '1v1': 0,
  '2v2': 1,
  group: 1,
};

/** Seeds a server's rank ladder the first time it's read. After that the rows
 *  in the db are the truth - names, colors and thresholds are edited in the
 *  dashboard, so don't reach for this constant anywhere else. */
export const DEFAULT_RANKS: { name: string; min_elo: number; color: string }[] = [
  { name: 'Champion', min_elo: 1400, color: '#ffd230' },
  { name: 'Diamond', min_elo: 1275, color: '#67e8f9' },
  { name: 'Platinum', min_elo: 1150, color: '#a5b4fc' },
  { name: 'Gold', min_elo: 1050, color: '#fbbf24' },
  { name: 'Silver', min_elo: 950, color: '#d4d4d8' },
  { name: 'Bronze', min_elo: 850, color: '#d97706' },
  { name: 'Iron', min_elo: 0, color: '#71717a' },
];

export const K_FACTOR = 32;

/** Rolled from at match start, one per category where the round count allows.
 *  Names must match KovaaK's EXACTLY or the score lookup finds nothing - copy
 *  them out of the game, not off a spreadsheet.
 *  ponytail: categories are here because a ban/pick format (EmoAim) needs them;
 *  the base bot only uses them to spread the roll. */
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  Speed: [
    'voxTargetSwitch 2 10% Smaller',
    'StaticSwitchingVox xxSmall',
    'VT psalmTS Advanced',
    'VT EddieTS Advanced S5 Hard',
    'poleTS',
    'FloatTS Angelic',
    'VT Speedswitch 90 Elite',
    'patCircleSwitch NR',
  ],
  Evasive: [
    'domiSwitch Harder',
    'B180T Voltaic 15% Smaller',
    'darkSwitch',
    'tamTargetSwitch Control Hard',
    'CircleTS',
    'VT FlyTS Advanced S5 Hard',
    'Jump Switching',
    'Avasive Air Switch',
  ],
};
export const ROUNDS = 3;

/** Candidates rolled for the ban phase. The two sides alternate bans until
 *  ROUNDS are left, so this must exceed ROUNDS - and by an even number, or one
 *  side gets the last ban and a free advantage. Set it to ROUNDS to skip
 *  banning entirely and go straight to a random roll. */
export const BAN_POOL = 7;
/** A side that won't ban holds the whole lobby, so the sweep bans for them. */
export const BAN_TTL_MS = 90 * 1000;

/** Which formats get a button on the queue panel. */
export const PANEL_FORMATS: Format[] = ['1v1', '2v2'];

/** How long an untaken call stays up before the sweep bins it. */
export const CALL_TTL_MS = 60 * 60 * 1000;
/** A live match force-finishes here, so one player refusing to hit Done can't
 *  hold the result open forever. */
export const MATCH_TTL_MS = 45 * 60 * 1000;
/** How often a live match re-reads scores off KovaaK's on its own. */
export const TICK_MS = 60 * 1000;
