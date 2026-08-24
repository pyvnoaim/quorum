import { K_FACTOR, PICK_POOL, ROUNDS } from './config.js';

/** Whatever ladder the caller holds - a server's rows, or DEFAULT_RANKS. */
export interface Band {
  name: string;
  min_elo: number;
  color?: string;
}

/** Highest band the Elo clears. Sorted here rather than trusted, since an
 *  edited ladder arrives in whatever order the dashboard sent it. */
export function rankFor<T extends Band>(ranks: T[], elo: number): T | undefined {
  return [...ranks].sort((a, b) => b.min_elo - a.min_elo).find((r) => elo >= r.min_elo);
}

/** The band a member's DIVISION ROLE puts them in - manual mode's answer to
 *  rankFor(). Highest wins, so an old role left on someone can't demote them.
 *  Undefined means staff have not placed them yet, which is not a queue. */
export function rankForRoles<T extends Band & { discord_role_id: string | null }>(
  ranks: T[],
  held: Iterable<string>,
): T | undefined {
  const have = new Set(held);
  return [...ranks]
    .sort((a, b) => b.min_elo - a.min_elo)
    .find((r) => r.discord_role_id && have.has(r.discord_role_id));
}

export function rankName(ranks: Band[], elo: number) {
  return rankFor(ranks, elo)?.name ?? '';
}

/** Rank gate. `spread` is how many bands apart the two may be: 0 means the
 *  same rank only, 1 means the band either side. Measured in bands rather than
 *  raw Elo so the gate moves with the ladder a server actually edited.
 *  Off the ladder entirely (no band clears) can't be matched at all. */
export function canPlay(ranks: Band[], eloA: number, eloB: number, spread: number) {
  const order = [...ranks].sort((a, b) => b.min_elo - a.min_elo);
  const a = order.findIndex((r) => eloA >= r.min_elo);
  const b = order.findIndex((r) => eloB >= r.min_elo);
  if (a < 0 || b < 0) return false;
  return Math.abs(a - b) <= spread;
}

/** The bands a queue at this spread will admit, given one player's rating.
 *  Same index arithmetic as canPlay, so what gets pinged is exactly what gets
 *  let in - the two must never disagree. */
export function bandsInReach<T extends Band>(ranks: T[], elo: number, spread: number): T[] {
  const order = [...ranks].sort((a, b) => b.min_elo - a.min_elo);
  const at = order.findIndex((r) => elo >= r.min_elo);
  if (at < 0) return [];
  return order.slice(Math.max(0, at - spread), at + spread + 1);
}

/**
 * Where one scenario's ban-ban-pick has got to, from nothing but how much of
 * its shortlist is gone. Deriving it is what keeps the whole phase to one
 * column and makes it impossible for the turn to drift out of sync.
 *
 * `picked` is how many scenarios are already locked in, and it alternates who
 * holds the pick: side 0 takes the first, side 1 the second. The picker bans
 * FIRST and the other side bans second, so the last ban lands against the pick
 * rather than with it.
 *
 * A shortlist too small for two bans still ends in a pick - something has to be
 * left to play.
 */
export function pickTurn(picked: number, poolLeft: number, size: number) {
  const bans = Math.max(0, Math.min(2, size - 1));
  const done = size - poolLeft;
  const picker = picked % 2;
  const action = done >= bans ? ('pick' as const) : ('ban' as const);
  return {
    action,
    picker,
    turn: action === 'pick' || done === 0 ? picker : 1 - picker,
    bansLeft: Math.max(0, bans - done),
  };
}

/** What a pick phase stores: the scenarios locked in so far, the category each
 *  one is drawn from, and the shortlist on the table right now. `size` is what
 *  that shortlist started at - the only way to know how many bans have landed,
 *  since the pool shrinks in place. */
export interface PickPhase {
  picked: string[];
  cats: string[];
  pool: string[];
  size: number;
}

/**
 * One step of the pick phase: takes `index` off the table - as a ban, or as the
 * pick - and moves on to the next scenario when a pick lands.
 *
 * Returns the phase to store, or the finished scenario list once the last one
 * is settled. `roll` is how it asks for candidates, so the database lives on
 * the other side of a callback and the sequence itself stays a pure function.
 */
