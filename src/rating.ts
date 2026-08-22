import { K_FACTOR } from './config.js';

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

/** Whose turn it is and how many bans are left, from nothing but how much of
 *  the pool is gone. Deriving both is what keeps a ban phase to one column and
 *  makes it impossible for the turn to drift out of sync with the pool. */
export function banTurn(remaining: number, poolSize: number, rounds: number) {
  return { turn: (poolSize - remaining) % 2, left: remaining - rounds };
}

export interface Entrant {
  id: string;
  elo: number;
  team: number;
  /** score per scenario; null = didn't play it (counts as 0, but is shown as "-") */
  scores: Record<string, number | null>;
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
