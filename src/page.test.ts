// ponytail: the dashboard is one <script> in one string, so a syntax error in
// it is not a compile error here - tsc sees a template literal, and the page
// ships and hangs on "Loading…". new Function parses without running, which is
// the whole check. `NODE_OPTIONS=--experimental-sqlite npx tsx src/page.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const { PAGE, profilePage, ladderPage } = await import('./page.js');

// The ladder: same shell, and the row that is you is marked as such - that is
// the whole of what signing in buys out here.
const ladder = ladderPage({
  guildId: '111',
  guildName: 'Server & "co"',
  url: 'https://quorum.example.com/p/111',
  players: [
    {
      discordId: '222',
      name: '<b>top</b>',
      avatar: null,
      elo: 1312,
      rank: { name: 'Diamond', color: '#67e8f9' },
      wins: 5,
      losses: 2,
      draws: 0,
    },
    { discordId: '333', name: 'me', avatar: null, elo: 900, rank: null, wins: 0, losses: 1, draws: 0 },
  ],
  total: 2,
  matches: 7,
  meId: '333',
});
assert.ok(ladder.includes('&lt;b&gt;top&lt;/b&gt;'), 'a name is escaped, not rendered');
assert.ok(ladder.includes('<tr class="me" data-name="me">'), 'the reader\'s own row is marked');
assert.ok(ladder.includes('id="find"'), 'and there is a way to search for a name');
assert.ok(ladder.includes('href="/p/111/222"'), 'every row is a way into that player');
// Every row carries the name the search filters on, lowercased and escaped.
assert.ok(ladder.includes('data-name="&lt;b&gt;top&lt;/b&gt;"'), 'the search key is escaped too');
// An empty ladder still renders.
ladderPage({
  guildId: '111', guildName: 'g', url: 'u', players: [], total: 0, matches: 0, meId: null,
});

// The profile page is built per request rather than baked into a constant, so
// the same check has to see one actually rendered.
const profile = profilePage({
  guildId: '111',
  guildName: 'Server & "co"',
  discordId: '109871768372789248',
  url: 'https://quorum.example.com/p/111/109871768372789248',
  name: '<script>',
  avatar: null,
  elo: 1180,
  rank: { name: 'Platinum', color: '#4ac7c7' },
  wins: 3,
  losses: 1,
  draws: 0,
  seededFrom: 'flat',
  cats: [{ main: 'Clicking', won: 5, lost: 3 }],
  history: [
    { format: '1v1', won: true, delta: 12, elo: 1168, at: 1700000000000, against: [{ id: '222', name: 'ness & co' }] },
    // a match whose other side has since been deleted still draws a row
    { format: '1v1', won: false, delta: -9, elo: 1180, at: null, against: [] },
  ],
});
assert.ok(!profile.includes('<script>&'), 'a name is escaped, not run');
assert.ok(profile.includes('&lt;script&gt;'));
assert.ok(profile.includes('Server &amp; &quot;co&quot;'));
assert.ok(profile.includes('href="/p/111/222"'), 'the opponent links to their own page');
assert.ok(profile.includes('ness &amp; co'), 'and their name is escaped too');
// The card in Discord is most of what people see of this page.
assert.ok(profile.includes('property="og:title" content="&lt;script&gt; · 1180 · Platinum"'));
assert.ok(profile.includes('property="og:url" content="https://quorum.example.com/p/111/109871768372789248"'));
// An empty record still renders: the page is public, and a link that 500s is
// worse than a page saying nothing has been played.
profilePage({
  guildId: '1',
  guildName: 'g',
  discordId: '1',
  url: 'http://localhost:3000/p/1/1',
  name: 'nobody',
  avatar: null,
  elo: 1050,
  rank: null,
  wins: 0,
  losses: 0,
  draws: 0,
  seededFrom: null,
  cats: [],
  history: [],
});

// Only the app's own scripts: the shaders are GLSL in a type="x-shader" tag and
// are not JavaScript at all.
const scripts = [...PAGE.matchAll(/<script(?![^>]*x-shader)[^>]*>([\s\S]*?)<\/script>/g), ...profile.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length, 'the page has a script in it');

for (const [, body] of scripts) {
  // Throws SyntaxError on a duplicate binding, an unclosed template, a stray
  // backtick - every way this file has actually broken.
  new Function(body);
}

console.log('page ok');
