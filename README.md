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

`/pug panel` once, in the queue channel — one message with a **1v1** and a
**2v2** button that stays there forever. Then:

1. Someone hits **1v1**. The bot posts their call in the channel: _looking for a
   1v1_.
2. Someone else hits **Scrim** on it. That's the whole matchmaking.
3. The moment it fills it starts itself — teams drawn, 3 scenarios rolled (one
   per category), a temporary voice channel made and everyone dragged in.
4. The call message becomes the live scoreboard: scenarios, players, scores
   filling in. **Refresh scores** re-reads KovaaK's.
5. **Finish** posts placings and Elo changes to the results channel, deletes the
   call message, and deletes the voice channel.

Other commands: `/pug score`, `/pug stats`, `/pug leaderboard`, and
`/pug tier @player <tier>` for staff. Everything else is a button.

Set `VOICE_CATEGORY_ID` for the voice half. The bot needs **Manage Channels**
and **Move Members** for it, and only someone already sitting in a voice channel
can be dragged — everyone else gets the channel link in the match message,
which is as far as Discord lets a bot go.

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
