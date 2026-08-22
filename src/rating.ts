import { K_FACTOR, RANKS, TIERS, TIER_SPREAD, type Tier } from './config.js';

export function rankName(elo: number) {
  return RANKS.find(([floor]) => elo >= floor)![1];
}

/** Tier gate: your tier or one either side, so a Champion can slum it one down
 *  but can't farm the bottom queue. */
export function canPlay(a: Tier, b: Tier) {
  return Math.abs(TIERS.indexOf(a) - TIERS.indexOf(b)) <= TIER_SPREAD;
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
