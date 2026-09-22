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
 * A score arriving is not enough - a second and third run can still beat it,
 * and someone who stopped at two has not played the format.
 *
 * Called with one player's counts it answers the same question for them alone,
 * which is what opens the grace window in matchDeadline(). Anyone still short
 * when that runs out forfeits what they didn't play - see forfeitUnused().
 */
export function allRunsUsed(
  scenarios: string[],
  players: Record<string, number>[],
  want: number,
) {
  if (!players.length || !scenarios.length) return false;
  return players.every((runs) => scenarios.every((s) => (runs[s] ?? 0) >= want));
}

/**
 * Runs you didn't use score nothing.
 *
 * The cap only ever bound the top - best of the FIRST `want`, so a fourth run
 * gains nothing. It never bound the bottom, and that was the hole: stopping at
 * one run left that run standing as your score AND kept allRunsUsed() from
 * ending the match, so a player could hold the lobby open to the clock while
 * fishing that single run out of unlimited resets. KovaaK's never reports a
 * reset - a run you abort is a run that never happened - so "use your runs" is
 * the only half of the rule the bot can actually enforce.
 *
 * A scenario never launched stays null rather than becoming 0. That is "no runs
 * at all", which scorable() still has to be able to tell apart from a game that
 * was played: a crash before the first shot is not a game somebody lost.
 */
export function forfeitUnused(
  scores: Record<string, number | null>,
  runCounts: Record<string, number> | null,
  scenarios: string[],
  want: number,
): Record<string, number | null> {
  // No counts at all is a row from before the bot recorded them. "We never
  // looked" is not "they never played", and reading it as the latter would
  // forfeit a whole match that was played out properly.
  if (!runCounts) return { ...scores };
  const out = { ...scores };
  for (const scenario of scenarios) {
    if (out[scenario] != null && (runCounts[scenario] ?? 0) < want) out[scenario] = 0;
  }
  return out;
}

/**
 * The forfeit as it actually applies, for everyone in the match at once.
 *
 * Per-scenario forfeits alone still leave a strategy: give up one scenario on
 * purpose, spend the whole clock fishing the other two, and take it 2-1. Rounds
 * are scored by placing and summed, so a round you never contest costs you
 * exactly one round - a price somebody can decide is worth paying, which makes
 * "three runs each" a suggestion.
 *
 * So it is all or nothing, but only against someone who played it out: if ANY
 * player used every run on every scenario, a player who did not forfeits the
 * whole match rather than the scenarios they were short on. Where nobody
 * finished there is nobody to have beaten, and it falls back to the per-
 * scenario forfeit so two half-played sides are still scored on what they ran.
 *
 * Whole-match forfeit is just forfeitUnused() with no runs to its name, which
 * keeps one mechanism instead of two that have to agree.
 */
export function forfeits(
  players: { id: string; scores: Record<string, number | null>; runCounts: Record<string, number> | null }[],
  scenarios: string[],
  want: number,
): Map<string, Record<string, number | null>> {
  // A row with no counts predates the bot recording them: "we never looked" is
  // not "they never played", so it neither forfeits nor demotes anyone else.
  const played = players.map((p) => !p.runCounts || allRunsUsed(scenarios, [p.runCounts], want));
  const anyone = played.some(Boolean);
  return new Map(
    players.map((p, i) => [
      p.id,
      forfeitUnused(p.scores, anyone && !played[i] ? {} : p.runCounts, scenarios, want),
    ]),
  );
}

/**
 * When a live match actually ends. Three terms, and the order matters:
 *
 *  - the hard TTL, the backstop for a lobby where nobody ever finishes;
 *  - a grace window opening the moment the FIRST player has used every run, so
 *    finishing puts your opponent on a clock instead of putting you on a wait.
 *    Without it, playing the format promptly is punished: you sit there while
 *    whoever is stalling keeps fishing;
 *  - a floor under the whole match, because the grace has a griefing edge -
 *    nine deliberately terrible runs in four minutes would otherwise start a
 *    countdown on somebody whose game is still loading.
 *
 * `graceFrom` is null until somebody finishes; after that the match ends at
 * whichever of the grace and the floor falls LATER, bounded by the TTL either
 * way.
 */
