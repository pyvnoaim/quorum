import { RECORD_RETRY_MS, RECORD_TTL_MS, RUNS_PER_SCENARIO } from './config.js';

const BASE = 'https://kovaaks.com/webapp-backend';
/** Community benchmark index. Not KovaaK's, and not required - a server that
 *  can't reach it just shows no Voltaic ranks. */
const EVXL = 'https://api.evxl.app';

/** "they have no link" and "we couldn't ask" must never collapse into one
 *  answer: telling someone to go link an account that is already linked sends
 *  them off to fix something that isn't broken. A 4xx is the service answering
 *  "no"; anything else is us failing to reach it. */
export type Fetched<T> = { ok: true; data: T } | { ok: false; reachable: boolean };

async function get<T>(path: string, base = BASE): Promise<Fetched<T>> {
  // ponytail: one retry, no cache, no concurrency gate - a lobby is 8 players
  // times 3 scenarios, nowhere near KovaaK's 5000/hour ceiling.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(base + path, {
        // identity encoding dodges an undici decompression-teardown crash, and
        // an honest user-agent is the polite way to use someone's open api.
        headers: { accept: 'application/json', 'accept-encoding': 'identity', 'user-agent': 'quorum/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status >= 400 && res.status < 500) return { ok: false, reachable: true };
      if (!res.ok) continue;
      return { ok: true, data: (await res.json()) as T };
    } catch {
      /* timeout or network - fall through to the retry */
    }
  }
  return { ok: false, reachable: false };
}

interface DiscordSearchEntry {
  username?: string;
  steamId?: string;
}

/**
 * Discord id -> KovaaK's account. This is the whole identity story: KovaaK's
 * already stores the Discord link, so nobody can claim someone else's scores and
 * there is nothing for a player to type. No link on file = they can't be added
 * to a match.
 */
export type Lookup =
  | { kind: 'found'; username: string; steamId: string | null }
  | { kind: 'not-linked' }
  | { kind: 'unreachable' };

export async function kovaaksAccountForDiscordId(discordId: string): Promise<Lookup> {
  if (!/^\d{1,32}$/.test(discordId)) return { kind: 'not-linked' };
  const res = await get<DiscordSearchEntry[]>(
    `/user/search/discord-id?discordId=${encodeURIComponent(discordId)}`,
  );
  if (!res.ok) return res.reachable ? { kind: 'not-linked' } : { kind: 'unreachable' };
  const row = res.data.find((r) => r.username);
  // an empty list IS the answer: KovaaK's has no link for that discord id.
  return row
    ? { kind: 'found', username: row.username!, steamId: row.steamId ?? null }
    : { kind: 'not-linked' };
}

interface RankRow {
  benchmarkName?: string;
  difficultyName?: string;
  rank?: number;
  rankName?: string;
}

/** The index answers in mixed case, ALL CAPS included, and marks completion
 *  with a " Complete" suffix rather than a field. */
