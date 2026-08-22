const BASE = 'https://kovaaks.com/webapp-backend';

async function get<T>(path: string): Promise<T | null> {
  // ponytail: one retry, no cache, no concurrency gate - a lobby is 8 players
  // times 3 scenarios, nowhere near KovaaK's 5000/hour ceiling.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
      if (res.status >= 400 && res.status < 500) return null;
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      /* timeout or network - fall through to the retry */
    }
  }
  return null;
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
export async function kovaaksNameForDiscordId(discordId: string): Promise<string | null> {
  if (!/^\d{1,32}$/.test(discordId)) return null;
  const rows = await get<DiscordSearchEntry[]>(
    `/user/search/discord-id?discordId=${encodeURIComponent(discordId)}`,
  );
  return rows?.find((r) => r.username)?.username ?? null;
}

interface RunRow {
  score?: number;
  attributes?: { epoch?: string | number };
}

export type WindowScore = { ok: true; score: number | null } | { ok: false };

/**
 * Best run on `scenario` between `start` and `end` (epoch ms).
 *
 * Returns `{ok: false}` when KovaaK's didn't answer, which is NOT the same as
 * "they didn't play it" - a match result must never record a 0 for a blip.
 */
export async function scoreInWindow(
  username: string,
  scenario: string,
  start: number,
  end: number,
): Promise<WindowScore> {
  const params = new URLSearchParams({
    username,
    scenarioName: scenario,
    page: '0',
    max: '50',
  });
  const rows = await get<RunRow[]>(`/user/scenario/last-scores/by-name?${params}`);
  if (rows === null) return { ok: false };

  let best: number | null = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const epoch = Number(row.attributes?.epoch); // KovaaK's sends ms as a string
    if (row.score == null || !Number.isFinite(epoch)) continue;
    if (epoch < start || epoch > end) continue;
    if (best === null || row.score > best) best = row.score;
  }
  return { ok: true, score: best };
}
