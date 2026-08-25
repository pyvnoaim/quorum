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
    --bad: #f0666b;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #fafafa; --fg: #111; --muted: #6b6b6b; --line: #e2e2e2; --panel: #fff; --bad: #c0392b; }
  }
  body {
    background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased; min-height: 100vh;
    /* A flex container also stops main's margins collapsing out through body,
       which is what made a 100vh page 100vh+26 and scroll with nothing to
       scroll to. safe-centring keeps a pane taller than the viewport reachable -
       plain centring would push its top off the top edge. */
    display: flex; flex-direction: column; align-items: center; justify-content: safe center;
  }
  main { width: 100%; max-width: 720px; padding: 64px 24px; position: relative; }
  /* The signed-in page is a framed slab on the page background. Not on the
     sign-in page - there the card is the content and a full-height slab behind
     it has nothing to hold. */
  main:not(:has(.login)) {
    margin: 26px 0; border: 1px solid var(--line); border-radius: 18px;
    background: var(--bg);
    /* even top and bottom: the slab is a card, and 24px more under the last row
       than over the header reads as the content having slipped upwards. */
    padding: 40px 32px;
  }
  @media (max-width: 760px) {
    main:not(:has(.login)) { margin: 0; border: 0; border-radius: 0; padding: 32px 20px; }
  }
  #bg { position: fixed; inset: 0; width: 100%; height: 100%; display: none; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 48px; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.025em; }
  h1 a, h1 > span { display: flex; align-items: center; gap: 9px; }
  .mark { width: 17px; height: 17px; }
  .login .mark { width: 42px; height: 42px; margin: 0 auto 20px; }
  h2 { font-size: 14px; font-weight: 600; color: var(--fg); margin-bottom: 12px; letter-spacing: -0.01em; }
  /* stacked sections need air between them; the first one already sits under the header. */
  #lists h2:not(:first-child) { margin-top: 36px; }
  /* here it reads as a line under its heading, not as a standalone panel. */
  #lists .empty { padding: 0; }
  /* a server's own page is two columns and wants more room than the home list. */
  main:has(.dash) { max-width: 1040px; }
  /* One size, whatever the pane. Overview is short and History is 25 rows, so
     a container sized to its contents resizes under you on every tab change.
     The pane scrolls inside a fixed frame instead. */
  main:has(.dash) { height: min(900px, calc(100dvh - 52px)); display: flex; flex-direction: column; }
  main:has(.dash) .dash { flex: 1; min-height: 0; align-items: stretch; }
  /* The frame no longer scrolls, so there is nothing for the sidebar to stick
     to - and its rows have to be told to keep their own height, or a grid
     stretched down a 900px frame shares all that space out between them. */
  main:has(.dash) #side { position: static; align-content: start; }
  #pane {
    min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    /* the gutter is reserved whether or not this pane needs a scrollbar, so
       the bar never lands on the content and switching panes never shifts it */
    scrollbar-gutter: stable; padding-right: 14px;
  }
  /* The pane carries the scrollbar, so its cards are inset from the frame edge.
     The header sits outside that frame and has to take the same inset, or the
     Sign out button hangs off the right of everything below it. */
  main:has(.dash) header { padding-right: 14px; }
  .dash { display: grid; grid-template-columns: 190px 1fr; gap: 48px; align-items: start; }
  #side { position: sticky; top: 32px; display: grid; gap: 2px; }
  /* In the sidebar this card is a label saying which server you are editing -
     it goes nowhere, so it must not light up under the cursor like the ones on
     the home list that do. */
  #side .server { cursor: default; margin-bottom: 14px; padding: 10px 12px; }
  #side .server:hover { border-color: var(--line); }
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
    /* full-bleed on a phone: a fixed frame with its own scrollbar inside the
       page's scrollbar is two scrollbars for one column of content. */
    main:has(.dash) { height: auto; }
    /* No inner scrollbar here, so no gutter to reserve either - left on, that
       14px was an inset down the right of every pane and nothing down the left,
       which reads as the content sitting crooked in the frame. */
    #pane { overflow: visible; padding-right: 0; scrollbar-gutter: auto; }
    main:has(.dash) header { padding-right: 0; }
    .dash { grid-template-columns: 1fr; gap: 28px; }
    /* narrow enough that five across squeezes the labels - let them wrap here. */
    .stats { grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); }
    /* Wrapped, not scrolled sideways: eight panes in a strip that runs off the
       edge hides half the dashboard behind a gesture nothing on the page hints
       at. Two or three rows of them are all visible at once. */
    #side {
      position: static; display: flex; flex-wrap: wrap; gap: 6px;
      padding-bottom: 4px; border-bottom: 1px solid var(--line);
    }
    #side a { padding: 7px 10px; }
    #side .server, #side .back { display: none; }
  }
  svg { width: 15px; height: 15px; flex: none; }
  .who { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .who img { width: 30px; height: 30px; border-radius: 999px; }
  .who .name { display: grid; line-height: 1.35; margin-right: 4px; }
  .who .name strong { color: var(--fg); font-weight: 500; font-size: 13px; }
  .who .name span { font-size: 12px; }
  /* one row, always - five cards that wrap read as two ragged groups, not an overview. */
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
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
  /* how far off being able to run a match this server is, in one glance. */
  .progress { height: 3px; border-radius: 999px; background: var(--line); margin: -4px 0 14px; }
  .progress i { display: block; height: 100%; border-radius: 999px; background: var(--fg); transition: width .3s; }
  .check {
    border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
    overflow: hidden; font-size: 14px;
  }
  .check > * {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 11px 14px; font: inherit; text-align: left;
    color: var(--fg); background: none; border: 0;
  }
  .check > * + * { border-top: 1px solid var(--line); }
  /* done recedes and outstanding leads: the jobs left are the only reason to
     read this block, so they must not be the quiet half of it. */
  .check > .ok { color: var(--muted); }
  .check .todo { cursor: pointer; transition: background .15s; }
  .check .todo:hover { background: var(--bg); }
  .check .go { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .check .todo:hover .go { color: var(--fg); }
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
  /* An inline-flex box takes its baseline from its first child, and these two
     have different ones - an 8px dot against an 18px icon - so left on
     baselines their labels sit at different heights. Both align on their own
     middle instead, which is where the label already sits in each. */
  .rank {
    display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
    vertical-align: middle;
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
  .btn:has(svg) { display: inline-flex; align-items: center; gap: 8px; }
  /* the mark is wider than it is tall, so it cannot take the square svg size */
  .btn svg[viewBox^="0 0 127"] { width: 18px; height: auto; }
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
  /* Voltaic standing reads as a rank, not a badge - same size and rhythm as the
     ladder rank beside it, with the icon doing what that one's dot does. A
     bordered chip next to a bare rank makes the two look like different kinds
     of thing when they are the same kind of thing. */
  .volt {
    display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
    font-size: 13px; color: var(--fg); vertical-align: middle;
  }
  /* 16, not 18: the icon should read as the same weight as the dot beside it,
     not as the tallest thing in the row. */
  .volt img { width: 16px; height: 16px; object-fit: contain; }
  .volt .done { color: var(--muted); }
  h1 a { text-decoration: none; }
  /* Panes stack headed blocks, same as the home list does - a second heading
     needs air above it wherever it appears, Matches included. */
  #pane h2:not(:first-child) { margin-top: 32px; }
  .field { margin-bottom: 22px; }
  /* A field's own bottom margin stacks on the action bar's top margin, which
     made Setup's Save sit 54px down while every other pane's sat at 32. The
     bar owns that gap. */
  .field:has(+ .bar) { margin-bottom: 0; }
  label { display: block; font-size: 13px; margin-bottom: 6px; }
  label .hint { color: var(--muted); }
  /* The name in the players pane is the way to their page - underlined on
     hover only, or every row reads as a wall of links. */
  .pname { color: inherit; text-decoration: none; }
  .pname:hover { text-decoration: underline; }
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
  .cat + .cat, #queuebox { margin-top: 10px; }
  /* the one corner of the dashboard that destroys things, and it should look
     like it long before anyone reaches the button. */
  /* the whole card carries the warning, not just the button */
  .cat.danger {
    border-color: color-mix(in srgb, var(--bad) 45%, var(--line));
    background: color-mix(in srgb, var(--bad) 12%, var(--panel));
  }
  .cat.danger .cat-top strong { color: var(--bad); }
  .cat.danger .bar { margin-top: 16px; flex-wrap: wrap; }
  .cat.danger .bar .opt { margin-right: auto; }
  /* a live match's board: what has been put on each scenario, and who leads it */
  .score {
    font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px;
    color: var(--fg); background: var(--bg); border: 1px solid var(--line);
    border-radius: 5px; padding: 1px 7px;
  }
  .sb-wrap { overflow-x: auto; }
  .sb { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  .sb th {
    text-align: right; font-weight: 500; color: var(--muted); font-size: 11.5px;
    letter-spacing: .06em; text-transform: uppercase; padding: 0 0 4px 12px;
  }
  .sb th:first-child { text-align: left; }
  .sb td { text-align: right; padding: 3px 0 3px 12px; color: var(--muted); white-space: nowrap; }
  /* the wrapper scrolls rather than the name truncating: a scenario nobody can
     read the name of is worse than a board that moves sideways on a phone */
  .sb .sb-name { text-align: left; color: var(--fg); width: 100%; padding-left: 0; }
  .sb .sb-lead { color: var(--fg); font-weight: 600; }
  /* Something is wrong in the server rather than in the settings - a missing
     permission breaks whatever it is asked for next, so it says so above the
     fields that would otherwise fail quietly. */
  .notice {
    border: 1px solid color-mix(in srgb, var(--bad) 45%, var(--line));
    background: color-mix(in srgb, var(--bad) 12%, var(--panel));
    border-radius: 10px; padding: 14px 16px; margin-bottom: 22px; font-size: 13px;
  }
  .notice strong { display: block; font-size: 14px; color: var(--bad); margin-bottom: 6px; }
  .notice p { color: var(--muted); }
  .notice p + p { margin-top: 6px; }
  .notice b { color: var(--fg); font-weight: 500; }
  .notice .btn { margin-top: 12px; }
  /* a radio list where every option carries its own description */
  .opts { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--bg); }
  .opts button {
    display: flex; align-items: baseline; gap: 11px; width: 100%; padding: 11px 14px;
    background: none; border: 0; color: var(--muted); font: inherit; text-align: left; cursor: pointer;
  }
  .opts button + button { border-top: 1px solid var(--line); }
  .opts button:hover { background: var(--panel); }
  .opts .mark {
    width: 13px; height: 13px; flex: none; position: relative; top: 2px;
    border: 1px solid var(--line); border-radius: 999px;
  }
  .opts [aria-checked="true"] .mark {
    border-color: var(--fg);
    background: radial-gradient(circle, var(--fg) 0 42%, transparent 46%);
  }
  .opts .oname { font-size: 14px; min-width: 88px; }
  .opts [aria-checked="true"] .oname { color: var(--fg); }
  .opts .odesc { font-size: 13px; }
  .btn.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); }
  .btn.bad:hover { border-color: var(--bad); }
  .btn.bad.solid { background: var(--bad); border-color: var(--bad); color: #fff; }
  .btn.bad.solid:disabled { opacity: .35; }
  /* the native checkbox is the last unstyled control here; accent-color is
     enough to stop it arriving as a stock blue in a red card. */
  .opt { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--muted); }
  .opt input[type=checkbox] { width: 15px; height: 15px; accent-color: var(--fg); cursor: pointer; }
  /* boxed so it sits level with the select fields above it rather than reading
     as a loose checkbox someone left under them. */
  .opt.boxed {
    border: 1px solid var(--line); border-radius: 6px; background: var(--panel);
    padding: 8px 11px; font-size: 14px; color: var(--fg); gap: 0;
  }
  .opt-hit { display: flex; align-items: center; gap: 9px; margin: 0; cursor: pointer; font-size: 14px; }
  .opt input[type=number] { width: 62px; margin: 0 9px; padding: 4px 8px; text-align: center; }
  /* The rating, and the pencil that corrects it. Visible always and muted, the
     same as the delete on a History row and for the same reason: a control that
     only appears under the cursor is a control a touch screen never has, and
     one nobody finds on any screen. */
  .rate-cell { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
  .rate-go { color: var(--muted); transition: color .12s; }
  .rate-go:hover, .rate-go:focus-visible { color: var(--fg); outline: none; }
  .rate-edit { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
  .rate-in { width: 84px; padding: 5px 8px; font-size: 13px; text-align: right; }
  .rate-ok { color: var(--fg); }
  .rate-no { color: var(--muted); }
  /* Their role says one bracket and their rating sits in another. Muted, not
     alarming - it is a thing to look at, not a fault. */
  .drift {
    background: none; border: 0; padding: 0; cursor: pointer;
    font-size: 12px; color: var(--muted); border-bottom: 1px dashed var(--line);
  }
  .drift:hover, .drift:focus-visible { color: var(--fg); outline: none; }
  .opt .unit { color: var(--muted); font-size: 13px; }
  /* Off replaces the sentence rather than trailing it: "Bin an untaken call
     after" says nothing once there is no number to follow it. */
  .off-note { display: none; }
  .opt.boxed:has(#autocancel:not(:checked)) .off-note { display: inline; color: var(--muted); }
  .opt.boxed:has(#autocancel:not(:checked)) .on-note,
  .opt.boxed:has(#autocancel:not(:checked)) .unit,
  .opt.boxed:has(#autocancel:not(:checked)) input[type=number] { display: none; }
  /* A category's title line is a sentence made of parts - it wraps between them
     and never inside one, so "main - one round a match" stays one phrase. */
  .cat-top { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; font-size: 14px; margin-bottom: 11px; }
  #poolbox .cat-top > .hint { white-space: nowrap; }
  .cat-top .icon-btn { margin-left: auto; }
  /* The "rolls into" picker rides on a card's title line, so it is sized to
     that line rather than to a form field. Its list needs a width of its own -
     stretched to a button this small it would be unreadable. */
  .cat-top .sel-btn { padding: 3px 8px; font-size: 12px; gap: 6px; }
  .cat-top .sel-btn svg { width: 11px; }
  .cat-top .sel-list { right: auto; min-width: 130px; }
  .chip .icon-btn { padding: 0 0 0 3px; }
  .chip .icon-btn svg { width: 12px; height: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 3px; }
  .chip.add { cursor: pointer; gap: 5px; color: var(--fg); border-style: dashed; }
  .chip.add:hover { border-color: var(--fg); }
  /* which ranks a category is offered to: picked reads as on, the rest as off */
  .picks { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chip.pick { cursor: pointer; color: var(--muted); }
  .chip.pick:hover { border-color: var(--fg); }
  .chip.pick.on { color: var(--fg); border-color: var(--fg); }
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
  .reach { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  /* a panel whose children are rows, divided rather than boxed */
  .cat.rows { padding: 0; }
  .qrow {
    display: grid; grid-template-columns: 68px 210px 1fr; align-items: center; gap: 14px;
    padding: 12px 15px;
  }
  .qrow + .qrow { border-top: 1px solid var(--line); }
  .qrow > strong { font-size: 14px; }
  @media (max-width: 620px) {
    .qrow { grid-template-columns: 1fr; gap: 8px; }
  }
  /* Format's rows are label + number. Not .qrow: that first column is 68px
     because the queues pane puts a rank chip in it, which squeezes a sentence
     into one word a line. Sits inside .cat, so no padding of its own sideways. */
  .frow {
    display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 18px;
    padding: 13px 0;
  }
  .frow + .frow { border-top: 1px solid var(--line); }
  .frow label { font-size: 14px; }
  @media (max-width: 620px) {
    .frow { grid-template-columns: 1fr; gap: 8px; }
  }
  /* Seven ranks means seven of every control here, so they are sized for a
     list rather than for a form with three fields in it. */
  #ranklist td { padding: 3px 8px 3px 0; }
  #ranks table { margin-top: 20px; }
  #ranklist input { padding: 6px 10px; }
  #ranklist input[type=number] { width: 88px; }
  #ranklist .col-btn { width: 28px; height: 28px; }
  .th td { font-size: 12px; color: var(--muted); padding-bottom: 6px; }
  /* history: one match per line, so the row has to stay a line - names run
     inline and the placing is carried by order and weight, not by a column. */
  .hist td { padding: 9px 12px 9px 0; font-size: 13px; }
  /* Direct children only. As a descendant selector this also bordered the rows
     of the .hgrid nested inside an open row - and that table is width:auto, so
     every match drew a set of short lines that stopped halfway across the pane. */
  .hist > tbody > tr + tr { border-top: 1px solid var(--line); }
  .hp { color: var(--muted); white-space: nowrap; }
  .hp + .hp::before { content: '·'; margin: 0 7px; color: var(--line); }
  .hp.won { color: var(--fg); font-weight: 500; }
  .hp em { font-style: normal; margin-left: 5px; font-size: 12px; color: var(--muted); }
  .hrow { cursor: pointer; outline: none; }
  .hrow:hover td, .hrow:focus-visible td { color: var(--fg); }
  .hrow td:last-child { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .hrow svg { width: 13px; transition: transform .15s; }
  .hrow[aria-expanded="true"] svg { transform: rotate(180deg); }
  /* visible always, not hover-only: a control that appears on hover is a
     control a touch screen never has. Muted until you mean it. */
  .hdel { color: var(--muted); }
  .hdel:hover, .hdel:focus-visible { color: var(--bad); }
  .hdel svg { transform: none !important; }
  /* the detail row is always in the table and always empty-until-open, so
     nothing has to be built or fetched when it is clicked. */
  .hx > td { padding: 0; border: 0; }
  .hx:not(.open) { display: none; }
  .hx.open > td { padding: 4px 0 16px; }
  /* Full width, like the row it opens under - but fixed, or the name column
     soaks up every spare pixel and leaves the scores huddled on the right.
     Fixed splits what is left equally, so the columns line up with each other
     however long the scenario names are. */
  .hgrid { width: 100%; table-layout: fixed; }
  .hgrid td { padding: 4px 0 4px 22px; font-size: 12px; text-align: right; }
  .hgrid td:first-child { width: 22%; padding-left: 0; text-align: left; color: var(--muted); }
  /* a score never wraps; a long scenario name in the header may */
  .hgrid tr:not(.th) td { white-space: nowrap; }
  .hgrid .won { color: var(--fg); font-weight: 500; }
  /* The score that took the scenario. Heavier than the winner's NAME on purpose:
     reading a column of a scoreboard is scanning, and the eye should land on the
     number that won the round without having to compare two of them. */
  .hgrid td.took { color: var(--fg); font-weight: 700; }
  .banned { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .chip.out { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--line); }
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
    /* the button can be narrower than its longest option, and a table cell does
       not wrap: without this the list is clipped by the edge of the pane */
    min-width: max-content;
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
  /* last column of a table: open inwards, or it opens off the right edge */
  td .sel-list { left: auto; right: 0; }
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
  dialog .dlg-title { display: block; font-size: 15px; font-weight: 600; margin-bottom: 8px; }
  dialog .dlg-body { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  dialog label b { color: var(--fg); font-weight: 500; }
  .row { display: flex; gap: 8px; }
  .row > :first-child { flex: 1; }
  .bar { display: flex; align-items: center; gap: 12px; margin-top: 24px; }
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
  .icon-btn:disabled { opacity: .35; cursor: default; }
  .icon-btn:disabled:hover { color: var(--muted); }
  .muted { color: var(--muted); font-size: 13px; margin: -6px 0 14px; }
  .login p { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
  /* Phones. Everything above this point assumes a row has somewhere to put its
     third column; here it hasn't, so the rules below either fold the row or
     drop what a phone can do without. Nothing is hidden that is the reason
     someone opened the pane, and nothing is left to run off the edge - a page
     that scrolls sideways is one where half the controls are somewhere you
     cannot see. */
  @media (max-width: 620px) {
    header { margin-bottom: 32px; gap: 12px; }
    /* the name is the first thing that can go: the avatar already says who is
       signed in, and Sign out must stay reachable. */
    .who { min-width: 0; }
    .who .name { min-width: 0; }
    .who .name strong, .who .name span {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* an action bar that cannot fit its buttons puts them on the next line
       rather than off the edge. */
    .bar, .match-top, .cat-top, .reach { flex-wrap: wrap; }
    /* "Cancel a call after [30] minutes without a taker" is a sentence with a
       field in it - it wraps like one. */
    .opt.boxed { flex-wrap: wrap; row-gap: 6px; }
    .opt input[type=number] { margin-left: 0; }
    /* Tables lose a column rather than gaining a scrollbar. A scroll container
       here would clip the pickers that open downwards out of a cell - the seed
       picker in Players sits in the last column of one - and trade one row too
       wide for a second scrollbar on every pane. So: drop what a phone can do
       without, let names wrap, and let the inputs shrink with their column. */
    .ladder td, .hist td { overflow-wrap: anywhere; }
    #ranklist input[type=text] { width: 100%; }
    #ranklist input[type=number] { width: 68px; }
    /* Voltaic standing is an outside benchmark sitting beside this ladder's own
       rank and rating; on a phone those two come first. */
    .ladder td:nth-child(3) { display: none; }
    /* The match number and the scenario count are both in the row when you open
       it, so the closed row can spend its width on who played. Scoped to the
       row: the cell under it holds the whole opened match, and the one in an
       empty table holds the only sentence there is. */
    .hist .hrow td:nth-child(1), .hist .hrow td:nth-child(4) { display: none; }
    /* The score grid under an open match splits what is left equally between
       the scenarios played, so on a phone a four-scenario match hands each
       column about 60px. The gutter has to come down with it or the scores,
       which never wrap, spill out of the columns holding them. */
    .hgrid td { padding-left: 10px; font-size: 11px; }
  }
  /* Narrower than a phone in portrait with the keyboard's language bar up. The
     signed-in name goes entirely; the avatar and Sign out are the two things
     that have to survive to the last pixel. */
  @media (max-width: 430px) {
    .who .name { display: none; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
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
<main id="app"><div class="empty">Loading…</div></main>
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
  circle: '<circle cx="12" cy="12" r="8"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  // lucide 'rotate-ccw' - putting one rating back where it started
  undo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  // lucide 'pencil' - correcting a rating without throwing the record away
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  // lucide 'list-ordered' - the format IS an order of steps
  steps: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
};
/** Pinned to en-US: the page is written in English, and a German browser
 *  renders 1284 as "1.284", which reads as one point two eight four. */
const num = (n) => (n == null ? null : n.toLocaleString('en-US'));

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
};

const mark = () =>
  '<svg class="mark" viewBox="12 12 90 90" fill="currentColor" aria-hidden="true">' +
  ${JSON.stringify(MARK)} + '</svg>';

/** Discord's wordless mark. Filled, so it cannot go through icon() - that
 *  wraps everything in the stroke-only preset the lucide set needs. */
const discordMark = () =>
  \`<svg viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg>\`;

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

/** Type-the-name confirmation for something destructive. The button stays
 *  dead until the name matches, so the guard is visible rather than a rejection
 *  after the fact - and an "are you sure" nobody reads guards nothing. */
function confirmDanger({ title, body, name, confirm }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    /* Type-to-confirm only where a name is given. That ceremony belongs to the
       things with no undo at all - every rating in the server, or the bot
       itself - and putting it in front of smaller ones only teaches people to
       type the name without reading what is above it. */
    dlg.innerHTML = \`<form method="dialog">
      <strong class="dlg-title">\${h(title)}</strong>
      <p class="dlg-body">\${body}</p>
      \${name ? \`<label>Type <b>\${h(name)}</b> to confirm</label>
      <input type="text" name="v" autocomplete="off" spellcheck="false" />\` : ''}
      <div class="bar">
        <button class="btn bad solid" value="ok"\${name ? ' disabled' : ''}>\${h(confirm)}</button>
        <button class="btn" value="">Cancel</button>
      </div>
    </form>\`;
    document.body.append(dlg);
    const input = dlg.querySelector('input');
    const go = dlg.querySelector('button[value="ok"]');
    if (input) input.oninput = () => (go.disabled = input.value.trim() !== name);
    dlg.onclose = () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    };
    dlg.showModal();
    if (input) input.focus();
  });
}

/** Voltaic standing, styled as a rank. An unknown rank name still renders - the
 *  icon just falls away rather than the whole thing disappearing. */
const voltaicChip = (v) => {
  if (!v) return '';
  const art = RANK_ICONS[v.rank];
  return \`<span class="volt" title="Voltaic S5 \${h(v.difficulty)}\${
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

// Sessions live in memory, so every deploy signs everyone out - and a tab left
// open from before it then answers "Save failed" to everything, which reads as
// a broken dashboard rather than as a sign-in. One place, because otherwise
// every button needs the same check: a 401 means the session went, so show the
// login screen. Not /api/me itself - that is what the login screen asks, and
// reloading on its 401 would be a loop.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  if (res.status === 401 && !String(args[0]).includes('/api/me')) location.reload();
  return res;
};

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
    <a class="btn solid" href="/login">\${discordMark()}Continue with Discord</a>
  </div>\`;
  startWaves();
}

const startWaves = () =>
  startShader('fs', { uWave: [0.322, 0.153, 1], uCrest: [1, 0.624, 0.988], dpr: 1.5 });

// Signed in, the page is its background colour and nothing else - the shader
// is the sign-in page's alone.
/** Draws the background shader full-bleed behind the sign-in page. No WebGL2,
 *  no background - the page just stays its background colour, which is what
 *  the shader fades to anyway. Every view here is a full navigation, so this
 *  runs once and never needs tearing down. */
/** Which background is on the canvas, so navigating home -> a server doesn't
 *  stack a second draw loop on top of the first. */
let liveShader = null;

function startShader(fsId, opts) {
  if (liveShader?.id === fsId) return;
  liveShader?.stop();
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
  let stopped = false;
  const kick = () => { if (!raf && !stopped && !document.hidden) raf = requestAnimationFrame(draw); };
  liveShader = { id: fsId, stop: () => { stopped = true; cancelAnimationFrame(raf); raf = 0; } };
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
          ? section('Running Quorum', running.map((g) => card(g, members(g))).join(''))
          : \`<h2>Running Quorum</h2>
             <div class="empty">No server has Quorum yet - pick one below to add it.</div>\`) +
        (missing.length
          ? section('Add Quorum to', missing.map((g) => card(g, icon('plus') + 'Add')).join(''))
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
  ['overview', 'Overview', 'gauge'],
  ['setup', 'Setup', 'sliders'],
  ['format', 'Format', 'steps'],
  ['queues', 'Queues', 'layers'],
  ['matches', 'Matches', 'swords'],
  ['ranks', 'Ranks', 'trophy'],
  ['pool', 'Scenarios', 'crosshair'],
  ['players', 'Players', 'users'],
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
        <a class="back" href="/">\${icon('back')}All servers</a>
      </aside>
      <div id="pane"><div class="empty">Loading…</div></div>
    </div>\`;

  const box = document.getElementById('pane');
  const data = await (await fetch('/api/guild/' + guild.id)).json();

  const NONE = [{ id: '', name: 'None' }];

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
    ok
      ? \`<div class="ok">\${icon('check')}\${h(label)}</div>\`
      : \`<button type="button" class="todo" data-go="\${to}">\${icon('circle')}\${h(label)}
           <span class="go">Set up\${icon('arrow')}</span></button>\`;
  /* A lobby is a call nobody has taken - one person waiting, not a match being
     played. Counted in with the rest, the tile read "1 In play" on a server
     where nothing was being played at all. */
  const live = data.matches.filter((m) => m.status === 'live').length;
  const waiting = data.matches.filter((m) => m.status === 'lobby').length;
  const inPlay = data.matches.length - waiting;
  const playSub = [live ? live + ' running' : '', waiting ? waiting + ' waiting' : '']
    .filter(Boolean)
    .join(' · ');
  // ranks come back highest-first, so the first one you clear is yours.
  const rankOf = (elo) => data.ranks.find((r) => elo >= r.min_elo);
  /** What bracket to show beside somebody. With staff-owned brackets the ROLE
   *  is the bracket, so the rating cannot name one - on a ladder whose floors
   *  exist only to order it, reading a name off Elo prints a bracket they are
   *  not in. Nothing shown beats the wrong thing shown. */
  const bandOf = (p) =>
    data.rankMode === 'manual'
      ? (p.division != null ? data.ranks.find((r) => r.id === p.division) : undefined)
      : rankOf(p.elo);
  const perms = data.permissions ?? { missing: [], outranked: [], invite: '' };
  // Permissions lead: none of the three below can be done by a bot that has not
  // got them, so a server missing one is not three jobs away from running, it
  // is one job away from the other three being possible.
  const checks = [
    { ok: !perms.missing.length && !perms.outranked.length, label: 'Bot permissions', to: 'setup' },
    { ok: !!data.config.split_category_id, label: 'Queue channels', to: 'setup' },
    { ok: data.scenarios.length > 0, label: \`Scenario pool (\${data.scenarios.length})\`, to: 'pool' },
    { ok: data.ranks.some((r) => r.discord_role_id),
      label: \`Rank roles (\${data.ranks.filter((r) => r.discord_role_id).length}/\${data.ranks.length})\`,
      to: 'ranks' },
  ];
  const STEPS = checks.length;
  const todo = checks.filter((c) => !c.ok).length;

  /* Said where it can be acted on, and only when it is true. Two different
     faults with two different fixes: a permission is a checkbox, and being
     outranked is a drag in the role list - the invite link cannot fix that one,
     so it is not offered as though it could. */
  const permNotice = () => {
    if (!perms.missing.length && !perms.outranked.length) return '';
    const names = (list) => list.map((n) => \`<b>\${h(n)}</b>\`).join(', ');
    return \`<div class="notice">
      <strong>Quorum cannot finish the job here</strong>
      \${perms.missing.length ? \`<p>It is missing \${names(perms.missing)} in this server.
         Tick them on its role in Server Settings → Roles, or re-invite it - the link asks for
         exactly what it needs and nothing more.</p>\` : ''}
      \${perms.outranked.length ? \`<p>Its own role sits below \${names(perms.outranked)}.
         Discord will not let it touch a role above its own, so those ranks cannot be renamed,
         recoloured or handed out. Drag <b>Quorum</b> above them in Server Settings → Roles.</p>\` : ''}
      \${perms.missing.length && perms.invite
        ? \`<a class="btn" href="\${h(perms.invite)}" target="_blank" rel="noopener">Re-invite Quorum</a>\`
        : ''}
    </div>\`;
  };

  box.innerHTML = \`
    <section id="overview">
    <h2>Overview</h2>
    <div class="stats">
      \${stat(num(guild.members) ?? '-', 'Members', 'users')}
      \${stat(inPlay, 'In play', 'swords', 'matches',
              playSub, 'being played right now - a call nobody has taken is not one')}
      \${stat(num(data.stats.played), 'Played', 'check', null, '', 'matches finished all time')}
      \${stat(num(data.stats.week), 'Last 7 days', 'gauge', null, '', 'matches finished this week')}
      \${stat(num(data.stats.rated), 'Rated', 'trophy', 'players', '', 'players with a record')}
    </div>

    <h2>Ready to run</h2>
    <p class="muted">\${todo
      ? \`\${todo} thing\${todo > 1 ? 's' : ''} left before Quorum can run a match here.\`
      : 'Everything is set. Post the queue panel and you are live.'}</p>
    <div class="progress"><i style="width:\${((STEPS - todo) / STEPS) * 100}%"></i></div>
    <div class="check">\${checks.map((c) => step(c.ok, c.label, c.to)).join('')}</div>

    <h2>Top of the ladder</h2>
    \${data.top.length
      ? '<table class="ladder"><tbody>' + data.top.map((p, n) => {
          const rank = bandOf(p);
          return \`
          <tr>
            <td class="hint" style="width:1px">\${n + 1}</td>
            <td style="width:100%">\${h(p.kovaaks_username)}</td>
            <td style="white-space:nowrap">\${voltaicChip(p.voltaic)}</td>
            <td style="white-space:nowrap">\${rank
              ? \`<span class="rank" style="--c:\${h(rank.color)}"><span class="dot"></span>\${h(rank.name)}</span>\`
              : ''}</td>
            <td class="hint" style="white-space:nowrap">\${p.wins}W \${p.losses}L\${p.draws ? ' ' + p.draws + 'D' : ''}</td>
            <td><strong>\${p.elo}</strong></td>
          </tr>\`;
        }).join('') + '</tbody></table>'
      : '<p class="muted">Nobody has finished a match yet.</p>'}
    </section>

    <section id="setup">
    <h2>Setup</h2>
    \${permNotice()}
    <div class="field">
      <label>Category <span class="hint">- Quorum fills it with a results channel and one queue channel per rank</span></label>
      \${selectField('category', [{ id: '', name: 'Create one for me' }].concat(data.categories),
                     data.config.split_category_id)}
    </div>
    <div class="field">
      <label>Who can see it <span class="hint">- the category and the results in it. A queue channel is private to its rank either way</span></label>
      \${selectField('visible', [{ id: '', name: 'Everyone' }].concat(data.roles),
                     data.config.visible_role_id)}
    </div>
    <div class="field">
      <label>Ping role <span class="hint">- set one and it is the only thing pinged for a new queue, with a Notify me
      button on the panel to opt in and out. Leave it empty to ping the ranks that can join instead</span></label>
      \${selectField('ping', NONE.concat(data.roles), data.config.ping_role_id)}
    </div>
    <div class="field">
      <label>Leaderboard <span class="hint">- one message Quorum keeps up to date as ratings move, with the rest of the ladder a button away</span></label>
      \${selectField('leaderboard', NONE.concat(data.channels), data.config.leaderboard_channel_id)}
    </div>
    <div class="field">
      <label>Announcements <span class="hint">- Quorum posts here whenever staff change the format, the pool or the ladder</span></label>
      \${selectField('announce', NONE.concat(data.channels), data.config.announce_channel_id)}
    </div>
    <div class="field">
      <label>Auto-cancel <span class="hint">- drop calls nobody takes, so the channel only shows live ones</span></label>
      <div class="opt boxed">
        <label class="opt-hit">
          <input type="checkbox" id="autocancel"\${data.config.call_ttl_min === 0 ? '' : ' checked'} />
          <span class="on-note">Cancel a call after</span>
          <span class="off-note">Off - calls stay up until taken or cancelled</span>
        </label>
        <input type="number" id="ttlmin" min="5" max="1440" step="5"
               value="\${data.config.call_ttl_min || 60}" />
        <span class="unit">minutes without a taker</span>
      </div>
    </div>
    <div class="field">
      <label>Pause queues <span class="hint">- nothing new can be opened or taken. Matches already running play out</span></label>
      <div class="opt boxed">
        <label class="opt-hit">
          <input type="checkbox" id="pausequeues"\${data.paused ? ' checked' : ''} />
          <span class="on-note">Paused - the panel says so and its buttons are dead</span>
          <span class="off-note">Open - anyone in a rank can queue</span>
        </label>
        <span class="status" id="pausestatus"></span>
      </div>
    </div>
    <div class="bar">
      <button class="btn solid" id="save">Save</button>
      <button class="btn" id="panelbtn">Post panel</button>
      <span class="status" id="status"></span>
    </div>

    <div class="cat danger" style="margin-top:32px">
      <div class="cat-top"><strong>Remove Quorum</strong></div>
      <p class="muted" style="margin:0 0 12px">Leave here, not by kicking it - a kicked bot cannot delete what it
      made. Ratings and history are global and stay.</p>
      <div class="bar">
        <label class="opt">
          <input type="checkbox" id="purge" checked />
          Also delete its roles, categories and channels
        </label>
        <span class="status" id="leavestatus"></span>
        <button class="btn bad" id="leavebtn">Remove Quorum</button>
      </div>
    </div>
    </section>

    <section id="format">
    <h2>Format</h2>
    <p class="muted">How a match is played. These are the rules the bot enforces - the pick phase, and what
    counts as your score.</p>
    <div id="formatbox"></div>
    <div class="bar">
      <button class="btn solid" id="savefmt">Save format</button>
      <span class="status" id="fmtstatus"></span>
    </div>
    </section>

    <section id="queues">
    <h2>Queues</h2>
    <p class="muted">How far apart two ranks may be for a queue to admit them. A call pings exactly the ranks it can let in.</p>

    <div id="queuebox"></div>

    <div class="cat" style="margin-top:20px">
      <label class="opt-hit"><input type="checkbox" id="unrankedon" />
        <span><strong>Unranked queue</strong></span></label>
      <p class="muted" style="margin:8px 0 0">A queue anyone can enter, in its own
      <b>#unranked</b> channel that is not locked to a division. No rating moves and no
      win or loss is recorded, but every score is read and kept the same way - so it is
      also where you can see what somebody shoots before placing them. Turning it off
      deletes the channel.</p>
    </div>

    <div class="bar">
      <button class="btn solid" id="savequeues">Save queues</button>
      <span class="status" id="queuestatus"></span>
    </div>
    </section>

    <section id="matches">
    <h2>Matches in play</h2>
    <p class="muted">Force finish scores a match from whatever KovaaK's has right now; cancel bins it with no rating change.</p>
    <div id="matchlist"></div>

    <h2>History</h2>
    <p class="muted">Newest first. Click a match for its scores. Cancelled and unplayed ones are not here.</p>
    <table class="hist"><tbody id="histlist"></tbody></table>
    </section>

    <section id="ranks">
    <h2>Ranks</h2>
    <p class="muted">Each rank is a Discord role, named and coloured to match. Saving creates them. Whether Quorum then moves anyone between them is the choice below - and either way the floors are what order the ladder, so no two may share one.</p>
    <div class="cat" id="rankmodebox"></div>
    <div class="cat" id="modebox"></div>
    <table><tbody id="ranklist"></tbody></table>
    <div class="bar">
      <button class="btn" id="addrank">Add rank</button>
      <button class="btn solid" id="saveranks">Save ranks</button>
      <span class="status" id="rankstatus"></span>
    </div>
    </section>

    <section id="pool">
    <h2>Scenario pool</h2>
    <p class="muted">A match rolls one scenario per main - Clicking, Tracking, Switching. Add subcategories to organise a main's pool; they file under it rather than taking a round of their own. Search pulls real names off KovaaK's, so a lookup can't miss on a typo. A category can be offered to just the ranks that should play it - pick them under its name, or leave it open to every rank.</p>
    <div id="poolbox"></div>
    <div class="bar">
      <button class="btn" id="addcat">Add subcategory</button>
      <button class="btn solid" id="savepool">Save pool</button>
      <span class="status" id="poolstatus"></span>
    </div>
    </section>

    <section id="players">
    <h2>Players</h2>
    <p class="muted">The rank is the Discord role - hand one out and Quorum starts them at its floor. Correcting a rating here keeps their record and their matches; only Reset takes those. Who plays whom is set in Queues.</p>
    <input type="text" id="playerq" placeholder="Search players" spellcheck="false" style="margin-bottom:12px" />
    <table class="ladder"><tbody id="playerlist"></tbody></table>
    <div class="bar"><span class="status" id="tierstatus"></span></div>

    <div class="cat danger" style="margin-top:32px">
      <div class="cat-top"><strong>Reset ratings</strong></div>
      <p class="muted" style="margin:0 0 12px">Everyone unplayed again, each back to where their division
      role starts them. Matches stay in History. Anyone who also plays Quorum in another server is left
      alone.</p>
      <div class="bar">
        <span class="status" id="resetstatus" style="margin-left:auto"></span>
        <button class="btn bad" id="resetbtn">Reset ratings</button>
      </div>
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
    name: n === 0 ? 'Same rank only' : n === 1 ? 'One rank either side' : n + ' ranks either side',
  }));
  const example = (n) => {
    if (!ladder.length) return 'Add a rank ladder first.';
    const mid = Math.min(1, ladder.length - 1);
    const chip = (r) =>
      \`<span class="rank" style="--c:\${h(r.color)}"><span class="dot"></span>\${h(r.name)}</span>\`;
    // A rank always queues with itself, so listing it back says nothing - what
    // the number actually buys is who ELSE gets in.
    const others = ladder
      .slice(Math.max(0, mid - n), mid + n + 1)
      .filter((r) => r !== ladder[mid]);
    return others.length
      ? \`\${chip(ladder[mid])} queues with \${others.map(chip).join('')}\`
      : \`\${chip(ladder[mid])} queues with its own rank only\`;
  };
  // The format pane: the shipped format up top, its knobs under it. Every one
  // of these is a number the bot reads per match, so the preview line is built
  // from the same values rather than written out by hand.
  const fmt = { ...data.format };
  const FMT_FIELDS = [
    ['rounds', 'Scenarios per match', 1, 5, 'the last one is always the random roll'],
    ['runs', 'Runs per scenario', 1, 10, 'the best of the first this many counts - a later run does not'],
    ['pickPool', 'Candidates per pick', 2, 5, 'both sides ban one out of these, then the picker takes one'],
    ['pickTtlS', 'Ban or pick timer', 15, 600, 'seconds before the bot acts for a side that walked away'],
    ['matchTtlMin', 'Match time limit', 5, 240, 'minutes before a live match scores on whatever KovaaK has'],
    ['graceMin', 'Grace after the first finisher', 1, 240, 'minutes the rest get once one player has used every run - long enough to play the format out'],
    ['minMatchMin', 'Minimum match length', 0, 240, 'minutes a match always runs for, so a fast finisher cannot cut short someone still loading in'],
  ];
  const drawFormat = () => {
    const bans = Math.max(0, Math.min(2, fmt.pickPool - 1));
    const picks = Math.max(0, fmt.rounds - 1);
    document.getElementById('formatbox').innerHTML = \`
      <div class="cat">
        <div class="cat-top"><strong>\${h(data.formats[0] ?? '1v1')}</strong>
          <span class="hint">\${data.formats.length > 1
            ? h(data.formats.slice(1).join(', ')) + ' as well'
            : 'the only format right now'}</span></div>
        <p class="muted" style="margin:0 0 14px">\${picks
          ? \`\${picks} scenario\${picks === 1 ? '' : 's'} picked, one per main: the side with the
             pick bans first, the other bans back, then it picks from the
             \${Math.max(1, fmt.pickPool - bans)} left. The pick alternates, and scenario
             \${fmt.rounds} is rolled at random.\`
          : 'One scenario, rolled at random.'} Main order is random too.</p>
        <div>
        \${FMT_FIELDS.map(([key, label, lo, hi, hint]) => \`
          <div class="frow">
            <label for="fmt-\${key}"><strong>\${h(label)}</strong>
              <span class="hint"> - \${h(hint)}</span></label>
            <input type="number" id="fmt-\${key}" data-k="\${key}"
                   min="\${lo}" max="\${hi}" step="1" value="\${fmt[key]}" />
          </div>\`).join('')}
        </div>
      </div>\`;
    document.getElementById('formatbox').querySelectorAll('input').forEach((el) => {
      el.oninput = () => {
        const n = Number(el.value);
        if (Number.isFinite(n)) fmt[el.dataset.k] = n;
        drawFormat();
        // redrawing steals focus, so put it back where the typing was
        const back = document.getElementById(el.id);
        back.focus();
        back.setSelectionRange(back.value.length, back.value.length);
      };
    });
  };
  drawFormat();

  document.getElementById('savefmt').onclick = async () => {
    const el = document.getElementById('fmtstatus');
    el.textContent = 'Saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/format\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: fmt }),
    });
    // The server clamps, so what comes back is what a match will actually use.
    if (res.ok) Object.assign(fmt, (await res.json()).format);
    drawFormat();
    el.textContent = res.ok ? 'Saved' : 'Save failed';
  };

  let seedMode = data.seedMode ?? 'flat';
  const drawQueues = () => {
    // One row per format. Three cards for three dropdowns was three times the
    // furniture for the same one decision each.
    document.getElementById('queuebox').innerHTML =
      '<div class="cat rows">' + data.formats.map((f) => \`
      <div class="qrow">
        <strong>\${h(f)}</strong>
        \${selectField('sp-' + f, spreadOpts, String(spread[f] ?? 0), \`data-f="\${h(f)}"\`)}
        <div class="reach">\${example(spread[f] ?? 0)}</div>
      </div>\`).join('') + '</div>';
    const scope = document.getElementById('queuebox');
    wireSelects(scope);
    scope.querySelectorAll('.sel').forEach((el) => (el.onchange = () => {
      spread[el.dataset.f] = Number(el.dataset.value);
      drawQueues();
    }));
  };
  drawQueues();

  const unrankedOn = document.getElementById('unrankedon');
  unrankedOn.checked = !!data.unranked;

  document.getElementById('savequeues').onclick = async () => {
    const el = document.getElementById('queuestatus');
    // Said before the save, not after: turning it off deletes a channel, and a
    // channel is not something to bin on a click somebody did not mean.
    if (data.unranked && !unrankedOn.checked) {
      const ok = await confirmDanger({
        title: 'Turn the unranked queue off?',
        body: 'The <b>#unranked</b> channel is deleted, along with the panel in it and anything said there. Matches already played stay in History.',
        confirm: 'Turn it off',
      });
      if (!ok) { unrankedOn.checked = true; return; }
    }
    el.textContent = 'Saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/queues\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spread, unranked: unrankedOn.checked }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { el.textContent = 'Save failed'; return; }
    data.unranked = out.unranked;
    el.textContent = out.error ?? 'Saved';
  };

  // A match is one line: the order players appear IS the result, so the winner
  // needs no label and the row needs no second line.
  // The scoreboard, only when asked for. A match is one line until you want to
  // know how it was won - then the same row opens onto what was picked, what
  // was banned, and what everyone actually scored.
  const histDetail = (m) => \`
    <tr class="hx"><td colspan="5">
      <table class="hgrid"><tbody>
        <tr class="th"><td></td>\${m.played.map((sc) => \`<td>\${h(sc)}</td>\`).join('')}</tr>
        \${m.players.map((p) => \`<tr>
          <td class="\${p.placing === 1 ? 'won' : 'hint'}">\${h(p.name)}</td>
          \${m.played.map((sc) => \`<td class="\${
            (p.took ?? []).includes(sc) ? 'took' : ''}">\${
            p.scores?.[sc] == null ? '<span class="hint">–</span>' : Math.round(p.scores[sc])
          }</td>\`).join('')}
        </tr>\`).join('')}
      </tbody></table>
      \${m.banned.length
        ? \`<div class="banned"><span class="hint">Banned</span>\${
            m.banned.map((sc) => \`<span class="chip out">\${h(sc)}</span>\`).join('')}</div>\`
        : ''}
    </td></tr>\`;

  const histBox = document.getElementById('histlist');
  histBox.innerHTML = data.history.length
    ? data.history.map((m) => \`
      <tr class="hrow" data-m="\${m.id}" tabindex="0" role="button" aria-expanded="false">
        <td class="hint" style="width:1px;white-space:nowrap">#\${m.id}</td>
        <td style="width:1px;white-space:nowrap"><strong>\${h(m.format)}</strong>\${
          m.ranked === false ? '<span class="hint"> unranked</span>' : ''}</td>
        <td style="width:100%">\${m.players.map((p) => \`<span class="hp\${
          p.placing === 1 ? ' won' : ''}">\${h(p.name)}\${
          m.ranked === false ? '' : \`<em>\${p.delta >= 0 ? '+' : ''}\${p.delta}</em>\`}</span>\`).join('')}</td>
        <td class="hint" style="white-space:nowrap">\${m.played.length} scn</td>
        <td class="hint" style="white-space:nowrap">\${m.ended_at ? ago(m.ended_at) : ''}
          <button type="button" class="icon-btn hdel" data-del="\${m.id}"
                  title="Delete match" aria-label="Delete match #\${m.id}">\${icon('x')}</button>
          \${icon('chevron')}</td>
      </tr>\` + histDetail(m)).join('')
    : '<tr><td class="hint">Nothing has finished yet.</td></tr>';

  histBox.querySelectorAll('.hrow').forEach((row) => {
    const toggle = () => {
      const open = row.getAttribute('aria-expanded') === 'true';
      row.setAttribute('aria-expanded', String(!open));
      row.nextElementSibling.classList.toggle('open', !open);
    };
    row.onclick = toggle;
    row.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle();
    };
  });

  // Deleting a match hands back what it paid out, so the confirmation says who
  // gets what rather than asking "are you sure" about a number nobody can see.
  histBox.querySelectorAll('.hdel').forEach((btn) => {
    // the row itself is the expand control - a click on this button is not one
    btn.onkeydown = (e) => e.stopPropagation();
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const m = data.history.find((x) => String(x.id) === id);
      const gives = (m?.players ?? [])
        .filter((p) => p.delta)
        .map((p) => \`<b>\${h(p.name)}</b> \${p.delta > 0 ? '-' : '+'}\${Math.abs(p.delta)}\`)
        .join(', ');
      const ok = await confirmDanger({
        title: \`Delete match #\${h(id)}?\`,
        body: (gives ? \`Ratings go back: \${gives}. Wins and losses go with them. \` : '') +
          'Matches played since are NOT recalculated, and this cannot be undone.',
        name: '#' + id,
        confirm: 'Delete match',
      });
      if (!ok) return;
      const res = await fetch(\`/api/guild/\${guild.id}/match/\${id}/delete\`, { method: 'POST' });
      // Ratings moved, so the ladder, the players pane and the overview counts
      // are all stale now - reloading is both the smallest fix and the honest one.
      if (res.ok) location.reload();
      else status('Delete failed');
    };
  });

  const status = (msg) => (document.getElementById('status').textContent = msg);

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
            m.status === 'live' ? 'Running'
              : m.status === 'banning' ? 'Banning scenarios'
              : 'Waiting for an opponent'}</span>
          <span class="hint">\${ago(m.started_at ?? m.created_at)}</span>
          \${m.status === 'live' && m.players.length === 2
            ? \`<span class="score">\${m.players.map((p) => p.won).join('–')}</span>\`
            : ''}
        </div>
        <div class="roster">\${m.players.map((p) => \`
          <span class="pl\${p.done ? ' done' : ''}">
            <img src="\${avatarUrl(p)}" alt="" />\${h(p.name)}\${p.done ? icon('check') : ''}
          </span>\`).join('')}</div>
        \${!m.scenarios.length
          ? ''
          : m.status !== 'live'
            ? \`<div class="chips">\${m.scenarios.map((s) => \`<span class="chip">\${h(s)}</span>\`).join('')}</div>\`
            // Running: the scenarios come with what has been put on them, which
            // is what anyone watching a live match actually wants to know.
            : \`<div class="sb-wrap"><table class="sb">
                <tr><th></th>\${m.players.map((p) => \`<th>\${h(p.name)}</th>\`).join('')}</tr>
                \${m.scenarios.map((s, i) => \`<tr>
                  <td class="sb-name">\${h(s)}</td>
                  \${m.players.map((p) => \`<td class="\${m.ahead[i] === p.team ? 'sb-lead' : ''}">\${
                    p.scores[i] == null ? '–' : Math.round(p.scores[i])
                  }\${p.runs[i] > 0 && p.runs[i] < (data.format?.runs ?? 3) && p.scores[i] != null
                      ? \` <span class="hint">\${p.runs[i]}/\${data.format?.runs ?? 3}</span>\`
                      : ''}</td>\`).join('')}
                </tr>\`).join('')}
              </table></div>\`}
        <div class="match-act">
          \${m.status === 'live' ? \`<button class="btn" data-finish="\${m.id}">Force finish</button>\` : ''}
          <button class="btn" data-cancel="\${m.id}">Cancel</button>
        </div>
      </div>\`).join('') + '</div>';

    const act = async (id, verb) => {
      box.innerHTML = '<div class="hint">Working…</div>';
      await fetch(\`/api/guild/\${guild.id}/match/\${id}/\${verb}\`, { method: 'POST' });
      const fresh = await (await fetch('/api/guild/' + guild.id)).json();
      drawMatches(fresh.matches);
    };
    box.querySelectorAll('[data-finish]').forEach((el) => (el.onclick = () => act(el.dataset.finish, 'finish')));
    box.querySelectorAll('[data-cancel]').forEach((el) => (el.onclick = () => act(el.dataset.cancel, 'cancel')));
  };
  drawMatches(data.matches);

  // A running match changes under you - the bot re-reads KovaaK's every minute -
  // so the card has to redraw or it is a screenshot of when the pane opened.
  // Polling, because nothing here pushes; hidden tabs sit it out, and the
  // interval clears itself once the pane is gone rather than being unhooked.
  const mine = document.getElementById('matchlist');
  const livePoll = setInterval(async () => {
    // Identity, not presence: rendering another server puts a NEW matchlist on
    // the page, and a poller left over from the last one would keep writing its
    // matches into it.
    if (document.getElementById('matchlist') !== mine) return clearInterval(livePoll);
    if (document.hidden) return;
    const res = await fetch(\`/api/guild/\${guild.id}/matches\`);
    if (res.ok && document.getElementById('matchlist') === mine) drawMatches((await res.json()).matches);
  }, 30_000);

  // All three options on screen with what each does, rather than a segmented
  // control plus a paragraph that changes under it: the choice is the content,
  // so you should be able to compare them without clicking.
  const SEED_OPTS = [
    ['flat', 'Flat', 'Everyone starts at 1050.'],
    ['staff', 'Staff', 'From the division role they are wearing, at its floor.'],
    ['voltaic', 'Voltaic S5', 'From their S5 standing, or flat without one.'],
  ];
  let rankMode = data.rankMode ?? 'auto';
  const RANK_OPTS = [
    ['auto', 'Quorum', 'Ratings decide the rank, and the role moves with them.'],
    ['manual', 'Staff', 'You hand out the division roles. Quorum never adds or removes one, and a queue is gated on the role rather than on Elo. Matches move the rating inside a division; moving someone to a new one restarts them at its floor.'],
  ];
  const drawRankMode = () => {
    document.getElementById('rankmodebox').innerHTML = \`
      <div class="cat-top">
        <strong>Who moves people</strong>
        <span class="status" id="rankmodestatus" style="margin-left:auto"></span>
      </div>
      <div class="opts" id="rankseg" role="radiogroup" aria-label="Who moves people">\${
        RANK_OPTS.map(([m, name, desc]) => \`
        <button type="button" role="radio" data-m="\${m}" aria-checked="\${m === rankMode}">
          <span class="mark"></span>
          <span class="oname">\${name}</span>
          <span class="odesc">\${desc}</span>
        </button>\`).join('')}</div>\`;

    document.getElementById('rankseg').onclick = async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b || b.dataset.m === rankMode) return;
      const el = document.getElementById('rankmodestatus');
      el.textContent = 'Saving…';
      const res = await fetch(\`/api/guild/\${guild.id}/rankmode\`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: b.dataset.m }),
      });
      if (!res.ok) { el.textContent = 'Failed'; return; }
      rankMode = (await res.json()).mode;
      drawRankMode();
    };
  };
  drawRankMode();

  const drawMode = () => {
    const offered = data.seedModes ?? ['flat'];
    document.getElementById('modebox').innerHTML = \`
      <div class="cat-top">
        <strong>Starting rank</strong>
        <span class="status" id="modestatus" style="margin-left:auto"></span>
      </div>
      <p class="muted" style="margin:0 0 12px">Only ever the first rating - after one match their record decides it, and Quorum moves the rank role to match.</p>
      <div class="opts" id="seedseg" role="radiogroup" aria-label="Starting rank">\${
        SEED_OPTS.filter(([m]) => offered.includes(m)).map(([m, name, desc]) => \`
        <button type="button" role="radio" data-m="\${m}" aria-checked="\${m === seedMode}">
          <span class="mark"></span>
          <span class="oname">\${name}</span>
          <span class="odesc">\${desc}</span>
        </button>\`).join('')}</div>\`;

    document.getElementById('seedseg').onclick = async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b || b.dataset.m === seedMode) return;
      const el = document.getElementById('modestatus');
      el.textContent = 'Saving…';
      const res = await fetch(\`/api/guild/\${guild.id}/seedmode\`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: b.dataset.m }),
      });
      if (!res.ok) { el.textContent = 'Failed'; return; }
      seedMode = (await res.json()).mode;
      drawMode();
      drawPlayers();
    };
  };

  let ranks = data.ranks.slice();
  const drawRanks = () => {
    document.getElementById('ranklist').innerHTML =
      \`<tr class="th"><td></td><td>Rank</td><td>Elo floor</td><td></td></tr>\` +
      ranks.map((r, n) => \`
      <tr>
        <td>\${colorField(r.color, \`data-n="\${n}"\`)}</td>
        <td style="width:100%"><input type="text" value="\${h(r.name)}" data-n="\${n}" data-k="name" /></td>
        <td><input type="number" value="\${Number(r.min_elo)}" data-n="\${n}" data-k="min_elo" /></td>
        <td><button class="icon-btn" data-del="\${n}" title="Remove">×</button></td>
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
  drawMode();
  drawRanks();
  document.getElementById('addrank').onclick = () => {
    ranks.push({ name: 'New rank', min_elo: 0, color: '#888888' });
    drawRanks();
  };
  document.getElementById('saveranks').onclick = async () => {
    const el = document.getElementById('rankstatus');
    el.textContent = 'Saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/ranks\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ranks }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) { ranks = out.ranks; drawRanks(); el.textContent = 'Saved, roles synced'; }
    else el.textContent = out.error ?? 'Save failed';
  };

  // The three mains are fixed and always drawn, empty or not - they are what a
  // match rolls over. Everything else is a subcategory filed under one of them:
  // its own card, its own scenarios, but it feeds its main's round rather than
  // taking a round of its own.
  //
  // Categories live in their own list so a new, still-empty one survives until
  // something is put in it - the saved shape is a flat (category, name, main) list.
  const MAINS = data.mains ?? ['Clicking', 'Tracking', 'Switching'];
  let pool = data.scenarios.map((s) => ({ ...s }));
  let cats = MAINS.map((m) => ({ name: m, main: m, ranks: [] }));
  for (const s of pool) {
    if (!cats.some((c) => c.name === s.category)) {
      cats.push({ name: s.category, main: MAINS.includes(s.main) ? s.main : MAINS[0], ranks: [] });
    }
  }
  // A category is offered to the ranks someone named, and its rows carry them
  // the same way they carry the main. Empty is every rank - the answer a pool
  // has until somebody narrows it.
  for (const c of cats) {
    const mine = pool.filter((s) => s.category === c.name);
    c.ranks = mine.length && Array.isArray(mine[0].rank_ids) ? mine[0].rank_ids.slice() : [];
  }
  let openCat = null;
  const poolBox = document.getElementById('poolbox');

  const drawPool = () => {
    poolBox.innerHTML = cats.map((cat, ci) => {
          const rows = pool.map((s, i) => ({ ...s, i })).filter((r) => r.category === cat.name);
          const isMainCat = MAINS.includes(cat.name);
          return \`
        <div class="cat">
          <div class="cat-top">
            <strong>\${h(cat.name)}</strong>
            \${isMainCat
              ? '<span class="hint">main - one round a match</span>'
              : \`<span class="hint">rolls into</span>\${
                  selectField('catmain-' + ci, MAINS, cat.main, \`data-ci="\${ci}"\`)}\`}
            <span class="hint">\${rows.length} scenario\${rows.length === 1 ? '' : 's'}</span>
            <span class="hint">offered to</span>
            <span class="picks">\${cat.ranks.length
              ? ''
              : '<span class="hint">every rank</span>'}\${data.ranks.map((r) => \`
              <button type="button" class="chip pick\${cat.ranks.includes(r.id) ? ' on' : ''}"
                data-ci="\${ci}" data-rank="\${r.id}">\${h(r.name)}</button>\`).join('')}</span>
            \${isMainCat
              ? ''
              : \`<button class="icon-btn" data-delcat="\${h(cat.name)}" title="Remove category">\${icon('x')}</button>\`}
          </div>
          <div class="chips">
            \${rows.map((r) => \`<span class="chip">\${h(r.name)}
              <button class="icon-btn" data-del="\${r.i}" title="Remove">\${icon('x')}</button></span>\`).join('')}
            <button class="chip add" data-add="\${h(cat.name)}">\${icon('plus')}Scenario</button>
          </div>
          \${openCat === cat.name ? \`<div class="scn">
            <input type="text" class="scn-q" placeholder="Search KovaaK's scenarios" spellcheck="false" />
            <div class="scn-out hint">Type at least 2 characters.</div>
          </div>\` : ''}
        </div>\`;
        }).join('');

    // a main is one of the three and cannot be dropped; only subs carry this
    poolBox.querySelectorAll('[data-delcat]').forEach((el) => (el.onclick = () => {
      cats = cats.filter((c) => c.name !== el.dataset.delcat);
      pool = pool.filter((s) => s.category !== el.dataset.delcat);
      drawPool();
    }));
    wireSelects(poolBox);
    poolBox.querySelectorAll('[data-ci]').forEach((el) => (el.onchange = () => {
      const cat = cats[Number(el.dataset.ci)];
      cat.main = el.dataset.value;
      // the rows carry the main, so re-filing the category re-files its pool
      for (const s of pool) if (s.category === cat.name) s.main = cat.main;
      drawPool();
    }));
    poolBox.querySelectorAll('[data-rank]').forEach((el) => (el.onclick = () => {
      const cat = cats[Number(el.dataset.ci)];
      const id = Number(el.dataset.rank);
      cat.ranks = cat.ranks.includes(id) ? cat.ranks.filter((n) => n !== id) : [...cat.ranks, id];
      // None picked is every rank, so a category can always be opened back up
      // by unpicking the last one.
      for (const s of pool) {
        if (s.category === cat.name) s.rank_ids = cat.ranks.length ? cat.ranks.slice() : null;
      }
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
      out.textContent = 'Searching…';
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
            // the row carries the main, so it is stamped from the category it
            // is being dropped into rather than worked out again at save time
            const into = cats.find((c) => c.name === openCat);
            pool.push({
              category: openCat,
              name,
              main: into?.main ?? MAINS[0],
              rank_ids: into?.ranks?.length ? into.ranks.slice() : null,
            });
          }
          openCat = null;
          drawPool();
        }));
      }, 250);
    };
  };
  drawPool();

  // Only ever a subcategory: the three mains are always on the page already, so
  // there is nothing else this could be making.
  document.getElementById('addcat').onclick = async () => {
    const name = (await ask('Subcategory name'))?.slice(0, 60);
    if (!name || cats.some((c) => c.name === name)) return;
    cats.push({ name, main: MAINS[0], ranks: [] });
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
    el.textContent = res.ok ? \`Saved \${out.scenarios.length} scenarios\` : out.error ?? 'Save failed';
  };

  /* Which row is open for editing, if any - one at a time on purpose. A rating
     is a rare, deliberate correction, and nine live number boxes sitting over
     the standings is how one of them gets changed by leaning on a keyboard. */
  let editing = null;
  const drawPlayers = () => {
  // The whole list is already here, so the search is a filter over it rather
  // than a round trip. Name or Discord id, because half of finding someone in
  // a server this size is knowing which "ness" they are.
  const q = (document.getElementById('playerq')?.value ?? '').trim().toLowerCase();
  const shown = q
    ? data.players.filter(
        (p) =>
          (p.kovaaks_username ?? '').toLowerCase().includes(q) || p.discord_id.includes(q),
      )
    : data.players;
  document.getElementById('playerlist').innerHTML = shown.length
    ? shown.map((p) => {
        const rank = bandOf(p);
        // The reset is always on the row so the control is findable; dimmed
        // when the player has neither a record nor a starting rank, because
        // then it would undo nothing.
        const canReset = p.wins + p.losses + p.draws || p.seeded_from;
        const open = editing === p.discord_id;
        /* Where their ROLE puts them against where their RATING does, and only
           when the two are a real distance apart.

           Any gap at all was far too eager: seeding lands on a band's floor, so
           the very first loss put somebody a dozen points under it and lit this
           up on every row that had played a game. Half a band either way is
           where the number starts saying something a placement should answer
           for - below it they may be overplaced, above it they may be due a
           promotion.

           Nothing acts on it either way. The role IS the rank here: Quorum
           never moves one in either direction, so this is a note for staff and
           not a demotion waiting to happen. */
        const byElo = rankOf(p.elo);
        let adrift = null;
        if (data.rankMode === 'manual' && rank && byElo && byElo.id !== rank.id) {
          const at = data.ranks.indexOf(rank);
          const ceil = at > 0 ? data.ranks[at - 1].min_elo : Infinity;
          // The top band has no ceiling, so it borrows the width of the one
          // under it rather than being impossible to flag at all.
          const width =
            (ceil === Infinity ? rank.min_elo - (data.ranks[at + 1]?.min_elo ?? 0) : ceil - rank.min_elo) || 400;
          const margin = width / 2;
          if (p.elo < rank.min_elo - margin || p.elo >= ceil + margin) adrift = byElo;
        }
        return \`
      <tr>
        <td style="width:1px"><img class="pfp" src="\${avatarUrl({ id: p.discord_id, avatar: p.avatar })}" alt="" /></td>
        <td style="width:100%">
          \${data.config.visible_role_id
            ? h(p.kovaaks_username)
            : \`<a class="pname" href="/p/\${h(guild.id)}/\${h(p.discord_id)}" target="_blank" rel="noopener"
                 title="Their page - open to anyone with the link">\${h(p.kovaaks_username)}</a>\`}
          <span class="hint">\${p.wins}W \${p.losses}L\${p.draws ? ' ' + p.draws + 'D' : ''}</span>
        </td>
        <td style="white-space:nowrap">\${voltaicChip(p.voltaic)}</td>
        <td style="white-space:nowrap">\${rank
          ? \`<span class="rank" style="--c:\${h(rank.color)}"><span class="dot"></span>\${h(rank.name)}</span>\`
          : ''}</td>
        <td style="white-space:nowrap">\${open
          ? \`<span class="rate-edit"><input class="rate-in" type="number" min="0" max="5000" step="1"
               value="\${p.elo}" aria-label="Rating for \${h(p.kovaaks_username)}" />
             <button class="icon-btn rate-ok" title="Save this rating">\${icon('check')}</button>
             <button class="icon-btn rate-no" title="Cancel">\${icon('x')}</button></span>\`
          : \`<span class="rate-cell"><strong>\${p.elo}</strong>
             <button class="icon-btn rate-go" data-edit="\${h(p.discord_id)}" data-to="\${p.elo}"
               title="Correct this rating - their record and their matches stay">\${icon('pencil')}</button></span>\`}</td>
        <td style="white-space:nowrap">\${adrift
          ? \`<button type="button" class="drift" data-edit="\${h(p.discord_id)}" data-to="\${rank.min_elo}"
               title="Their role says \${h(rank.name)}, and \${p.elo} is more than half a division away from it - in \${h(adrift.name)}. Nothing has moved and nothing will: the role is the rank. Change it by hand, or click here to put their rating back at the bottom of \${h(rank.name)}.">rating in \${h(adrift.name)}</button>\`
          : p.wins + p.losses + p.draws
            ? ''
            : \`<span class="hint" title="Their first match will decide it from here">seeded \${h(p.seeded_from ?? 'flat')}</span>\`}</td>
        <td style="width:1px"><button class="icon-btn" data-reset="\${h(p.discord_id)}"
          data-name="\${h(p.kovaaks_username)}"\${canReset ? '' : ' disabled'}
          title="\${canReset ? 'Reset this rating' : 'Nothing to reset - no matches and no starting rank'}">\${icon('undo')}</button></td>
      </tr>\`;
      }).join('')
    : \`<tr><td class="hint">\${q ? 'Nobody by that name.' : 'Nobody has played yet.'}</td></tr>\`;
  const scope = document.getElementById('playerlist');
  // Both the pencil and the drift hint open the same editor - they differ only
  // in what they fill it with: where the player is now, or the floor of the
  // bracket their role says they are in.
  scope.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => {
    editing = el.dataset.edit;
    const to = el.dataset.to;
    drawPlayers();
    const input = scope.querySelector('.rate-in');
    if (!input) return;
    input.value = to;
    input.focus();
    input.select();
  }));
  const stopEditing = () => { editing = null; drawPlayers(); };
  scope.querySelectorAll('.rate-no').forEach((el) => (el.onclick = stopEditing));

  // One save per edit, the moment it is confirmed. A bar at the bottom holding
  // nine pending rating changes is a bar somebody navigates away from.
  const saveRating = async () => {
    const input = scope.querySelector('.rate-in');
    const id = editing;
    if (!input || !id) return;
    const el = document.getElementById('tierstatus');
    el.textContent = 'Saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/rating\`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discord_id: id, elo: Number(input.value) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { el.textContent = out.error ?? 'Save failed'; return; }
    // Patched in place off what came back, so the row shows the rating the
    // server actually stored rather than the one that was typed at it - and so
    // the rest of the row, none of which this route knows about, survives.
    const row = data.players.find((x) => x.discord_id === out.discord_id);
    if (row) row.elo = out.elo;
    editing = null;
    drawPlayers();
    el.textContent = 'Saved';
  };
  scope.querySelectorAll('.rate-ok').forEach((el) => (el.onclick = saveRating));
  scope.querySelectorAll('.rate-in').forEach((el) => (el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRating(); }
    if (e.key === 'Escape') { e.preventDefault(); stopEditing(); }
  }));
  // One player, same act as the whole-server reset below and the same warning:
  // their record goes, the matches stay, and it cannot be undone.
  scope.querySelectorAll('[data-reset]').forEach((el) => (el.onclick = async () => {
    const ok = await confirmDanger({
      title: \`Reset \${el.dataset.name}'s rating?\`,
      body: 'They go back to where their division role starts them, with no wins or losses. Matches they have played stay in History.',
      name: el.dataset.name,
      confirm: 'Reset rating',
    });
    if (!ok) return;
    const status = document.getElementById('tierstatus');
    status.textContent = 'Resetting…';
    const res = await fetch(\`/api/guild/\${guild.id}/reset\`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player: el.dataset.reset }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = out.error ?? 'Failed'; return; }
    // Nothing reset and somebody skipped means that player's ladder is not only
    // ours - worth saying, rather than looking like a button that did nothing.
    if (!out.reset) {
      status.textContent = out.shared
        ? 'Left alone - they play Quorum in another server too'
        : 'Nothing to reset';
      return;
    }
    location.reload();
  }));
  };
  drawPlayers();
  // The box lives outside the tbody the redraw replaces, so it keeps its focus
  // and its caret while you type.
  document.getElementById('playerq').oninput = drawPlayers;

  // Same dialog as removing the bot: no undo, so it spells out what goes and
  // asks for the server's name before it will do it.
  document.getElementById('resetbtn').onclick = async () => {
    const el = document.getElementById('resetstatus');
    const ok = await confirmDanger({
      title: \`Reset every rating in \${guild.name}?\`,
      body: 'Every player who plays here and nowhere else goes back to where their division role starts them, with no wins or losses. Matches already played stay in History.',
      name: guild.name,
      confirm: 'Reset ratings',
    });
    if (!ok) return;
    el.textContent = 'Resetting…';
    const res = await fetch(\`/api/guild/\${guild.id}/reset\`, { method: 'POST' });
    if (!res.ok) {
      el.textContent = (await res.json().catch(() => ({}))).error ?? 'Failed';
      return;
    }
    location.reload();
  };

  document.getElementById('save').onclick = async () => {
    const body = {
      // off is 0, not null - null would hand the server back the default
      call_ttl_min: document.getElementById('autocancel').checked
        ? Number(document.getElementById('ttlmin').value)
        : 0,
      category_id: document.getElementById('category').dataset.value || null,
      visible_role_id: document.getElementById('visible').dataset.value || null,
      ping_role_id: document.getElementById('ping').dataset.value || null,
      announce_channel_id: document.getElementById('announce').dataset.value || null,
      leaderboard_channel_id: document.getElementById('leaderboard').dataset.value || null,
    };
    const res = await fetch('/api/guild/' + guild.id, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    status(res.ok ? 'Saved' : 'Save failed');
  };

  document.getElementById('leavebtn').onclick = async () => {
    const el = document.getElementById('leavestatus');
    const purge = document.getElementById('purge').checked;
    // This deletes roles and channels in a live Discord server and there is no
    // undo, so the dialog spells out what goes and asks for the name.
    const ok = await confirmDanger({
      title: \`Remove Quorum from \${guild.name}?\`,
      body: purge
        ? "Its rank roles, categories and channels are deleted with it, along with this server's settings. This cannot be undone."
        : 'It leaves the server. The roles and channels it made stay behind, and it will not be able to delete them later.',
      name: guild.name,
      confirm: 'Remove Quorum',
    });
    if (!ok) return;
    el.textContent = 'Removing…';
    const res = await fetch(\`/api/guild/\${guild.id}/leave\`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purge }),
    });
    if (!res.ok) {
      el.textContent = (await res.json().catch(() => ({}))).error ?? 'Failed';
      return;
    }
    location.href = '/';
  };

  // Saves on the flick rather than waiting for the Save button: pausing is
  // something staff reach for while something is going wrong, and a pause that
  // needed a second click would be a pause that did not happen.
  document.getElementById('pausequeues').onchange = async (e) => {
    const on = e.target.checked;
    const el = document.getElementById('pausestatus');
    el.textContent = 'Saving…';
    const res = await fetch(\`/api/guild/\${guild.id}/pause\`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: on }),
    });
    if (!res.ok) {
      e.target.checked = !on;
      el.textContent = 'Failed';
      return;
    }
    data.paused = on;
    el.textContent = on ? 'Queues paused' : 'Queues open';
  };

  document.getElementById('panelbtn').onclick = async () => {
    status('posting…');
    const res = await fetch(\`/api/guild/\${guild.id}/panel\`, { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return status(out.error ?? 'Failed');
    // split servers get one per rank per format, and "panel posted" would read
    // like it went to one channel. A refused channel is named, not swallowed -
    // it means the bot can't post there, and a silent one is a dead queue.
    status(
      out.missed
        ? \`posted in \${out.posted}, refused by \${out.missed} - check the bot can send there\`
        : out.posted > 1
          ? \`panels posted in \${out.posted} channels\`
          : 'Panel posted',
    );
  };
}

boot();
</script>
</body>
</html>`;

/** One player's page, for anyone with the link. */
export interface Profile {
  guildId: string;
  guildName: string;
  discordId: string;
  name: string;
  /** Discord's avatar hash, or null for whoever the gateway hasn't cached. */
  avatar: string | null;
  elo: number;
  rank: { name: string; color: string } | null;
  wins: number;
  losses: number;
  draws: number;
  seededFrom: string | null;
  cats: { main: string; won: number; lost: number }[];
  /** Oldest first - the curve reads left to right. */
  history: {
    format: string;
    won: boolean;
    delta: number;
    elo: number;
    at: number | null;
    /** Everyone who was on the other side, linked to their own page. */
    against: { id: string; name: string }[];
  }[];
  /** This page's own address. Everything on the page can be relative; a link
   *  preview cannot - Discord will not follow a relative og:url. */
  url: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The rating curve. Stretched to the box with preserveAspectRatio and kept at
 *  one pixel by non-scaling-stroke, which is the whole reason this needs no
 *  measuring and no chart library. */
function spark(values: number[]) {
  if (values.length < 2) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A rating that never moved is a line down the MIDDLE. Dividing by a zero
  // span would pin it to the floor of the box, which reads as a collapse.
  const at = (n: number) => (hi === lo ? 0.5 : (n - lo) / (hi - lo));
  const pts = values
    .map((n, i) => `${(i / (values.length - 1)) * 100},${28 - at(n) * 26}`)
    .join(' ');
  return (
    '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">' +
    `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>'
  );
}

/**
 * A player's record as a page anyone can open - no sign-in, because the point
 * of it is being pasted somewhere. It carries what the results channel already
 * says out loud: rating, record, rounds by category, last games. Nothing that
 * is only on the dashboard, and nothing Discord doesn't already show.
 *
 * ponytail: server-rendered in one string. The dashboard is an app and needs to
 * be; this is a page that never changes while you look at it.
 */
export function profilePage(p: Profile): string {
  const games = p.wins + p.losses + p.draws;
  // The hash comes off Discord rather than out of the database, so it is
  // escaped like anything else that arrived from somewhere else - a quote in it
  // would otherwise be a quote out of the attribute.
  const avatar = p.avatar
    ? esc(`https://cdn.discordapp.com/avatars/${p.discordId}/${p.avatar}.png?size=80`)
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(p.discordId) >> 22n) % 6n}.png`;
  const recent = [...p.history].reverse().slice(0, 10);
  // What the card in Discord says. The page gets pasted into chat far more than
  // it gets opened from a browser bar, so this line is most of what people
  // actually read: rating and bracket up top, the record and the categories
  // under it.
  const headline = `${p.elo}${p.rank ? ` · ${p.rank.name}` : ''}`;
  const summary =
    `${p.wins}W ${p.losses}L${p.draws ? ` ${p.draws}D` : ''}` +
    (games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ' · no games yet') +
    (p.cats.length ? `\n${p.cats.map((c) => `${c.main} ${c.won}–${c.lost}`).join(' · ')}` : '');

  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(p.name)} · Quorum</title>
<meta name="description" content="${esc(headline)} - ${esc(summary.replace(/\n/g, ' - '))}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="Quorum · ${esc(p.guildName)}" />
<meta property="og:title" content="${esc(p.name)} · ${esc(headline)}" />
<meta property="og:description" content="${esc(summary)}" />
<meta property="og:image" content="${avatar.replace('size=80', 'size=160')}" />
<meta property="og:url" content="${esc(p.url)}" />
<!-- Discord reads og: for the card and this for the small square avatar beside
     it; without it the image above is blown up the width of the embed. -->
<meta name="twitter:card" content="summary" />
${p.rank ? `<meta name="theme-color" content="${esc(p.rank.color)}" />` : ''}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --fg: #ededed; --muted: #8a8a8a; --line: #262626; --panel: #111;
    --bad: #f0666b;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #fafafa; --fg: #111; --muted: #6b6b6b; --line: #e2e2e2; --panel: #fff; --bad: #c0392b; }
  }
  body {
    background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased; display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 560px; padding: 64px 24px; }
  header { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600;
    letter-spacing: -0.025em; margin-bottom: 40px; }
  header .mark { width: 17px; height: 17px; }
  header span { color: var(--muted); font-weight: 400; }
  .who { display: flex; align-items: center; gap: 14px; }
  .who img { width: 52px; height: 52px; border-radius: 999px; }
  .elo { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1;
    display: flex; align-items: baseline; gap: 9px; }
  .rank { font-size: 12px; font-weight: 500; padding: 3px 9px; border-radius: 999px;
    border: 1px solid currentColor; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .spark { width: 100%; height: 64px; margin: 28px 0 4px; color: var(--muted); display: block; }
  h2 { font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase;
    letter-spacing: .06em; margin: 36px 0 12px; }
  .cat { display: grid; grid-template-columns: 90px 1fr 52px; align-items: center; gap: 12px;
    font-size: 13px; padding: 6px 0; }
  .cat .bar { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
  .cat .bar i { display: block; height: 100%; background: var(--fg); }
  .cat .n { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cat .n b { color: var(--fg); font-weight: 500; }
  .game { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted);
    padding: 7px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  .game .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--bad); flex: none; }
  .game.win .dot { background: var(--fg); }
  /* The one thing on the row that can be any length, so it is the one thing
     that gives - the date and the delta down the right stay in their column. */
  .game .vs { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .game .vs a { color: var(--fg); text-decoration: none; }
  .game .vs a:hover { text-decoration: underline; }
  .game time { margin-left: auto; padding-left: 12px; white-space: nowrap; }
  .game .d { margin-left: auto; color: var(--fg); }
  /* ...but only one of them can push, or a row with a date gets two gaps. */
  .game time ~ .d { margin-left: 12px; }
  .game .d.down { color: var(--bad); }
  .empty { color: var(--muted); font-size: 13px; }
  footer { margin-top: 44px; color: var(--muted); font-size: 12px; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <header>
    <svg class="mark" viewBox="0 0 128 128" fill="currentColor" aria-hidden="true">${MARK}</svg>
    Quorum <span>· ${esc(p.guildName)}</span>
  </header>

  <div class="who">
    <img src="${avatar}" alt="" />
    <div>
      <div class="elo">${p.elo}${
        p.rank
          ? `<span class="rank" style="color:${esc(p.rank.color)}">${esc(p.rank.name)}</span>`
          : ''
      }</div>
      <div class="sub">${esc(p.name)} · ${p.wins}W ${p.losses}L${p.draws ? ` ${p.draws}D` : ''}${
        games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ` · seeded ${esc(p.seededFrom ?? 'flat')}`
      }</div>
    </div>
  </div>

  ${spark(p.history.map((h) => h.elo))}

  <h2>Rounds by category</h2>
  ${
    p.cats.length
      ? p.cats
          .map(
            (c) => `<div class="cat"><span>${esc(c.main)}</span>
      <span class="bar"><i style="width:${Math.round((c.won / (c.won + c.lost)) * 100)}%"></i></span>
      <span class="n"><b>${c.won}</b>–${c.lost}</span></div>`,
          )
          .join('\n  ')
      : `<p class="empty">${
          // Played, but nothing that files anywhere: every scenario they ran
          // has since left the pool, so there is no main to count it under.
          games ? 'Nothing under the current pool.' : 'Nothing played yet.'
        }</p>`
  }

  <h2>${recent.length ? `Last ${recent.length} ${recent.length === 1 ? 'game' : 'games'}` : 'Games'}</h2>
  ${
    recent.length
      ? recent
          .map(
            (m) => `<div class="game${m.won ? ' win' : ''}"><span class="dot"></span>
      <span>${esc(m.format)}</span>
      ${
        m.against.length
          ? `<span class="vs">vs ${m.against
              .map(
                (o) =>
                  `<a href="/p/${esc(p.guildId)}/${esc(o.id)}">${esc(o.name)}</a>`,
              )
              .join(' &amp; ')}</span>`
          : ''
      }
      ${
        // The date is rendered here and only re-stated in the viewer's own
        // locale below, so a page with no JavaScript still has one.
        m.at
          ? `<time datetime="${new Date(m.at).toISOString()}">${new Date(m.at)
              .toISOString()
              .slice(0, 10)}</time>`
          : ''
      }
      <span class="d${m.delta < 0 ? ' down' : ''}">${m.delta >= 0 ? '+' : ''}${m.delta}</span></div>`,
          )
          .join('\n  ')
      : '<p class="empty">No games in this server yet.</p>'
  }

  <footer>Scores read off KovaaK's. <a href="/">Quorum</a></footer>
</main>
<script>
  // Rendered on the server, so the only thing left is whose clock it is.
  for (const t of document.querySelectorAll('time')) {
    t.textContent = new Date(t.dateTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
</script>
</body>
</html>`;
}
