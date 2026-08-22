# Quorum

<img src="assets/quorum-mark.svg" width="56" alt="" />

_Enough players, and it counts._

Pick-up games for a KovaaK's server. A host opens a match, picks players out of
the server list, they accept, everyone plays, the bot reads the scores off
KovaaK's and posts results with an Elo change.

**Nobody ever types a score.** KovaaK's already knows which account is whose
Discord, so the bot asks it directly - no screenshots, no reporting, nothing to
argue about. The only setup a player does is link their Discord inside KovaaK's.

## Running it

```bash
cp .env.example .env      # add your bot token
npm install
npm run dev
```

Needs Node 22+ (`node:sqlite` is stdlib, hence `--experimental-sqlite` in the
scripts; the flag goes away on Node 24). State lives in `pug.db` next to the
process - back that file up, it's the whole ladder.

`npm test` runs the self-checks (rating maths, ranks/pool/tiers).

### In Docker

`docker-compose.yml` in the repo is the whole thing. `DB_PATH` already points at
`/data/pug.db` in the image, so the `quorum-db` volume IS the ladder - back it
up, losing it loses every rating and every record.

## Deploying (Portainer + Nginx Proxy Manager)

**1. DNS.** An `A` record for the domain (say `quorum.example.com`) pointing at
the VPS. Nothing else - NPM terminates TLS.

**2. The stack.** Portainer > Stacks > Add stack > **Repository**:

| field | value |
| --- | --- |
| Repository URL | `https://github.com/pyvnoaim/quorum` |
| Compose path | `docker-compose.yml` |
| Authentication | on - GitHub username + a PAT with `repo` (the repo is private) |

Then set these environment variables in the same screen:

```
DISCORD_BOT_TOKEN=…
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
WEB_URL=https://quorum.example.com
PROXY_NETWORK=npm_default
ALLOWED_GUILD_IDS=1540423662753288192
```

`ALLOWED_GUILD_IDS` pins the bot to one server (comma-separate for more). It
leaves anywhere else the moment it is added - and on boot, since it can be added
while offline - and the dashboard won't list those servers either, so a leaked
invite link can't park it somewhere quietly. Leave it empty for no limit.

`WEB_URL` must be the public **https** URL: it is what the OAuth redirect is
built from, and it is what puts `Secure` on the session cookie.

`PROXY_NETWORK` is whatever docker network your NPM container is on
(`docker inspect <npm-container> -f '{{json .NetworkSettings.Networks}}'`). The
stack joins it rather than publishing a port, so the dashboard cannot be
reached except through the proxy.

**3. The proxy host.** In NPM, Hosts > Proxy Hosts > Add:

| field | value |
| --- | --- |
| Domain | `quorum.example.com` |
| Scheme | `http` |
| Forward hostname | `quorum` |
| Forward port | `3000` |
| Block common exploits | on |
| Websockets | off - nothing here uses them |

SSL tab: request a new Let's Encrypt certificate, **Force SSL** and HTTP/2 on.

**4. Discord.** In the developer portal, OAuth2 > Redirects, add exactly:

```
https://quorum.example.com/callback
```

Discord matches it character for character, so no trailing slash. The bot needs
the **Server Members** intent left OFF and **Server Voice States** ON.

### When it doesn't come up

- **502 from the domain.** The container is crash-looping, almost always a bad
  `DISCORD_BOT_TOKEN` - the bot logs in before it ever serves HTTP, so an
  invalid token means there is nothing listening. `docker logs quorum`.
- **The dashboard says the bot isn't in that server.** It is in Discord but not
  in the gateway cache yet; give it a few seconds after a restart.
- **`bad oauth state` on sign-in.** `WEB_URL` doesn't match the redirect URI
  registered in the developer portal.
- **Everyone signed out after a deploy.** Expected: sessions are in memory, so
  a restart clears them. A settings page is not worth a session store.

## Setup (the dashboard)

Open `WEB_URL` in a browser and sign in with Discord. You get the servers where
you have **Manage Server** - the same bar Discord uses for adding a bot. Servers
without the bot link straight to the invite; the rest open a settings page:

- **Queue channel** - where the panel and open calls live
- **Results channel** - where finished matches get posted
- **Voice category** - where match voice channels are made, with a button to
  create one if you haven't
- **Extra ping role** - for people who want notifying about every call. The
  ranks a call can actually admit are pinged automatically
- **Ranks** - add, remove, rename, recolour and set the threshold of every rank.
  Each one becomes a real Discord role, created and kept in sync by the bot
- **Scenario pool** - categories you add and remove, each holding scenarios
  picked from a live KovaaK's search, so a name can never be a typo
- **Queues** - how many rank bands apart a queue lets people be, per format,
  and whether to run **a channel per rank** (below)
- **Players** - Elo, rank, Voltaic S5 standing, and the tier of anyone who
  hasn't played yet
- **Overview** - the server's numbers and what is still unconfigured