function tidyRank(name: string) {
  return name
    .replace(/\s+complete$/i, '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Voltaic S5 standing, by Steam id. Null covers both "no S5 entry" and "the
 * index didn't answer" on purpose - neither is an error worth surfacing, and
 * plenty of players have never run the benchmark.
 */
export async function voltaicS5(steamId: string) {
  const res = await get<{ results?: RankRow[] }>(
    `/profile-ranks?steamId=${encodeURIComponent(steamId)}&mode=kovaaks`,
    EVXL,
  );
  if (!res.ok) return null;
  // One row per benchmark, already the highest difficulty they reached.
  const row = (res.data.results ?? []).find((r) => r.benchmarkName === 'Voltaic S5' && r.rankName);
  if (!row || (row.rank ?? 0) <= 0) return null;
  const rank = tidyRank(row.rankName!);
  // unranked is not a rank - showing "S5 Unranked" is worse than showing nothing
  if (rank === 'Unranked' || rank === 'No Rank') return null;
  return { rank, difficulty: row.difficultyName ?? '', complete: / complete$/i.test(row.rankName!) };
}

interface PopularRow {
  scenarioName?: string;
  leaderboardId?: number;
  scenario?: { aimType?: string | null };
  counts?: { plays?: number };
  topScore?: { score?: number };
}

/**
 * Scenario name search. The pool has to hold names KovaaK's recognises exactly
 * or the score lookup silently finds nothing, so the dashboard offers real ones
 * instead of asking anyone to type them.
 */
export async function searchScenarios(term: string) {
  const params = new URLSearchParams({ page: '0', max: '12', scenarioNameSearch: term });
  const res = await get<{ data?: PopularRow[] }>(`/scenario/popular?${params}`);
  return (res.ok ? (res.data.data ?? []) : [])
    .filter((r) => r.scenarioName)
    .map((r) => ({
      name: r.scenarioName!,
      aimType: r.scenario?.aimType ?? '',
      plays: r.counts?.plays ?? 0,
    }));
}

/** Scenario name (lowercased) -> the bar a score has to clear to be worth
 *  checking properly, and when to stop believing it. Cached for a day BECAUSE
 *  it is only a screen: a stale one lets through a few scores that then fail
 *  the real check, which costs a request and nothing else. A miss is cached
 *  too, or a scenario KovaaK's has never heard of is asked about after every
 *  match. */
const records = new Map<string, { until: number; score: number | null; board: number | null }>();

async function topOf(scenario: string) {
  const key = scenario.toLowerCase();
  const hit = records.get(key);
  if (hit && Date.now() < hit.until) return hit;

  // Deep enough to find the exact name. The search is a substring match ordered
  // by plays, so a scenario with a big family of more-popular remixes is not in
  // the first handful of its own results.
  const params = new URLSearchParams({ page: '0', max: '50', scenarioNameSearch: scenario });
  const res = await get<{ data?: PopularRow[] }>(`/scenario/popular?${params}`);
  // Whatever was known, kept, and not asked for again for a few minutes: an
  // outage must not cost every match that ends during it the full timeout.
  const row = res.ok
    ? (res.data.data ?? []).find((r) => r.scenarioName?.toLowerCase() === key)
    : null;
  const fresh = res.ok
    ? {
        until: Date.now() + RECORD_TTL_MS,
        score: row?.topScore?.score ?? null,
        board: row?.leaderboardId ?? null,
      }
    : {
        until: Date.now() + RECORD_RETRY_MS,
        score: hit?.score ?? null,
        board: hit?.board ?? null,
      };
  records.set(key, fresh);
  return fresh;
}

/**
 * The bar: the best score anyone on earth has on this scenario, as far as the
 * popular list knows. Null when KovaaK's has no record for it or has never
 * heard of the name.
 *
 * Good enough to ask "could that have been a world record?" and not good enough
 * to answer it - the list is cached at both ends, ours and theirs. Anything that
 * clears it goes to worldRecordHolder().
 */
export async function worldRecord(scenario: string) {
  return (await topOf(scenario))?.score ?? null;
}

/**
 * Who actually holds the scenario, off the global leaderboard itself: the one
 * row that is rank 1 right now.
 *
 * This is the check that gets announced, so it is the authoritative one. A score
 * that merely beats the cached number proves nothing - the cache can be a day
 * behind, and "X set a world record" is not something to be wrong about in
 * front of a server. Two requests, and only ever for a score that has already
 * cleared the bar, which is a handful of times a year.
 */
export async function worldRecordHolder(scenario: string) {
  const top = await topOf(scenario);
  if (!top?.board) return null;
  const params = new URLSearchParams({ leaderboardId: String(top.board), page: '0', max: '1' });
  const res = await get<{ data?: { score?: number; steamId?: string }[] }>(
    `/leaderboard/scores/global?${params}`,
  );
  const row = res.ok ? res.data.data?.[0] : null;
  return row?.score == null ? null : { score: row.score, steamId: row.steamId ?? null };
}

interface RunRow {
  score?: number;
  attributes?: { epoch?: string | number };
}

export type WindowScore =
  | {
      ok: true;
      score: number | null;
      prior: number | null;
      runs: number;
      /** When the last counted run landed - null until they have all of them. */
      capAt: number | null;
      /** Every run past the cap as [epoch ms, score], oldest first. */
      extra: [number, number][];
    }
  | { ok: false };

/**
 * Their score on `scenario` for a match running from `start` to `end` (epoch
 * ms): the best of their FIRST `runsCounted` runs inside that window.
 *
 * Ordering by run time rather than by score is the whole point - it is what
 * makes "three runs each" a rule the bot enforces instead of an honour system.
 * A fourth run does not count, so nobody gains by grinding while their opponent
 * stops at three, and a score can only settle upwards as those three land.
 *
 * `runs` is how many they have actually put in - the whole list, not the capped
 * three - which is what lets a match end itself the moment nobody has a run
 * left to play.
 *
 * `prior` is their best from before the window - the same page of runs already
 * holds it, so "beat your best" costs no extra request. It only goes as deep as
 * the last 50 runs, so it is a recent best rather than a lifetime one.
 *
 * Returns `{ok: false}` when KovaaK's didn't answer, which is NOT the same as
 * "they didn't play it" - a match result must never record a 0 for a blip.
 */
export async function scoreInWindow(
  username: string,
  scenario: string,
  start: number,
  end: number,
  runsCounted = RUNS_PER_SCENARIO,
): Promise<WindowScore> {
  const params = new URLSearchParams({
    username,
    scenarioName: scenario,
    page: '0',
    max: '50',
  });
  const res = await get<RunRow[]>(`/user/scenario/last-scores/by-name?${params}`);
  // A 4xx here is KovaaK's answering "no runs for that user and scenario",
  // which is a real null score. Only an unreachable service must leave what is
  // already recorded alone.
  if (!res.ok)
    return res.reachable
      ? { ok: true, score: null, prior: null, runs: 0, capAt: null, extra: [] }
      : { ok: false };

  const runs: { epoch: number; score: number }[] = [];
  let prior: number | null = null;
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const epoch = Number(row.attributes?.epoch); // KovaaK's sends ms as a string
    if (row.score == null || !Number.isFinite(epoch)) continue;
    if (epoch > end) continue;
    if (epoch < start) {
      if (prior === null || row.score > prior) prior = row.score;
      continue;
    }
    runs.push({ epoch, score: row.score });
  }
  // Oldest first: the cap has to fall on the LAST runs, not the worst ones.
  runs.sort((a, b) => a.epoch - b.epoch);
  const counted = runs.slice(0, Math.max(1, runsCounted));
  return {
    ok: true,
    score: counted.length ? Math.max(...counted.map((r) => r.score)) : null,
    prior,
    runs: runs.length,
    // Everything past the cap, in order - a duo's sudden death, see
    // suddenDeath() in rating.ts. Nothing else reads it.
    capAt: runs.length >= runsCounted ? counted[counted.length - 1].epoch : null,
    extra: runs.slice(counted.length).map((r) => [r.epoch, r.score]),
  };
}
