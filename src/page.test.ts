// ponytail: the dashboard is one <script> in one string, so a syntax error in
// it is not a compile error here - tsc sees a template literal, and the page
// ships and hangs on "Loading…". new Function parses without running, which is
// the whole check. `NODE_OPTIONS=--experimental-sqlite npx tsx src/page.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const { PAGE, profilePage } = await import('./page.js');

// The profile page is built per request rather than baked into a constant, so
// the same check has to see one actually rendered.
const profile = profilePage({
  guildName: 'Server & "co"',
  discordId: '109871768372789248',
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
    { format: '1v1', won: true, delta: 12, elo: 1168, at: 1700000000000 },
    { format: '1v1', won: false, delta: -9, elo: 1180, at: null },
  ],
});
assert.ok(!profile.includes('<script>&'), 'a name is escaped, not run');
assert.ok(profile.includes('&lt;script&gt;'));
assert.ok(profile.includes('Server &amp; &quot;co&quot;'));
// An empty record still renders: the page is public, and a link that 500s is
// worse than a page saying nothing has been played.
profilePage({
  guildName: 'g',
  discordId: '1',
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
