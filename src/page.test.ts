// ponytail: the dashboard is one <script> in one string, so a syntax error in
// it is not a compile error here - tsc sees a template literal, and the page
// ships and hangs on "Loading…". new Function parses without running, which is
// the whole check. `NODE_OPTIONS=--experimental-sqlite npx tsx src/page.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const { PAGE } = await import('./page.js');

// Only the app's own scripts: the shaders are GLSL in a type="x-shader" tag and
// are not JavaScript at all.
const scripts = [...PAGE.matchAll(/<script(?![^>]*x-shader)[^>]*>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length, 'the page has a script in it');

for (const [, body] of scripts) {
  // Throws SyntaxError on a duplicate binding, an unclosed template, a stray
  // backtick - every way this file has actually broken.
  new Function(body);
}

console.log('page ok');