export function matchDeadline(
  startedAt: number,
  graceFrom: number | null,
  cfg: { matchTtlMin: number; graceMin: number; minMatchMin: number },
) {
  const hard = startedAt + cfg.matchTtlMin * 60_000;
  if (!graceFrom) return hard;
  return Math.min(
    hard,
    Math.max(graceFrom + cfg.graceMin * 60_000, startedAt + cfg.minMatchMin * 60_000),
  );
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
/** Which team took each scenario, in the order they were played, or null where
 *  nobody did - a tie splits the round, and a scenario nobody scored on was not
 *  won by anyone either.
 *
 *  Same team totals placings() adds up, kept per scenario instead of summed, so
 *  a result can say 2-1 rather than only who came first. The two must agree:
 *  this is the working, that is the answer. */
export function scenarioWinners(entrants: Entrant[], scenarios: string[]): (number | null)[] {
  const teams = [...new Set(entrants.map((e) => e.team))];
  return scenarios.map((scenario) => {
    const totals = teams.map((team) => ({
      team,
      total: entrants
        .filter((e) => e.team === team)
        .reduce((sum, e) => sum + (e.scores[scenario] ?? 0), 0),
    }));
    const best = Math.max(...totals.map((t) => t.total));
    const top = totals.filter((t) => t.total === best);
    return best > 0 && top.length === 1 ? top[0].team : null;
  });
}

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

/** One game of a duo veto: its category, which side runs the veto inside it,
 *  the subcategories still standing, and the two scenarios the survivor put
 *  on the table. `size` is how many subcategories it started with - the only
 *  way to count the bans, since `subs` shrinks in place. */
export interface DuoGame {
  main: string;
  by: number;
  subs: string[];
  size: number;
  tasks: string[];
  task?: string;
}

/**
 * The tournament veto, for 2v2. `hi` is the higher seed's team.
 *
 *  - duo 1: both sides ban a main (higher first); the higher seed bans two
 *    subcategories and the lower one, then the higher seed picks one of two.
 *  - duo 3: the higher seed picks game 1's main and the lower game 2's, the
 *    leftover is game 3. In each game the side that did NOT pick the main runs
 *    its veto (game 3: the higher seed), same shape as above.
 *
 * `mainsSize` is what `mains` started at, for counting duo 1's bans. `log` is
 * only for the embed.
 */
export interface DuoVeto {
  duo: 1 | 3;
  hi: number;
  mains: string[];
  mainsSize: number;
  games: DuoGame[];
  log: { turn: number; action: 'ban' | 'pick'; name: string }[];
}

export interface DuoRoll {
  subs: (main: string) => string[];
  tasks: (main: string, sub: string) => string[];
}

/** Whose turn it is and what they choose from, or null once every game has
 *  its scenario. Derived, like pickTurn(), so the turn cannot drift. */
export function duoStep(v: DuoVeto) {
  if (v.mains.length > 1) {
    return v.duo === 1
      ? {
          action: 'ban' as const,
          level: 'category',
          turn: (v.mainsSize - v.mains.length) % 2 === 0 ? v.hi : 1 - v.hi,
          options: v.mains,
        }
      : {
          action: 'pick' as const,
          level: `game ${v.games.length + 1}'s category`,
          turn: v.games.length === 0 ? v.hi : 1 - v.hi,
          options: v.mains,
        };
  }
  const game = v.games.find((g) => !g.task);
  if (!game) return null;
  if (game.subs.length > 1) {
    // ban, ban, then the other side's ban - so four subcategories go 2-1 and
    // the side running the veto still ends it with the pick.
    const done = game.size - game.subs.length;
    return {
      action: 'ban' as const,
      level: `${game.main} subcategory`,
      turn: done % 3 < 2 ? game.by : 1 - game.by,
      options: game.subs,
    };
  }
  return { action: 'pick' as const, level: `${game.main} · ${game.subs[0]}`, turn: game.by, options: game.tasks };
}

/** Everything that happens without anyone choosing: the last main standing
 *  becomes a game (vetoed by the higher seed - the leftover in a bo3, the only
 *  one in a bo1), a lone subcategory rolls its two scenarios, and a choice of
 *  one is taken. A game whose subcategory rolled nothing is dropped rather than
 *  left with no buttons in it. */
function settle(v: DuoVeto, roll: DuoRoll): DuoVeto {
  const next = { ...v, games: v.games.map((g) => ({ ...g })) };
  for (;;) {
    if (next.mains.length === 1) {
      const [main] = next.mains;
      const subs = roll.subs(main);
      next.mains = [];
      if (subs.length) next.games.push({ main, by: next.hi, subs, size: subs.length, tasks: [] });
      continue;
    }
    const game = next.games.find((g) => !g.task);
    if (next.mains.length || !game || game.subs.length > 1) return next;
    if (!game.tasks.length) {
      game.tasks = roll.tasks(game.main, game.subs[0]);
      if (!game.tasks.length) next.games.splice(next.games.indexOf(game), 1);
      else if (game.tasks.length > 1) return next;
    }
    if (game.tasks.length === 1) game.task = game.tasks[0];
  }
}

/** A fresh veto, already moved past anything nobody has to choose. */
export function startDuo(duo: 1 | 3, hi: number, mains: string[], roll: DuoRoll) {
  return settle({ duo, hi, mains, mainsSize: mains.length, games: [], log: [] }, roll);
}

/** One ban or pick, by index into duoStep's options. Returns the veto to store,
 *  or the scenarios once every game has one. An index that isn't there changes
 *  nothing. */
export function advanceDuo(
  v: DuoVeto,
  index: number,
  roll: DuoRoll,
): { veto: DuoVeto } | { scenarios: string[] } {
  const step = duoStep(v);
  const taken = step?.options[index];
  if (!step || taken === undefined) return { veto: v };
  const next: DuoVeto = { ...v, games: v.games.map((g) => ({ ...g })), log: [...v.log] };
  const game = next.games.find((g) => !g.task);
  if (next.mains.length > 1) {
    next.mains = next.mains.filter((m) => m !== taken);
    if (v.duo === 3) {
      const subs = roll.subs(taken);
      if (subs.length) next.games.push({ main: taken, by: 1 - step.turn, subs, size: subs.length, tasks: [] });
    }
  } else if (game && game.subs.length > 1) {
    game.subs = game.subs.filter((s) => s !== taken);
  } else if (game) {
    game.task = taken;
  }
  next.log.push({ turn: step.turn, action: step.action, name: taken });
  const settled = settle(next, roll);
  return duoStep(settled)
    ? { veto: settled }
    : { scenarios: settled.games.map((g) => g.task!) };
}