Then hit **Post panel** and the queue message goes up. That's the whole setup;
there are no configuration commands.

Add `WEB_URL/callback` to the OAuth redirects on your Discord application, and
give the bot **Manage Channels** + **Move Members** for the voice half.

## A channel per rank

Off by default, and most servers should leave it that way. On, Quorum keeps a
Discord category per rank holding `<rank>-1v1`, `<rank>-2v2`, `<rank>-group` and
`<rank>-results`, and posts the right single-format panel in each.

**The ladder is the only source of truth.** Rename a rank and its category and
channels rename with it; delete a rank and they are deleted; turn the mode off
and every channel it made is removed. Nothing is ever recreated in place of
something that already exists, so a rename keeps the channel and its history.
Four ranks means four categories and sixteen channels - if that is too many,
shorten the ladder, because the ladder is what decides.

**The gate is forced to same-rank-only while it is on.** A channel called
`elite-2v2` that admits an Advanced player is a channel whose name is a lie, so
the per-format spread is ignored and the dashboard says so. Your saved spread
comes back untouched when you turn the mode off.

Channels are deliberately **not** locked to their rank role. A player has no
rank role until their first match finishes, so locking would leave every new
player unable to see a queue they are allowed to join. The gate refuses them
anyway; the names and the pings are the signpost.

The honest trade-off: this divides your queue by the number of ranks times the
number of formats, and thin queues are how pick-up games die. One shared channel
with a call pinging the ranks it can admit gets you the same discoverability
without the split.

## How a match runs

The panel is one message with a **1v1** and a **2v2** button that stays in the
queue channel forever. Then:

1. Someone hits **1v1**. The bot posts their call in the channel: _looking for a
   1v1_, and pings the rank roles that queue would admit - not everyone, and
   not a channel per rank. One queue channel keeps the pool of takers whole;
   the ping is what makes it findable.
2. Someone else hits **Join** on it. That's the whole matchmaking.
3. The moment it fills it starts itself - teams drawn, a temporary voice
   channel made and everyone dragged in.
4. **Pick/ban.** 7 candidates go up on the call message and the two sides
   alternate bans until 3 are left. Nobody banning within 90 seconds and the
   bot bans at random, so one person can't hold the lobby. Group format skips
   this - there are no two sides to alternate between.
5. The call message becomes the live scoreboard, re-reading KovaaK's every
   minute on its own. **Refresh scores** forces it early.
6. Everyone hits **Done**. Once they all have - or 45 minutes in, whichever
   comes first - placings and Elo changes go to the results channel, the call
   message is deleted and the voice channel with it.

**Done is per player, deliberately.** If whoever's ahead could end the match on
their own, they'd end it while their opponent still had runs left. The clock is
the other half: one player wandering off can't hold a result open forever.

A call nobody takes within an hour is cancelled and its message deleted, so the
queue channel only ever shows calls that are actually live.

Other commands: `/pug score`, `/pug stats`, `/pug leaderboard`, and
`/pug tier @player <tier>` for staff. Everything else is a button.

**When a match goes wrong**, the dashboard lists everything open or running:
*force finish* scores it from whatever KovaaK's has, *cancel* bins it with no
rating change. Without that, a broken match just sits until the 45-minute clock
catches it.

Only someone already sitting in a voice channel can be dragged into the match
VC - everyone else gets the channel link in the match message, which is as far
as Discord lets a bot go.

## Tiers

Assigned by hand off Voltaic rank (`/pug tier`), and they do exactly one job:
seed a new player's Elo. Once someone has played, their record is the truth and
a tier change no longer moves their rating.

That's what removes the need for placement games: you're put where you belong
instead of playing ten to get there.

Who may play whom is a **separate** setting, per format, in the dashboard's
queues pane - measured in rank bands, not tiers. Out of the box a 1v1 queue is
one rank only, while 2v2 and group let in the band either side.

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
  good night - not a loss.
- Only games you played move your rating.

Rounds are scored by **placing, then summed** - never by raw score. That's what
makes a 3000-point tracking scenario and a 90-point clicking one count equally,
with no score normalization anywhere in the code.

Ranks are per server and edited in the dashboard - name, colour, threshold, and
however many bands you want. A new server starts with Champion 1400+, Diamond
1275, Platinum 1150, Gold 1050, Silver 950, Bronze 850, Iron below.

Each rank is mirrored to a Discord role, handed out when a match moves someone
across a threshold. Renaming or recolouring a rank edits that role; deleting a
rank deletes it. The bot needs **Manage Roles**, and its own role has to sit
above the rank roles in the server's role list or Discord won't let it assign
them.

## The scenario pool

Edited in the dashboard. Names must match KovaaK's **exactly** or the score
lookup finds nothing - copy them out of the game. A match rolls one scenario per
category, so the categories decide the shape of a match.

`DEFAULT_RANKS` and `DEFAULT_CATEGORIES` in `src/config.ts` only seed a server
the first time it's read; after that the database is the truth.
