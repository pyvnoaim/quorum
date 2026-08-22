# scrim-bot

Pick-up games for a KovaaK's server. A host opens a match, picks players out of
the server list, they accept, everyone plays, the bot reads the scores off
KovaaK's and posts results with an Elo change.

**Nobody ever types a score.** KovaaK's already knows which account is whose
Discord, so the bot asks it directly — no screenshots, no reporting, nothing to
argue about. The only setup a player does is link their Discord inside KovaaK's.

## Running it

```bash
cp .env.example .env      # add your bot token
npm install
npm run dev
```

Needs Node 22+ (`node:sqlite` is stdlib, hence `--experimental-sqlite` in the
scripts; the flag goes away on Node 24). State lives in `pug.db` next to the
process — back that file up, it's the whole ladder.

`npm test` runs the rating self-check.

## How a match runs

1. `/pug start format:1v1|2v2|group` — opens a lobby.
2. Host picks players from the dropdown. Each one gets checked for a KovaaK's
   link and for tier eligibility before they're added.
3. Players hit **Accept**.
4. Host hits **Start** — teams are drawn, 3 scenarios are rolled (one per
   category), the clock starts.
5. Everyone plays them, in any order, as many attempts as they like. **Refresh
   scores** shows the board filling in.
6. Host hits **Finish** — placings, Elo changes and the scoreboard go to the
   results channel.

Other commands: `/pug score`, `/pug stats`, `/pug leaderboard`, and
`/pug tier @player <tier>` for staff. Everything else is a button.

## Tiers

Assigned by hand off Voltaic rank (`/pug tier`), doing two jobs: they seed a new
player's Elo, and they decide who may play whom — **your tier, or one either
side**. An elite can drop one bracket for a game, but can't farm the bottom.

That's also what removes the need for placement games: you're put where you
belong instead of playing ten to get there.

| tier | starting Elo |
| --- | --- |
| novice | 950 |
| intermediate | 1050 (default) |
| advanced | 1150 |
| elite | 1275 |

## Rating

Pairwise Elo against everyone not on your team, K=32.

- Beating someone above you is a big gain; losing to them costs almost nothing.
- A group game measures you against the whole lobby, so third of eight is a
  good night — not a loss.
- Only games you played move your rating.

Rounds are scored by **placing, then summed** — never by raw score. That's what
makes a 3000-point tracking scenario and a 90-point clicking one count equally,
with no score normalization anywhere in the code.

Display bands: Champion 1400+, Diamond 1275, Platinum 1150, Gold 1050, Silver
950, Bronze 850, Iron below.

## Editing the scenario pool

`src/config.ts`, `CATEGORIES`. Names must match KovaaK's **exactly** or the
score lookup finds nothing — copy them out of the game.
