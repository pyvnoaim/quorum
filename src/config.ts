/** Everything you'd want to tune without reading the rest of the bot. */

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
/** Your tier or one either side. Set to 0 to lock people to their own tier. */
export const TIER_SPREAD = 1;

/** Display bands. Elo is the truth, this is just the word next to it. */
export const RANKS: [floor: number, name: string][] = [
  [1400, 'Champion'],
  [1275, 'Diamond'],
  [1150, 'Platinum'],
  [1050, 'Gold'],
  [950, 'Silver'],
  [850, 'Bronze'],
  [0, 'Iron'],
];

export const K_FACTOR = 32;

/** Rolled from at match start, one per category where the round count allows.
 *  Names must match KovaaK's EXACTLY or the score lookup finds nothing - copy
 *  them out of the game, not off a spreadsheet.
 *  ponytail: categories are here because a ban/pick format (EmoAim) needs them;
 *  the base bot only uses them to spread the roll. */
export const CATEGORIES: Record<string, string[]> = {
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

/** Which formats get a button on the queue panel. */
export const PANEL_FORMATS: Format[] = ['1v1', '2v2'];

/** How long an untaken call stays up before the sweep bins it. */
export const CALL_TTL_MS = 60 * 60 * 1000;