export function advancePick(
  phase: PickPhase,
  index: number,
  roll: (category: string, want: number, taken: string[]) => string[],
  rounds = ROUNDS,
  poolSize = PICK_POOL,
): { phase: PickPhase } | { scenarios: string[] } {
  const { action } = pickTurn(phase.picked.length, phase.pool.length, phase.size);
  const pool = [...phase.pool];
  const [taken] = pool.splice(index, 1);
  if (taken === undefined) return { phase };
  if (action === 'ban') return { phase: { ...phase, pool } };

  const picked = [...phase.picked, taken];
  // The last scenario is nobody's pick: it is rolled from its own category once
  // the others are settled, so neither side gets to shape the whole match.
  if (picked.length >= rounds - 1) {
    const [last] = roll(phase.cats[rounds - 1] ?? '', 1, picked);
    return { scenarios: last ? [...picked, last] : picked };
  }
  const next = roll(phase.cats[picked.length] ?? '', poolSize, picked);
  // Nothing left to offer - the pool was emptied or rewritten mid-match. Play
  // what is already settled rather than stalling in a phase with no buttons in
  // it, which nobody and no sweep could ever finish.
  if (!next.length) return { scenarios: picked };
  return { phase: { picked, cats: phase.cats, pool: next, size: next.length } };
}

/**
 * Nothing left to play: every player has put in their full count of runs on
 * every scenario.
 *
 * This is the ONLY thing that ends a match on its own. A score arriving is not
 * enough - a second and third run can still beat it, and someone who stopped at
 * two has not played the format. Anyone short keeps the match open until the
 * clock runs out, which is what the no-show guard covers on the other side.
 */
export function allRunsUsed(
  scenarios: string[],
  players: Record<string, number>[],
  want: number,
) {
  if (!players.length || !scenarios.length) return false;
  return players.every((runs) => scenarios.every((s) => (runs[s] ?? 0) >= want));
}

export interface Entrant {
  id: string;
  elo: number;
  team: number;
  /** score per scenario; null = didn't play it (counts as 0, but is shown as "-") */
  scores: Record<string, number | null>;
}

/**
 * Who a match is actually scored over.
 *
 * A player whose every scenario came back null never launched the game - a
 * crash, or a no-show. Scoring them hands their opponent free Elo and hands
 * them a loss for a game nobody played, so they are left out of the maths
 * entirely: no placing, no rating change, no W/L.
 *
 * Fewer than two sides left means there was no contest - an empty list, and the
 * caller voids the match. That covers "nobody ran anything" too.
 */
export function scorable(entrants: Entrant[]): Entrant[] {
  const played = entrants.filter((e) => Object.values(e.scores).some((s) => s !== null));
  return new Set(played.map((e) => e.team)).size >= 2 ? played : [];
}

/**
 * Final placing per team, 1 = best.
 *
 * Rounds are scored by PLACING, not by raw score, and then summed - which is
 * what sidesteps score normalization entirely. A 3000-point tracking scenario
 * and a 90-point clicking one would otherwise let one round decide the match.
 */
export function placings(entrants: Entrant[], scenarios: string[]): Map<number, number> {
  const teams = [...new Set(entrants.map((e) => e.team))];
  const points = new Map(teams.map((t) => [t, 0]));

  for (const scenario of scenarios) {
    const totals = teams.map((team) => ({
      team,
      total: entrants
        .filter((e) => e.team === team)
        .reduce((sum, e) => sum + (e.scores[scenario] ?? 0), 0),
    }));
    totals.sort((a, b) => b.total - a.total);
    totals.forEach((row) => {
      // ties share the better placing, so an exact draw can't split the round
      const tiedWith = totals.findIndex((r) => r.total === row.total);
      points.set(row.team, points.get(row.team)! + tiedWith + 1);
    });
  }

  const ordered = [...points.entries()].sort((a, b) => a[1] - b[1]);
  const placing = new Map<number, number>();
  ordered.forEach(([team, pts]) => {
    const tiedWith = ordered.findIndex(([, p]) => p === pts);
    placing.set(team, tiedWith + 1);
  });
  return placing;
}

/**
 * Elo delta per player, pairwise against everyone NOT on their team.
 *
 * Pairwise is what makes "beat someone above you and it's a big gain" fall out
 * for free, and what makes a group game measure you against the whole lobby
 * rather than just the winner. Teammates are skipped - you learn nothing about
 * two players from the fact that they were on the same side.
 */
export function eloDeltas(entrants: Entrant[], placing: Map<number, number>, k = K_FACTOR) {
  const deltas = new Map<string, number>();
  for (const me of entrants) {
    const opponents = entrants.filter((o) => o.team !== me.team);
    if (!opponents.length) {
      deltas.set(me.id, 0);
      continue;
    }
    let actual = 0;
    let expected = 0;
    for (const opp of opponents) {
      const mine = placing.get(me.team)!;
      const theirs = placing.get(opp.team)!;
      actual += mine < theirs ? 1 : mine === theirs ? 0.5 : 0;
      expected += 1 / (1 + 10 ** ((opp.elo - me.elo) / 400));
    }
    deltas.set(me.id, Math.round((k * (actual - expected)) / opponents.length));
  }
  return deltas;
}
