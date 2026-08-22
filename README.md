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

`npm test` runs the self-checks (rating maths, ranks/pool/seeding).

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
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | off - the repo is public. On, with a PAT scoped `repo`, if it ever isn't |

Then set these environment variables in the same screen (**Advanced mode** takes
the whole block at once):

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

Discord matches it character for character, so no trailing slash.

On the **Bot** page, leave all three privileged intents OFF - the bot asks for
`Guilds`, which is not privileged. Turn **Public Bot** off too while you're
there: with `ALLOWED_GUILD_IDS` set, nobody else can usefully add it anyway.

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

- **Category** - the Discord category Quorum fills with a results channel and
  one queue channel per rank. Pick an existing one or let it make a `Quorum`
- **Auto-cancel** - how long an untaken call stays up, or off entirely
- **Extra ping role** - for people who want notifying about every call. The
  ranks a call can actually admit are pinged automatically
- **Ranks** - add, remove, rename, recolour and set the threshold of every rank.
  Each one becomes a real Discord role, created and kept in sync by the bot
- **Scenario pool** - categories you add and remove, each holding scenarios
  picked from a live KovaaK's search, so a name can never be a typo
- **Queues** - how many rank bands apart a queue lets people be, per format.
  This also decides who can *see* each rank channel (below)
- **Players** - Elo, rank, Voltaic S5 standing, and the starting rank of
  anyone who hasn't played yet
- **Overview** - the server's numbers and what is still unconfigured
- **Remove Quorum** - at the foot of the setup pane, with a tickbox to take its
  roles, categories and channels with it. Use this rather than kicking the bot:
  Discord tells a bot it has been removed, it never asks first, so after a kick
  there is no permission left to delete anything and the ladder's roles and
  channels stay in the server forever. Ratings and match history survive either
  way - they are global, and wiping them would edit other servers' ladders

Then hit **Post panel** and the queue message goes up. That's the whole setup;
there are no configuration commands.

Add `WEB_URL/callback` to the OAuth redirects on your Discord application. The
dashboard's invite link already asks for everything the bot needs - Manage
Channels and Manage Roles for the ladder, Create Private Threads / Send Messages
in Threads / Manage Threads for a match's own room, and View Channel, Send
Messages, Embed Links and Read Message History held in its own right, because a
locked rank category is the moment @everyone stops supplying them. **Never give
it Administrator.**

If the bot was invited before this was fixed it is still holding the old, wrong
set: re-run the invite from the dashboard, which updates the role in place.

## Division roles

