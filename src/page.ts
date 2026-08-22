import { RANK_ICONS } from './rankicons.js';

/** The mark: a three-quarter disc with the removed quadrant set down beside the
 *  gap - the counter is the tail, nothing is drawn twice. Two shapes, one fill,
 *  no background of its own, so it sits on any ground and follows currentColor. */
const MARK =
  '<path d="M56 56 L100 56 A44 44 0 1 0 56 100 Z"/><rect x="68" y="68" width="34" height="34"/>';

/** Tab icon. Its own dark rounded ground rather than a bare white mark, which
 *  would vanish in light browser chrome. */
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
  '<rect width="128" height="128" rx="28" fill="#0a0a0a"/>' +
  `<g fill="#ededed" transform="translate(23 23) scale(0.911) translate(-12 -12)">${MARK}</g>` +
  '</svg>';

export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quorum</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --fg: #ededed; --muted: #8a8a8a; --line: #262626; --panel: #111;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #fafafa; --fg: #111; --muted: #6b6b6b; --line: #e2e2e2; --panel: #fff; }
  }
  body {
    background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased; min-height: 100vh;
  }
  main { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; position: relative; }
  #bg { position: fixed; inset: 0; width: 100%; height: 100%; display: none; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 48px; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.025em; }
  h1 a, h1 > span { display: flex; align-items: center; gap: 9px; }
  .mark { width: 17px; height: 17px; }
  .login .mark { width: 42px; height: 42px; margin: 0 auto 20px; }
  h2 { font-size: 13px; font-weight: 500; color: var(--muted); margin-bottom: 12px; letter-spacing: 0.02em; text-transform: lowercase; }
  /* stacked sections need air between them; the first one already sits under the header. */
  #lists h2:not(:first-child) { margin-top: 36px; }
  /* here it reads as a line under its heading, not as a standalone panel. */
  #lists .empty { padding: 0; }
  /* a server's own page is two columns and wants more room than the home list. */
  main:has(.dash) { max-width: 1040px; }
  .dash { display: grid; grid-template-columns: 190px 1fr; gap: 48px; align-items: start; }
  #side { position: sticky; top: 32px; display: grid; gap: 2px; }
  #side .server { cursor: default; margin-bottom: 14px; padding: 10px 12px; }
  #side a {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 11px; border-radius: 6px; color: var(--muted); text-decoration: none;
    font-size: 14px; transition: color .15s, background .15s;
  }
  #side a:hover { color: var(--fg); background: var(--panel); }
  #side a[aria-current="true"] { color: var(--fg); background: var(--panel); }
  #side .back { margin-top: 14px; font-size: 13px; }
  #pane > section > :first-child { margin-top: 0; }
  @media (max-width: 760px) {
    .dash { grid-template-columns: 1fr; gap: 28px; }
    #side { position: static; grid-auto-flow: column; justify-content: start; overflow-x: auto; }
    #side .server, #side .back { display: none; }
  }
  svg { width: 15px; height: 15px; flex: none; }
  .who { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .who img { width: 30px; height: 30px; border-radius: 999px; }
  .who .name { display: grid; line-height: 1.35; margin-right: 4px; }
  .who .name strong { color: var(--fg); font-weight: 500; font-size: 13px; }
  .who .name span { font-size: 12px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; }
  .stat {
    border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
    padding: 14px 15px; text-align: left; width: 100%; color: inherit;
  }
  button.stat { cursor: pointer; transition: border-color .15s; }
  button.stat:hover { border-color: var(--fg); }
  .stat .n {
    font-size: 25px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15;
    display: flex; align-items: baseline; gap: 6px; white-space: nowrap;
  }
  .stat .n .sub { font-size: 12px; font-weight: 400; letter-spacing: 0; color: var(--muted); }
  .stat .k {
    display: flex; align-items: center; gap: 7px; font-size: 12px;
    color: var(--muted); margin-top: 5px; white-space: nowrap;
  }
  .check { display: grid; gap: 7px; font-size: 14px; }
  .check > div { display: flex; align-items: center; gap: 9px; color: var(--muted); }
  .check > div.ok { color: var(--fg); }
  .check svg { width: 14px; }
  .link {
    background: none; border: none; padding: 0; color: inherit; cursor: pointer; font-size: inherit;
    text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px;
  }
  .link:hover { color: var(--fg); text-decoration-color: currentColor; }
  .ladder td { padding: 8px 10px 8px 0; }
  .ladder tr + tr { border-top: 1px solid var(--line); }
  /* a rank reads as its colour first, so the dot carries it and the text
     borrows it at low weight rather than shouting. */
  .rank {
    display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
    color: color-mix(in srgb, var(--c) 78%, var(--fg));
  }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--c); flex: none; }
  .pfp { width: 26px; height: 26px; border-radius: 999px; display: block; }
  a, button { font: inherit; color: inherit; }
  .btn {
    border: 1px solid var(--line); background: transparent; color: var(--fg);
    padding: 7px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; text-decoration: none;
    display: inline-block; transition: border-color .15s, background .15s;
  }
  .btn:hover { border-color: var(--fg); }
  .btn:disabled { opacity: .4; cursor: default; border-color: var(--line); }
  .btn.solid { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  .servers { display: grid; gap: 8px; }
  .server {
    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel); cursor: pointer; transition: border-color .15s;
  }
  .server:hover { border-color: var(--fg); }
  .server[aria-current="true"] { border-color: var(--fg); }
  .server .icon {
    width: 28px; height: 28px; border-radius: 8px; background: var(--line); flex: none;
    display: grid; place-items: center; font-size: 11px; color: var(--muted); filter: grayscale(1);
    object-fit: cover; overflow: hidden;
  }
  .server .name { flex: 1; font-size: 14px; }
  .tag {
    display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
    font-size: 11px; color: var(--muted); border: 1px solid var(--line);
    padding: 3px 9px; border-radius: 999px;
  }
  .tag svg { width: 12px; height: 12px; }
  .volt { padding-left: 3px; gap: 6px; color: var(--fg); }
  .volt img { width: 18px; height: 18px; object-fit: contain; }
  .volt .done { color: var(--muted); }
  h1 a { text-decoration: none; }
  /* the overview stacks headed blocks, same as the home list does. */
  #overview h2:not(:first-child) { margin-top: 32px; }
  .field { margin-bottom: 22px; }
  label { display: block; font-size: 13px; margin-bottom: 6px; }
  label .hint { color: var(--muted); }
  input[type=text], input[type=number] {
    width: 100%; background: var(--panel); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 9px 11px; font: inherit; font-size: 14px; appearance: none;
  }
  input:focus { outline: none; border-color: var(--fg); }
  /* the OS spinner is the only unstyleable part of a number field; arrow keys
     still step the value without it. */
  input[type=number] { -moz-appearance: textfield; text-align: right; }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { appearance: none; margin: 0; }
  /* colour picker: a swatch and a small palette, because type=color opens the
     OS colour panel and nothing about that is ours. */
  .col { position: relative; }
  .col-btn {
    width: 34px; height: 34px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--line); background: var(--c); padding: 0;
  }
  .col-btn:hover, .col-btn:focus-visible { outline: none; border-color: var(--fg); }
  .col-pop {
    position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 176px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px;
    box-shadow: 0 12px 32px rgb(0 0 0 / .45);
  }
  .col-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 8px; }
  .col-grid button {
    aspect-ratio: 1; border-radius: 5px; border: 1px solid var(--line);
    background: var(--c); cursor: pointer; padding: 0;
  }
  .col-grid button:hover, .col-grid button[aria-pressed="true"] { border-color: var(--fg); }
  .col-hex { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px !important; }
  /* matches, as cards */
  .matches { display: grid; gap: 10px; }
  .match { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 15px 16px; }
  .match-top { display: flex; align-items: center; gap: 9px; font-size: 14px; }
  .match-top .hint:last-child { margin-left: auto; }
  .pill {
    font-size: 11px; padding: 2px 9px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted);
  }
  .pill.live { color: var(--fg); border-color: var(--fg); }
  .roster { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
  .pl {
    display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted);
    border: 1px solid var(--line); border-radius: 999px; padding: 3px 11px 3px 3px;
  }
  .pl img { width: 22px; height: 22px; border-radius: 999px; }
  .pl.done { color: var(--fg); }
  .pl svg { width: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .chip {
    font-size: 12px; color: var(--muted); background: var(--bg);
    border: 1px solid var(--line); border-radius: 5px; padding: 3px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .match-act { display: flex; gap: 8px; margin-top: 15px; }
  /* the scenario pool, one block per category */
  .cat { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 14px 15px; }
  .cat + .cat { margin-top: 10px; }
  .cat-top { display: flex; align-items: center; gap: 9px; font-size: 14px; margin-bottom: 11px; }
  .cat-top .icon-btn { margin-left: auto; }
  .chip .icon-btn { padding: 0 0 0 3px; }
  .chip .icon-btn svg { width: 12px; height: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 3px; }
  .chip.add { cursor: pointer; gap: 5px; color: var(--fg); border-style: dashed; }
  .chip.add:hover { border-color: var(--fg); }
  .chip.add svg { width: 12px; height: 12px; }
  .scn { margin-top: 12px; }
  .scn-out { margin-top: 8px; font-size: 13px; display: grid; gap: 2px; }
  .scn-hit {
    display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
    width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    padding: 7px 9px; border-radius: 6px; color: var(--fg); font-size: 14px;
  }
  .scn-hit:hover { background: var(--bg); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
  .seg button {
    padding: 5px 11px; font-size: 12px; background: none; border: none; cursor: pointer;
    color: var(--muted); transition: color .15s, background .15s;
  }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button:hover { color: var(--fg); }
  .seg button[aria-checked="true"] { color: var(--bg); background: var(--fg); }
  .reach { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 11px; font-size: 13px; color: var(--muted); }
  .sel { position: relative; }
  .sel-btn {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
    background: var(--panel); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 9px 11px; font-size: 14px; cursor: pointer; text-align: left;
  }
  .sel-btn:hover, .sel-btn:focus-visible { outline: none; border-color: var(--fg); }
  .sel-btn svg { color: var(--muted); transition: transform .15s; }
  .sel-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
  .sel-list {
    position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
    max-height: 260px; overflow-y: auto; list-style: none;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px;
    box-shadow: 0 12px 32px rgb(0 0 0 / .45);
  }
  .sel-list li {
    padding: 7px 10px; border-radius: 5px; font-size: 14px; cursor: pointer;
    color: var(--muted); outline: none;
  }
  .sel-list li:hover, .sel-list li:focus { color: var(--fg); background: var(--bg); }
  .sel-list li[aria-selected="true"] { color: var(--fg); }
  /* the dialog that replaced prompt() */
  dialog {
    /* the reset's zeroed margin kills the UA's margin:auto, which is the only
       thing centring a native dialog. */
    margin: auto;
    border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg);
    padding: 22px; width: min(380px, calc(100vw - 32px));
  }
  dialog::backdrop { background: rgb(0 0 0 / .6); }
  dialog .bar { margin-top: 20px; justify-content: flex-end; }
  dialog label { color: var(--muted); }
  .row { display: flex; gap: 8px; }
  .row > :first-child { flex: 1; }
  .bar { display: flex; align-items: center; gap: 12px; margin-top: 32px; }
  .status { font-size: 13px; color: var(--muted); }
  .empty { color: var(--muted); font-size: 14px; padding: 32px 0; }
  hr { border: none; border-top: 1px solid var(--line); margin: 36px 0; }
  main:has(.login) { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
  .login { text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px 4px 0; vertical-align: middle; }
  td:last-child { padding-right: 0; text-align: right; }
  input[type=color] {
    width: 34px; height: 34px; padding: 2px; background: var(--panel);
    border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
  }
  input[type=number] { width: 90px; }
  textarea {
    width: 100%; min-height: 220px; background: var(--panel); color: var(--fg);
    border: 1px solid var(--line); border-radius: 6px; padding: 10px 11px;
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical;
  }
  textarea:focus { outline: none; border-color: var(--fg); }
  .icon-btn {
    border: none; background: none; color: var(--muted); cursor: pointer;
    font-size: 16px; line-height: 1; padding: 4px 6px;
  }
  .icon-btn:hover { color: var(--fg); }
  .muted { color: var(--muted); font-size: 13px; margin: -6px 0 14px; }
  .login p { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
</style>
</head>
<body>
<canvas id="bg"></canvas>
<script id="vs" type="x-shader/x-vertex">
#version 300 es
// fullscreen triangle straight out of gl_VertexID - no buffers, no attributes.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
</script>
<script id="fs" type="x-shader/x-fragment">
#version 300 es
precision highp float;

// The knobs. Same names as the React component's props - they're #defines
// because nothing changes them at runtime, which saves plumbing 17 uniforms.
#define SPEED       0.4
#define AMPLITUDE   2.5
#define WAVE_SCALE  0.6
#define WAVE_RATIO  0.9
#define SWELL       35.0
#define TURBULENCE  20.0
#define TILT        1.11
#define ZOOM        1.0
#define HEIGHT      5.5
#define FOG_DEPTH   15.0
#define STEPS       70
#define BRIGHTNESS  1.0
#define OPACITY     0.85
#define GRAIN       0.05

uniform vec2 iResolution;
uniform float iTime;
/** the page background - distance fades the waves into it, so the canvas has
 *  no visible edge and the login text sits on flat colour. */
uniform vec3 uHorizon;
uniform vec3 uWave;
uniform vec3 uCrest;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += SWELL * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += TURBULENCE * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * AMPLITUDE + sin(my * freq.y) * AMPLITUDE + HEIGHT);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * SPEED;
  vec2 freq = vec2(WAVE_SCALE / 7.0, (WAVE_SCALE * WAVE_RATIO) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / ZOOM;
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(TILT); s = sin(TILT);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(FOG_DEPTH / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWave, uCrest, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizon, body * BRIGHTNESS, t * OPACITY);
  col += (hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0) - 0.5) * GRAIN;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
</script>
<script id="fs2" type="x-shader/x-fragment">
#version 300 es
precision highp float;

// SideRays. Knobs are the component's props; INTENSITY and OPACITY are well
// under its defaults because this sits behind a dashboard you have to read.
#define SPEED       2.5
#define INTENSITY   1.1
#define SPREAD      2.0
#define FLIP_X      0.0
#define FLIP_Y      0.0
#define TILT        0.0
#define SATURATION  1.4
#define BLEND       0.75
#define FALLOFF     1.6
#define OPACITY     0.5

uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uHorizon;
uniform vec3 uRay1;
uniform vec3 uRay2;
out vec4 fragColor;

float rayStrength(vec2 src, vec2 dir, vec2 coord, float seedA, float seedB, float speed) {
  vec2 toCoord = coord - src;
  float cosAngle = dot(normalize(toCoord), dir);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(toCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (FLIP_X > 0.5) frag.x = iResolution.x - frag.x;
  if (FLIP_Y > 0.5) frag.y = iResolution.y - frag.y;

  vec2 coord = vec2(frag.x, iResolution.y - frag.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = TILT * 3.14159265 / 180.0;
  float cs = cos(tiltRad), sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tilted = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float half_ = SPREAD * 0.275;
  vec2 dir1 = normalize(vec2(cos(0.785398 + half_), sin(0.785398 + half_)));
  vec2 dir2 = normalize(vec2(cos(0.785398 - half_), sin(0.785398 - half_)));

  vec4 rays1 = vec4(uRay1, 1.0) * rayStrength(rayPos, dir1, tilted, 36.2214, 21.11349, SPEED);
  vec4 rays2 = vec4(uRay2, 1.0) * rayStrength(rayPos, dir2, tilted, 22.3991, 18.0234, SPEED * 0.2);
  vec4 color = rays1 * (1.0 - BLEND) * 0.9 + rays2 * BLEND * 0.9;

  float dist = length(frag - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  color.rgb *= INTENSITY * 0.4 / pow(max(dist, 0.001), FALLOFF);

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, SATURATION);

  // Composited here rather than blended by the canvas: the page background is
  // the only thing behind us, and an opaque canvas needs no alpha plumbing.
  float a = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0) * OPACITY;
  fragColor = vec4(mix(uHorizon, clamp(color.rgb, 0.0, 1.0), a), 1.0);
}
</script>
<main id="app"><div class="empty">loading…</div></main>
<script>
const RANK_ICONS = ${JSON.stringify(RANK_ICONS)};
const app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let me = null;

// Lucide, inlined. Only the eight icons this page actually draws - a CDN script
// or the npm package (which needs a bundler this project doesn't have) to fetch
// 1500 of them would cost more than it saves. Paths are lucide's, MIT.
const ICONS = {
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  dash: '<path d="M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
};
/** Pinned to en-US: the page is written in English, and a German browser
 *  renders 1284 as "1.284", which reads as one point two eight four. */
const num = (n) => (n == null ? null : n.toLocaleString('en-US'));

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
};

const mark = () =>
  '<svg class="mark" viewBox="12 12 90 90" fill="currentColor" aria-hidden="true">' +
  ${JSON.stringify(MARK)} + '</svg>';

const icon = (name) =>
  \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${ICONS[name]}</svg>\`;

/** Discord's own default avatar when someone hasn't set one, so the header
 *  never renders a hole. The index is how Discord picks it post-discriminator. */
const avatarUrl = (u) =>
  u.avatar
    ? \`https://cdn.discordapp.com/avatars/\${h(u.id)}/\${h(u.avatar)}.png?size=64\`
    // BigInt throws on anything non-numeric, and that would take the whole
    // table down with it rather than one missing picture.
    : \`https://cdn.discordapp.com/embed/avatars/\${
        /^\\d+$/.test(String(u.id)) ? (BigInt(u.id) >> 22n) % 6n : 0}.png\`;

/** A dropdown that isn't the OS one - a <select>'s popup can't be styled, only
 *  its closed state. Value lives in data-value and a plain \`change\` fires on
 *  the wrapper, so callers read it much like they read a select. */
const selectField = (id, items, selected, extra = '') => {
  const opts = items.map((o) => (typeof o === 'string' ? { id: o, name: o } : o));
  const now = opts.find((o) => o.id === (selected ?? '')) ?? opts[0];
  return \`<div class="sel" id="\${h(id)}" data-value="\${h(now.id)}" \${extra}>
    <button type="button" class="sel-btn" aria-haspopup="listbox" aria-expanded="false">
      <span>\${h(now.name)}</span>\${icon('chevron')}
    </button>
    <ul class="sel-list" role="listbox" hidden>\${opts.map((o) => \`
      <li role="option" tabindex="-1" data-value="\${h(o.id)}"
          aria-selected="\${o.id === now.id}">\${h(o.name)}</li>\`).join('')}
    </ul>
  </div>\`;
};

function pickOption(sel, value) {
  const li = [...sel.querySelectorAll('li')].find((n) => n.dataset.value === value);
  if (!li) return;
  sel.dataset.value = value;
  sel.querySelector('.sel-btn span').textContent = li.textContent.trim();
  sel.querySelectorAll('li').forEach((n) => n.setAttribute('aria-selected', String(n === li)));
  sel.dispatchEvent(new Event('change'));
}

function wireSelects(root) {
  const closeAll = () =>
    root.querySelectorAll('.sel').forEach((s) => {
      s.querySelector('.sel-list').hidden = true;
      s.querySelector('.sel-btn').setAttribute('aria-expanded', 'false');
    });
  document.addEventListener('click', (e) => { if (!e.target.closest('.sel')) closeAll(); });

  root.querySelectorAll('.sel').forEach((sel) => {
    const btn = sel.querySelector('.sel-btn');
    const list = sel.querySelector('.sel-list');
    const open = () => {
      closeAll();
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      (list.querySelector('[aria-selected="true"]') ?? list.firstElementChild)?.focus();
    };
    const shut = () => { closeAll(); btn.focus(); };
    btn.onclick = () => (list.hidden ? open() : closeAll());
    list.onclick = (e) => {
      const li = e.target.closest('li');
      if (li) { pickOption(sel, li.dataset.value); shut(); }
    };
    // A styled listbox has to bring its own keyboard back: the native one is
    // the only thing we lost by not using <select>.
    sel.onkeydown = (e) => {
      const items = [...list.children];
      const at = items.indexOf(document.activeElement);
      if (e.key === 'Escape') shut();
      else if (list.hidden && ['ArrowDown', 'Enter', ' '].includes(e.key)) open();
      else if (e.key === 'ArrowDown') items[Math.min(at + 1, items.length - 1)].focus();
      else if (e.key === 'ArrowUp') items[Math.max(at - 1, 0)].focus();
      else if (['Enter', ' '].includes(e.key) && at >= 0) { pickOption(sel, items[at].dataset.value); shut(); }
      else if (e.key === 'Tab') closeAll();
      else return;
      if (e.key !== 'Tab') e.preventDefault();
    };
  });
}

const SWATCHES = [
  '#ffd230', '#fbbf24', '#d97706', '#f87171', '#fb7185', '#e879f9',
  '#a78bfa', '#818cf8', '#67e8f9', '#34d399', '#a3e635', '#d4d4d8',
];

/** Swatch plus a small palette. type=color would hand the user the OS colour
 *  panel, which is the one thing on this page we can't style. Hex stays typable
 *  so any colour is still reachable. */
const colorField = (value, extra = '') => \`
  <div class="col" data-value="\${h(value)}" \${extra}>
    <button type="button" class="col-btn" style="--c:\${h(value)}"
            aria-haspopup="true" aria-expanded="false" aria-label="colour"></button>
    <div class="col-pop" hidden>
      <div class="col-grid">\${SWATCHES.map((c) => \`
        <button type="button" style="--c:\${c}" data-c="\${c}"
                aria-pressed="\${c.toLowerCase() === value.toLowerCase()}"></button>\`).join('')}
      </div>
      <input type="text" class="col-hex" value="\${h(value)}" spellcheck="false" maxlength="7" />
    </div>
  </div>\`;

function wireColors(root) {
  const closeAll = () =>
    root.querySelectorAll('.col').forEach((c) => {
      c.querySelector('.col-pop').hidden = true;
      c.querySelector('.col-btn').setAttribute('aria-expanded', 'false');
    });
  document.addEventListener('click', (e) => { if (!e.target.closest('.col')) closeAll(); });

  root.querySelectorAll('.col').forEach((col) => {
    const btn = col.querySelector('.col-btn');
    const pop = col.querySelector('.col-pop');
    const hex = col.querySelector('.col-hex');
    const set = (value) => {
      if (!/^#[0-9a-f]{6}$/i.test(value)) return;
      col.dataset.value = value;
      btn.style.setProperty('--c', value);
      if (hex.value !== value) hex.value = value;
      col.querySelectorAll('.col-grid button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === value.toLowerCase())));
      col.dispatchEvent(new Event('change'));
    };
    btn.onclick = () => {
      const open = pop.hidden;
      closeAll();
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    col.querySelector('.col-grid').onclick = (e) => {
      const swatch = e.target.closest('button');
      if (swatch) { set(swatch.dataset.c); closeAll(); btn.focus(); }
    };
    hex.oninput = () => set(hex.value.trim());
    col.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      closeAll();
      btn.focus();
    };
  });
}

/** Replaces prompt(). <form method="dialog"> does the closing and the return
 *  value natively; Escape cancels for free. */
function ask(label, value = '') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = \`<form method="dialog">
      <label>\${h(label)}</label>
      <input type="text" name="v" value="\${h(value)}" />
      <div class="bar">
        <button class="btn solid" value="ok">OK</button>
        <button class="btn" value="">Cancel</button>
      </div>
    </form>\`;
    document.body.append(dlg);
    dlg.onclose = () => {
      resolve(dlg.returnValue === 'ok' ? dlg.querySelector('input').value.trim() : null);
      dlg.remove();
    };
    dlg.showModal();
    dlg.querySelector('input').select();
  });
}

/** Voltaic standing as its own badge. An unknown rank name still renders - the
 *  icon just falls away rather than the whole chip disappearing. */
const voltaicChip = (v) => {
  if (!v) return '';
  const art = RANK_ICONS[v.rank];
  return \`<span class="tag volt" title="Voltaic S5 \${h(v.difficulty)}\${
    v.complete ? ', complete' : ''}">\${
    art ? \`<img src="\${art}" alt="" />\` : ''}\${h(v.rank)}\${
    v.complete ? '<span class="done">✦</span>' : ''}</span>\`;
};

const whoBar = () => \`
  <div class="who">
    <img src="\${avatarUrl(me.user)}" alt="" />
    <span class="name">
      <strong>\${h(me.user.global_name || me.user.username)}</strong>
      <span>@\${h(me.user.username)}</span>
    </span>
    <a class="btn" href="/logout">Sign out</a>
  </div>\`;

async function boot() {
  const res = await fetch('/api/me');
  me = res.ok ? await res.json() : null;
  if (!me) return renderLogin();
  // /g/<id> is a server's own page. Anything else, or a server you can't
  // configure, falls back to the list rather than erroring.
  const id = /^\\/g\\/(\\d+)$/.exec(location.pathname)?.[1];
  const guild = id && me.guilds.find((g) => g.id === id && g.installed);
  if (guild) return renderGuild(guild);
  if (id) history.replaceState(null, '', '/');
  renderHome();
  watchForInvites();
}

function renderLogin() {
  app.innerHTML = \`<div class="login">
    \${mark()}
    <h1>Quorum</h1>
    <p>Sign in to set up your server.</p>
    <a class="btn solid" href="/login">Continue with Discord</a>
  </div>\`;
  startWaves();
}

const startWaves = () =>
  startShader('fs', { uWave: [0.322, 0.153, 1], uCrest: [1, 0.624, 0.988], dpr: 1.5 });
// Rays are a cheap two-sample shader, so they can have the full pixel ratio.
const startRays = () =>
  startShader('fs2', { uRay1: [0.322, 0.153, 1], uRay2: [1, 0.624, 0.988], dpr: 2 });

/** Draws one of the background shaders full-bleed behind the page. No WebGL2,
 *  no background - the page just stays its background colour, which is what
 *  both shaders fade to anyway. Every view here is a full navigation, so this
 *  runs once and never needs tearing down. */
function startShader(fsId, opts) {
  const cv = document.getElementById('bg');
  const gl = cv.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return;
  const compile = (type, id) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, document.getElementById(id).text.trim());
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'vs'));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsId));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const at = (name) => gl.getUniformLocation(prog, name);
  const uRes = at('iResolution'), uTime = at('iTime');
  // horizon tracks the theme so the canvas has no seam in light or dark.
  const bg = getComputedStyle(document.body).backgroundColor.match(/\\d+/g) ?? [10, 10, 10];
  gl.uniform3f(at('uHorizon'), bg[0] / 255, bg[1] / 255, bg[2] / 255);
  for (const [name, rgb] of Object.entries(opts)) {
    if (name !== 'dpr') gl.uniform3f(at(name), rgb[0], rgb[1], rgb[2]);
  }

  let raf = 0;
  const draw = (t) => {
    raf = 0;
    gl.uniform1f(uTime, t * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      raf = requestAnimationFrame(draw);
    }
  };
  const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(draw); };
  const size = () => {
    // ponytail: dpr is capped per shader - a 70-step raymarch at retina 2x
    // cooks laptop GPUs. Lower STEPS in the shader before raising it.
    const dpr = Math.min(devicePixelRatio || 1, opts.dpr);
    cv.width = Math.floor(innerWidth * dpr);
    cv.height = Math.floor(innerHeight * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uRes, cv.width, cv.height);
  };
  addEventListener('resize', () => { size(); kick(); });
  document.addEventListener('visibilitychange', kick);
  size();
  kick();
  cv.style.display = 'block';
}

function renderHome() {
  app.innerHTML = \`
    <header><h1><span>\${mark()}Quorum</span></h1>\${whoBar()}</header>
    <div id="lists"></div>\`;
  startRays();

  const running = me.guilds.filter((g) => g.installed);
  const missing = me.guilds.filter((g) => !g.installed);
  const card = (g, tag) => \`
    <button class="server" data-id="\${g.id}">
      \${g.icon
        ? \`<img class="icon" src="https://cdn.discordapp.com/icons/\${h(g.id)}/\${h(g.icon)}.png?size=64" alt="" />\`
        : \`<span class="icon">\${h(g.name.slice(0, 1))}</span>\`}
      <span class="name">\${h(g.name)}</span>
      \${tag ? \`<span class="tag">\${tag}</span>\` : ''}
    </button>\`;
  const members = (g) =>
    g.members == null ? '' : icon('users') + num(g.members);
  const section = (title, cards) => \`<h2>\${title}</h2><div class="servers">\${cards}</div>\`;

  // Three states: nowhere to add it, nothing added yet, or a real list.
  document.getElementById('lists').innerHTML =
    !me.guilds.length
      ? \`<div class="empty">You don't manage any Discord servers. Quorum can only be added
         by someone with <strong>Manage Server</strong>.</div>\`
      : (running.length
          ? section('running quorum', running.map((g) => card(g, members(g))).join(''))
          : \`<h2>running quorum</h2>
             <div class="empty">No server has Quorum yet - pick one below to add it.</div>\`) +
        (missing.length
          ? section('add quorum to', missing.map((g) => card(g, icon('plus') + 'add')).join(''))
          : '');

  document.getElementById('lists').onclick = (e) => {
    const el = e.target.closest('.server');
    if (!el) return;
    const g = me.guilds.find((x) => x.id === el.dataset.id);
    if (g.installed) {
      location.href = '/g/' + g.id;
      return;
    }
    el.setAttribute('aria-current', 'true');
    // Discord's own authorize screen is the permission picker - it shows what
    // Quorum is asking for and won't grant anything the inviter doesn't have.
    // New tab, because coming back to a configured dashboard beats a redirect.
    window.open(g.invite, '_blank', 'noopener');
  };
}

/** Coming back from the invite tab should just show the server as added, so
 *  re-read /api/me on focus. No polling - the tab regaining focus is the
 *  only moment anything can have changed. */
function watchForInvites() {
  addEventListener('focus', async () => {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const next = await res.json();
    if (JSON.stringify(next.guilds) === JSON.stringify(me.guilds)) return;
    me = next;
    renderHome();
  });
}

const PANES = [
  ['overview', 'overview', 'gauge'],
  ['setup', 'setup', 'sliders'],
  ['queues', 'queues', 'layers'],
  ['matches', 'matches', 'swords'],
  ['ranks', 'ranks', 'trophy'],
  ['pool', 'scenarios', 'crosshair'],
  ['players', 'players', 'users'],
];

async function renderGuild(guild) {
  app.innerHTML = \`
    <header><h1><a href="/">\${mark()}Quorum</a></h1>\${whoBar()}</header>
    <div class="dash">
      <aside id="side">
        <div class="server">
          \${guild.icon
            ? \`<img class="icon" src="https://cdn.discordapp.com/icons/\${h(guild.id)}/\${h(guild.icon)}.png?size=64" alt="" />\`
            : \`<span class="icon">\${h(guild.name.slice(0, 1))}</span>\`}
          <span class="name">\${h(guild.name)}</span>
        </div>
        \${PANES.map(([id, label, ic]) => \`<a href="#\${id}">\${icon(ic)}\${label}</a>\`).join('')}
        <a class="back" href="/">\${icon('back')}all servers</a>
      </aside>
      <div id="pane"><div class="empty">loading…</div></div>
    </div>\`;
  startRays();

  const box = document.getElementById('pane');
  const data = await (await fetch('/api/guild/' + guild.id)).json();

  const NONE = [{ id: '', name: 'none' }];

  // A tile with somewhere to go is a button; the rest are plain.
  // Every tile is one line of label. A wrapped label makes the icon float
  // against two lines and the row of tiles go ragged, so detail rides along
  // with the number instead.
  const stat = (n, label, ic, to, sub, title) => {
    const tag = to ? 'button' : 'div';
    return \`<\${tag} class="stat"\${to ? \` data-go="\${to}"\` : ''}\${
      title ? \` title="\${h(title)}"\` : ''}>
       <div class="n">\${n}\${sub ? \`<span class="sub">\${h(sub)}</span>\` : ''}</div>
       <div class="k">\${icon(ic)}\${label}</div>
     </\${tag}>\`;
  };
  // Anything unticked is a job, so it links to the pane that fixes it. The ping
  // role is left out - a match runs fine without one.
  const step = (ok, label, to) =>
    \`<div class="\${ok ? 'ok' : ''}">\${icon(ok ? 'check' : 'dash')}\${
      ok ? h(label) : \`<button type="button" class="link" data-go="\${to}">\${h(label)}</button>\`}</div>\`;
  const live = data.matches.filter((m) => m.status === 'live').length;
  // ranks come back highest-first, so the first one you clear is yours.
  const rankOf = (elo) => data.ranks.find((r) => elo >= r.min_elo);
  const todo = [
    !data.config.panel_channel_id,
    !data.config.results_channel_id,
    !data.config.voice_category_id,
    !data.scenarios.length,
    !data.ranks.length,
  ].filter(Boolean).length;

  box.innerHTML = \`
    <section id="overview">
    <h2>overview</h2>
    <div class="stats">
      \${stat(num(guild.members) ?? '-', 'members', 'users')}
      \${stat(data.matches.length, 'in play', 'swords', 'matches',
              live ? live + ' running' : '', 'open or running right now')}
      \${stat(num(data.stats.played), 'played', 'check', null, '', 'matches finished all time')}
      \${stat(num(data.stats.week), 'last 7 days', 'gauge', null, '', 'matches finished this week')}
      \${stat(num(data.stats.rated), 'rated', 'trophy', 'players', '', 'players with a record')}
    </div>

    <h2>ready to run</h2>
    <p class="muted">\${todo
      ? \`\${todo} thing\${todo > 1 ? 's' : ''} left before Quorum can run a match here.\`
      : 'Everything is set. Post the queue panel and you are live.'}</p>
    <div class="check">
      \${step(!!data.config.panel_channel_id, 'queue channel', 'setup')}
      \${step(!!data.config.results_channel_id, 'results channel', 'setup')}
      \${step(!!data.config.voice_category_id, 'voice category', 'setup')}
      \${step(data.scenarios.length > 0, \`scenario pool (\${data.scenarios.length})\`, 'pool')}
      \${step(data.ranks.some((r) => r.discord_role_id),
              \`rank roles (\${data.ranks.filter((r) => r.discord_role_id).length}/\${data.ranks.length})\`,
              'ranks')}
    </div>

    <h2>top of the ladder</h2>
    \${data.top.length
      ? '<table class="ladder"><tbody>' + data.top.map((p, n) => {
          const rank = rankOf(p.elo);
          return \`
          <tr>
            <td class="hint" style="width:1px">\${n + 1}</td>
            <td style="width:100%">\${h(p.kovaaks_username)}</td>
            <td style="white-space:nowrap">\${rank
              ? \`<span class="rank" style="--c:\${h(rank.color)}"><span class="dot"></span>\${h(rank.name)}</span>\`
              : ''}</td>
            <td class="hint" style="white-space:nowrap">\${p.wins}W \${p.losses}L</td>
            <td><strong>\${p.elo}</strong></td>
          </tr>\`;
        }).join('') + '</tbody></table>'
      : '<p class="muted">Nobody has finished a match yet.</p>'}
    </section>

    <section id="setup">
    <h2>setup</h2>
    <div class="field">
      <label>Queue channel <span class="hint">- where the panel and open calls live</span></label>
      \${selectField('panel', NONE.concat(data.channels), data.config.panel_channel_id)}
    </div>
    <div class="field">
      <label>Results channel <span class="hint">- where finished matches get posted</span></label>
      \${selectField('results', NONE.concat(data.channels), data.config.results_channel_id)}
    </div>
    <div class="field">
      <label>Voice category <span class="hint">- match voice channels are made here</span></label>
      <div class="row">
        \${selectField('voice', NONE.concat(data.categories), data.config.voice_category_id)}
        <button class="btn" id="mkcat">New category</button>
      </div>
    </div>
    <div class="field">
      <label>Extra ping role <span class="hint">- for people who want every call. The ranks a call can admit are already pinged.</span></label>
      \${selectField('ping', NONE.concat(data.roles), data.config.ping_role_id)}
    </div>
    <div class="bar">
      <button class="btn solid" id="save">Save</button>
      <button class="btn" id="panelbtn">Post panel</button>
      <span class="status" id="status"></span>
    </div>
    </section>

    <section id="queues">
    <h2>queues</h2>
    <p class="muted">How far apart two people's ranks may be for a queue to let them in, checked against everyone already in the lobby rather than just whoever opened it. Opening a call pings exactly these ranks, so nobody is notified about a game they'd be turned away from.</p>
    <div id="queuebox"></div>
    <div class="bar">
      <button class="btn solid" id="savequeues">Save queues</button>
      <span class="status" id="queuestatus"></span>
    </div>
    </section>

    <section id="matches">
    <h2>matches in play</h2>
    <p class="muted">Force finish scores a match from whatever KovaaK's has right now; cancel bins it with no rating change.</p>
    <div id="matchlist"></div>
    </section>

    <section id="ranks">
    <h2>ranks</h2>
    <p class="muted">Each rank becomes a Discord role, named and coloured to match, handed out when someone's rating crosses it. Saving here creates them; a call then pings the ones it can admit, which is what keeps one shared queue channel workable.</p>
    <table><tbody id="ranklist"></tbody></table>
    <div class="bar">
      <button class="btn" id="addrank">Add rank</button>
      <button class="btn solid" id="saveranks">Save ranks</button>
      <span class="status" id="rankstatus"></span>
    </div>
    </section>

    <section id="pool">
    <h2>scenario pool</h2>
    <p class="muted">A match rolls one scenario per category. Search pulls real names off KovaaK's, so a score lookup can't miss on a typo.</p>
    <div id="poolbox"></div>
    <div class="bar">
      <button class="btn" id="addcat">Add category</button>
      <button class="btn solid" id="savepool">Save pool</button>
      <span class="status" id="poolstatus"></span>
    </div>
    </section>

    <section id="players">
    <h2>players</h2>
    <p class="muted">Tier only seeds a starting rating, and only before someone has played - after that their record is the truth. Who may play whom is set per queue, not here.</p>
    <table class="ladder"><tbody id="playerlist"></tbody></table>
    <div class="bar">
      <button class="btn solid" id="savetiers">Save tiers</button>
      <span class="status" id="tierstatus"></span>
    </div>
    </section>\`;

  // One pane visible at a time, remembered in the hash so a pane is linkable
  // and survives a refresh. \`hidden\` does the hiding - no class to define.
  const show = (id) => {
    const wanted = PANES.some(([p]) => p === id) ? id : PANES[0][0];
    box.querySelectorAll('section').forEach((s) => (s.hidden = s.id !== wanted));
    document
      .querySelectorAll('#side a[href^="#"]')
      .forEach((a) => a.setAttribute('aria-current', String(a.hash === '#' + wanted)));
    if (location.hash !== '#' + wanted) history.replaceState(null, '', '#' + wanted);
  };
  document.querySelectorAll('#side a[href^="#"]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); show(a.hash.slice(1)); };
  });
  show(location.hash.slice(1));
  box.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => show(el.dataset.go)));

  wireSelects(box);

  // How many bands apart a queue tolerates, per format. Showing who that
  // actually lets in beats explaining the number.
  const ladder = [...data.ranks].sort((a, b) => b.min_elo - a.min_elo);
  const spread = { ...data.spread };
  const spreadOpts = ladder.map((_, n) => ({
    id: String(n),
    name: n === 0 ? 'same rank only' : n === 1 ? 'one rank either side' : n + ' ranks either side',
  }));
  const example = (n) => {
    if (!ladder.length) return 'Add a rank ladder first.';
    const mid = Math.min(1, ladder.length - 1);
    const from = Math.max(0, mid - n);
    const reach = ladder.slice(from, mid + n + 1);
    return \`\${h(ladder[mid].name)} queues with \${reach.map((r) =>
      \`<span class="rank" style="--c:\${h(r.color)}"><span class="dot"></span>\${h(r.name)}</span>\`).join('')}\`;
  };
  const drawQueues = () => {
    document.getElementById('queuebox').innerHTML = data.formats.map((f) => \`
      <div class="cat">
        <div class="cat-top"><strong>\${h(f)}</strong></div>
        \${selectField('sp-' + f, spreadOpts, String(spread[f] ?? 0), \`data-f="\${h(f)}"\`)}
        <div class="reach">\${example(spread[f] ?? 0)}</div>
      </div>\`).join('');
    const scope = document.getElementById('queuebox');
    wireSelects(scope);
    scope.querySelectorAll('.sel').forEach((el) => (el.onchange = () => {
      spread[el.dataset.f] = Number(el.dataset.value);
      drawQueues();
    }));
  };
  drawQueues();

  document.getElementById('savequeues').onclick = async () => {
    const el = document.getElementById('queuestatus');
    el.textContent = 'saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/queues\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spread }),
    });
    el.textContent = res.ok ? 'saved' : 'save failed';
  };

  const status = (msg) => (document.getElementById('status').textContent = msg);

  document.getElementById('mkcat').onclick = async () => {
    const name = await ask('Category name', 'Quorum');
    if (!name) return;
    const res = await fetch(\`/api/guild/\${guild.id}/category\`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return status('could not create it');
    const cat = await res.json();
    const sel = document.getElementById('voice');
    sel.querySelector('.sel-list').insertAdjacentHTML('beforeend',
      \`<li role="option" tabindex="-1" data-value="\${h(cat.id)}" aria-selected="false">\${h(cat.name)}</li>\`);
    pickOption(sel, cat.id);
    status('category created');
  };

  const drawMatches = (matches) => {
    const box = document.getElementById('matchlist');
    if (!matches.length) {
      box.innerHTML = '<div class="empty">Nothing in play.</div>';
      return;
    }
    box.innerHTML = '<div class="matches">' + matches.map((m) => \`
      <div class="match">
        <div class="match-top">
          <strong>\${h(m.format)}</strong>
          <span class="hint">#\${m.id}</span>
          <span class="pill\${m.status === 'live' ? ' live' : ''}">\${
            m.status === 'live' ? 'running'
              : m.status === 'banning' ? 'banning scenarios'
              : 'waiting for a taker'}</span>
          <span class="hint">\${ago(m.started_at ?? m.created_at)}</span>
        </div>
        <div class="roster">\${m.players.map((p) => \`
          <span class="pl\${p.done ? ' done' : ''}">
            <img src="\${avatarUrl(p)}" alt="" />\${h(p.name)}\${p.done ? icon('check') : ''}
          </span>\`).join('')}</div>
        \${m.scenarios.length
          ? \`<div class="chips">\${m.scenarios.map((s) => \`<span class="chip">\${h(s)}</span>\`).join('')}</div>\`
          : ''}
        <div class="match-act">
          \${m.status === 'live' ? \`<button class="btn" data-finish="\${m.id}">Force finish</button>\` : ''}
          <button class="btn" data-cancel="\${m.id}">Cancel</button>
        </div>
      </div>\`).join('') + '</div>';

    const act = async (id, verb) => {
      box.innerHTML = '<div class="hint">working…</div>';
      await fetch(\`/api/guild/\${guild.id}/match/\${id}/\${verb}\`, { method: 'POST' });
      const fresh = await (await fetch('/api/guild/' + guild.id)).json();
      drawMatches(fresh.matches);
    };
    box.querySelectorAll('[data-finish]').forEach((el) => (el.onclick = () => act(el.dataset.finish, 'finish')));
    box.querySelectorAll('[data-cancel]').forEach((el) => (el.onclick = () => act(el.dataset.cancel, 'cancel')));
  };
  drawMatches(data.matches);

  let ranks = data.ranks.slice();
  const drawRanks = () => {
    document.getElementById('ranklist').innerHTML = ranks.map((r, n) => \`
      <tr>
        <td>\${colorField(r.color, \`data-n="\${n}"\`)}</td>
        <td style="width:100%"><input type="text" value="\${h(r.name)}" data-n="\${n}" data-k="name" /></td>
        <td><input type="number" value="\${Number(r.min_elo)}" data-n="\${n}" data-k="min_elo" /></td>
        <td><button class="icon-btn" data-del="\${n}" title="remove">×</button></td>
      </tr>\`).join('');
    wireColors(document.getElementById('ranklist'));
    document.querySelectorAll('#ranklist .col').forEach((el) => {
      el.onchange = () => (ranks[el.dataset.n].color = el.dataset.value);
    });
    document.querySelectorAll('#ranklist input[data-k]').forEach((el) => {
      el.oninput = () => {
        const v = el.dataset.k === 'min_elo' ? Number(el.value) : el.value;
        ranks[el.dataset.n][el.dataset.k] = v;
      };
    });
    document.querySelectorAll('#ranklist [data-del]').forEach((el) => {
      el.onclick = () => { ranks.splice(Number(el.dataset.del), 1); drawRanks(); };
    });
  };
  drawRanks();
  document.getElementById('addrank').onclick = () => {
    ranks.push({ name: 'New rank', min_elo: 0, color: '#888888' });
    drawRanks();
  };
  document.getElementById('saveranks').onclick = async () => {
    const el = document.getElementById('rankstatus');
    el.textContent = 'saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/ranks\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ranks }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) { ranks = out.ranks; drawRanks(); el.textContent = 'saved, roles synced'; }
    else el.textContent = out.error ?? 'save failed';
  };

  // Categories live in their own list so a new, still-empty one survives until
  // something is put in it - the saved shape is a flat (category, name) list.
  let pool = data.scenarios.map((s) => ({ ...s }));
  let cats = [...new Set(pool.map((s) => s.category))];
  let openCat = null;
  const poolBox = document.getElementById('poolbox');

  const drawPool = () => {
    poolBox.innerHTML = cats.length
      ? cats.map((cat) => {
          const rows = pool.map((s, i) => ({ ...s, i })).filter((r) => r.category === cat);
          return \`
        <div class="cat">
          <div class="cat-top">
            <strong>\${h(cat)}</strong>
            <span class="hint">\${rows.length} scenario\${rows.length === 1 ? '' : 's'}</span>
            <button class="icon-btn" data-delcat="\${h(cat)}" title="remove category">\${icon('x')}</button>
          </div>
          <div class="chips">
            \${rows.map((r) => \`<span class="chip">\${h(r.name)}
              <button class="icon-btn" data-del="\${r.i}" title="remove">\${icon('x')}</button></span>\`).join('')}
            <button class="chip add" data-add="\${h(cat)}">\${icon('plus')}scenario</button>
          </div>
          \${openCat === cat ? \`<div class="scn">
            <input type="text" class="scn-q" placeholder="search KovaaK's scenarios" spellcheck="false" />
            <div class="scn-out hint">Type at least 2 characters.</div>
          </div>\` : ''}
        </div>\`;
        }).join('')
      : '<div class="empty">No categories yet. Add one to start the pool.</div>';

    poolBox.querySelectorAll('[data-delcat]').forEach((el) => (el.onclick = () => {
      cats = cats.filter((c) => c !== el.dataset.delcat);
      pool = pool.filter((s) => s.category !== el.dataset.delcat);
      drawPool();
    }));
    poolBox.querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => {
      pool.splice(Number(el.dataset.del), 1);
      drawPool();
    }));
    poolBox.querySelectorAll('[data-add]').forEach((el) => (el.onclick = () => {
      openCat = openCat === el.dataset.add ? null : el.dataset.add;
      drawPool();
      poolBox.querySelector('.scn-q')?.focus();
    }));

    const q = poolBox.querySelector('.scn-q');
    if (!q) return;
    const out = poolBox.querySelector('.scn-out');
    let timer;
    // debounced: every keystroke hitting KovaaK's would be rude and slower.
    q.oninput = () => {
      clearTimeout(timer);
      const term = q.value.trim();
      if (term.length < 2) { out.textContent = 'Type at least 2 characters.'; return; }
      out.textContent = 'searching…';
      timer = setTimeout(async () => {
        const res = await fetch('/api/scenarios?q=' + encodeURIComponent(term)).catch(() => null);
        const hits = res?.ok ? (await res.json()).scenarios : null;
        if (!hits) { out.textContent = "KovaaK's did not answer."; return; }
        if (!hits.length) { out.textContent = 'Nothing matched.'; return; }
        out.innerHTML = hits.map((sc) => \`
          <button type="button" class="scn-hit" data-name="\${h(sc.name)}">
            <span>\${h(sc.name)}</span>
            <span class="hint">\${h(sc.aimType)}\${sc.plays ? ' · ' + num(sc.plays) + ' plays' : ''}</span>
          </button>\`).join('');
        out.querySelectorAll('[data-name]').forEach((b) => (b.onclick = () => {
          const name = b.dataset.name;
          if (!pool.some((s) => s.category === openCat && s.name === name)) {
            pool.push({ category: openCat, name });
          }
          openCat = null;
          drawPool();
        }));
      }, 250);
    };
  };
  drawPool();

  document.getElementById('addcat').onclick = async () => {
    const name = (await ask('Category name'))?.slice(0, 60);
    if (!name || cats.includes(name)) return;
    cats.push(name);
    openCat = name;
    drawPool();
    poolBox.querySelector('.scn-q')?.focus();
  };

  document.getElementById('savepool').onclick = async () => {
    const el = document.getElementById('poolstatus');
    const scenarios = pool;
    const res = await fetch(\`/api/guild/\${guild.id}/scenarios\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarios }),
    });
    const out = await res.json().catch(() => ({}));
    el.textContent = res.ok ? \`saved \${out.scenarios.length} scenarios\` : out.error ?? 'save failed';
  };

  const tiers = {};
  document.getElementById('playerlist').innerHTML = data.players.length
    ? data.players.map((p) => {
        const rank = rankOf(p.elo);
        return \`
      <tr>
        <td style="width:1px"><img class="pfp" src="\${avatarUrl({ id: p.discord_id, avatar: p.avatar })}" alt="" /></td>
        <td style="width:100%">
          \${h(p.kovaaks_username)}
          <span class="hint">\${p.wins}W \${p.losses}L</span>
        </td>
        <td style="white-space:nowrap">\${voltaicChip(p.voltaic)}</td>
        <td style="white-space:nowrap">\${rank
          ? \`<span class="rank" style="--c:\${h(rank.color)}"><span class="dot"></span>\${h(rank.name)}</span>\`
          : ''}</td>
        <td style="white-space:nowrap"><strong>\${p.elo}</strong></td>
        <td style="white-space:nowrap">\${p.wins + p.losses
          ? \`<span class="hint" title="tier only seeds a starting rating, and they have already played">\${h(p.tier)}</span>\`
          : \`<div class="seg" data-id="\${h(p.discord_id)}" data-value="\${h(p.tier)}" role="radiogroup" aria-label="tier">\${
              data.tiers.map((t) => \`<button type="button" role="radio" data-t="\${t}"
                aria-checked="\${t === p.tier}">\${t}</button>\`).join('')}</div>\`}</td>
      </tr>\`;
      }).join('')
    : '<tr><td class="hint">Nobody has played yet.</td></tr>';
  // Four short, mutually exclusive values: a segmented control, not a popup.
  // And only for players with no games - setTier refuses to reseed anyone else,
  // so offering the control there would be a lie.
  document.querySelectorAll('#playerlist .seg').forEach((seg) => {
    seg.onclick = (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      seg.dataset.value = b.dataset.t;
      tiers[seg.dataset.id] = b.dataset.t;
      seg.querySelectorAll('[data-t]').forEach((n) => n.setAttribute('aria-checked', String(n === b)));
    };
  });
  document.getElementById('savetiers').onclick = async () => {
    const el = document.getElementById('tierstatus');
    const body = Object.entries(tiers).map(([discord_id, tier]) => ({ discord_id, tier }));
    const res = await fetch(\`/api/guild/\${guild.id}/tiers\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiers: body }),
    });
    el.textContent = res.ok ? 'saved' : 'save failed';
  };

  document.getElementById('save').onclick = async () => {
    const body = {
      panel_channel_id: document.getElementById('panel').dataset.value || null,
      results_channel_id: document.getElementById('results').dataset.value || null,
      voice_category_id: document.getElementById('voice').dataset.value || null,
      ping_role_id: document.getElementById('ping').dataset.value || null,
    };
    const res = await fetch('/api/guild/' + guild.id, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    status(res.ok ? 'saved' : 'save failed');
  };

  document.getElementById('panelbtn').onclick = async () => {
    status('posting…');
    const res = await fetch(\`/api/guild/\${guild.id}/panel\`, { method: 'POST' });
    status(res.ok ? 'panel posted' : (await res.json().catch(() => ({}))).error ?? 'failed');
  };
}

boot();
</script>
</body>
</html>`;