Quorum owns them. It hands them out and moves people between them as ratings
cross the thresholds, so nobody has to keep a server's roles in step by hand.
Where a rating *starts* is the one thing a server chooses - see
[Where a rating starts](#where-a-rating-starts).

## Channels

Quorum keeps one category - the one you pick in setup, or a `Quorum` it makes -
holding `#results` and a channel per rank: `#champion`, `#diamond`, and so on.
Each rank channel gets the same panel, buttons and all, so the channel is the
rank and the button is the format. Every one of them is a live queue at the same
time: a call belongs to the channel its button was pressed in, and there is no
limit on how many are open at once.

**Results are never split.** Every finished match, whatever rank played it, is
posted to `#results`, which stays visible to the whole server. A ladder is only
a ladder if everyone can read it, and a Champion result nobody in Bronze can see
is a private message with extra steps.

**A rank channel is visible to exactly the ranks its queue admits.** Not just
its own: the per-format spreads in the queues pane already say who may play
whom, so `#diamond` at "one rank either side" is visible to Champion, Diamond
and Platinum. The join gate is still per format, so a Platinum who can see
`#diamond` joins the 2v2 there and is turned away from a same-rank-only 1v1.
What the dashboard says and what the channel shows are the same answer.

**Roles first, then channels, then panels.** Nothing is built until every rank
has its Discord role - the channels are locked to those roles, so making them
first would either publish a wall of channels to the whole server or lock them
to roles that do not exist. The panel posted into each new channel is a message
everybody in it sees, so it goes last.

That only works cleanly with **staff** as the starting rank: Quorum hands out
the role the moment staff seed someone, so they can see their queue before they
have played. On **flat** or **voltaic** a player holds no role until a match of
theirs finishes, so a new arrival sees `#results` and nothing else.

**Post panel** fills in whatever is missing: a fresh panel at the bottom of
every rank channel, deleting the older one there rather than stacking a second.
Safe to press whenever someone has deleted one.

**The ladder is the only source of truth.** Rename a rank and its channel
renames with it; delete a rank and the channel goes. Nothing is ever recreated
in place of something that already exists, so a rename keeps the channel and its
history. Four ranks means one category and five channels - if that is too many,
shorten the ladder, because the ladder is what decides.

The honest trade-off: this divides your queue by the number of ranks, and thin
queues are how pick-up games die. Widening the spread in the queues pane widens
who can see each channel, which is the lever for pulling a thin ladder back
together.

## How a match runs

The panel is one message with a **1v1** and a **2v2** button, sitting in every
rank channel forever. Then:

1. Someone hits **1v1**. The bot posts their call in that channel: _looking for
   a 1v1_, and pings the rank roles that queue would admit - not everyone. The
   ping is what makes it findable without anyone watching the channel.
2. Someone else hits **Join** on it. That's the whole matchmaking.
3. The moment it fills it starts itself: teams drawn, and a **private thread**
   made off the queue channel holding exactly the players. The call in the
   channel is deleted - it filled, so it has nothing left to offer - and
   everything from here happens in the thread, where nobody else can see it.
4. **Pick/ban.** 7 candidates go up in the thread and the two sides
   alternate bans until 3 are left. Nobody banning within 90 seconds and the
   bot bans at random, so one person can't hold the lobby. Group format skips
   this - there are no two sides to alternate between.
5. That same message becomes the live scoreboard, re-reading KovaaK's every
   minute on its own. **Refresh scores** forces it early.
6. Everyone hits **Done**. Once they all have - or 45 minutes in, whichever
   comes first - placings and Elo changes go to the results channel and the
   thread is deleted. The result embed is the record; an archived thread per
   match is a channel nobody can find anything in.

**Done is per player, deliberately.** If whoever's ahead could end the match on
their own, they'd end it while their opponent still had runs left. The clock is
the other half: one player wandering off can't hold a result open forever.

A call nobody takes is cancelled and its message deleted, so a rank channel
only ever shows calls that are actually live. An hour out of the box; the setup
pane sets the window per server, or turns it off entirely and leaves calls up
until someone takes or cancels them.

Other commands: `/pug score`, `/pug stats`, `/pug leaderboard`, and
`/pug seed @player <rank>` for staff. Everything else is a button.

**When a match goes wrong**, the dashboard lists everything open or running:
*force finish* scores it from whatever KovaaK's has, *cancel* bins it with no
rating change. Without that, a broken match just sits until the 45-minute clock
catches it.

**Why a thread and not a voice channel.** A bot can only move someone who is
already sitting in voice, so half a lobby would be left staring at a link. A
thread takes members by id: everyone is in it the moment it exists, it needs
nothing configured, and in a split server it lands in the right rank's channel
on its own.

## Where a rating starts

Everyone plays one ladder, and the only question is where you join it. The
**Starting rank** setting in the ranks pane picks how:

| mode | a new player starts at |
| --- | --- |
| flat (default) | 1050, the same as everyone else |
| staff | wherever staff put them - a rank, chosen in the players pane or with `/pug seed` |
| voltaic | their Voltaic S5 standing, mapped onto the ladder; flat if they have no S5 entry |

It is only ever the **first** rating. The moment someone finishes a match their
record is the truth, seeding refuses to move them, and Quorum owns their rank
role from then on - crossing a threshold adds the new role and takes the old
one. That is what removes the need for placement games: you are put where you
belong instead of playing ten to get there.

Who may play whom is a **separate** setting, per format, in the dashboard's
queues pane - measured in rank bands. Out of the box a 1v1 queue is one rank
only, while 2v2 and group let in the band either side.

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
