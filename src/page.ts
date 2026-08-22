export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>scrim bot</title>
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
  main { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 48px; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  h2 { font-size: 13px; font-weight: 500; color: var(--muted); margin-bottom: 12px; letter-spacing: 0.02em; text-transform: lowercase; }
  .who { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .who img { width: 22px; height: 22px; border-radius: 999px; filter: grayscale(1); }
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
  .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 2px 7px; border-radius: 999px; }
  .field { margin-bottom: 22px; }
  label { display: block; font-size: 13px; margin-bottom: 6px; }
  label .hint { color: var(--muted); }
  select, input[type=text] {
    width: 100%; background: var(--panel); color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 9px 11px; font: inherit; font-size: 14px; appearance: none;
  }
  select:focus, input:focus { outline: none; border-color: var(--fg); }
  .row { display: flex; gap: 8px; }
  .row > :first-child { flex: 1; }
  .bar { display: flex; align-items: center; gap: 12px; margin-top: 32px; }
  .status { font-size: 13px; color: var(--muted); }
  .empty { color: var(--muted); font-size: 14px; padding: 32px 0; }
  hr { border: none; border-top: 1px solid var(--line); margin: 36px 0; }
  .login { padding: 120px 0; text-align: center; }
  .login p { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
</style>
</head>
<body>
<main id="app"><div class="empty">loading…</div></main>
<script>
const app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let me = null, current = null;

async function boot() {
  const res = await fetch('/api/me');
  me = res.ok ? await res.json() : null;
  if (!me) return renderLogin();
  renderHome();
}

function renderLogin() {
  app.innerHTML = \`<div class="login">
    <h1>scrim bot</h1>
    <p>Sign in to set up your server.</p>
    <a class="btn solid" href="/login">Continue with Discord</a>
  </div>\`;
}

function renderHome() {
  const avatar = me.user.avatar
    ? \`<img src="https://cdn.discordapp.com/avatars/\${me.user.id}/\${me.user.avatar}.png?size=64" alt="" />\`
    : '';
  app.innerHTML = \`
    <header>
      <h1>scrim bot</h1>
      <div class="who">\${avatar}<span>\${h(me.user.username)}</span>
        <a class="btn" href="/logout">Sign out</a></div>
    </header>
    <h2>your servers</h2>
    <div class="servers" id="servers"></div>
    <div id="config"></div>\`;

  const list = document.getElementById('servers');
  if (!me.guilds.length) {
    list.outerHTML = '<div class="empty">No servers where you can manage settings.</div>';
    return;
  }
  list.innerHTML = me.guilds.map((g) => \`
    <button class="server" data-id="\${g.id}">
      \${g.icon
        ? \`<img class="icon" src="https://cdn.discordapp.com/icons/\${g.id}/\${g.icon}.png?size=64" alt="" />\`
        : \`<span class="icon">\${h(g.name.slice(0, 1))}</span>\`}
      <span class="name">\${h(g.name)}</span>
      \${g.installed ? '' : '<span class="tag">bot not added</span>'}
    </button>\`).join('');

  list.querySelectorAll('.server').forEach((el) => {
    el.onclick = () => {
      const g = me.guilds.find((x) => x.id === el.dataset.id);
      list.querySelectorAll('.server').forEach((n) => n.setAttribute('aria-current', String(n === el)));
      g.installed ? openConfig(g) : (location.href = g.invite);
    };
  });
}

async function openConfig(guild) {
  current = guild;
  const box = document.getElementById('config');
  box.innerHTML = '<hr /><div class="empty">loading…</div>';
  const data = await (await fetch('/api/guild/' + guild.id)).json();

  const opts = (items, selected) =>
    '<option value="">— none —</option>' +
    items.map((c) => \`<option value="\${c.id}"\${c.id === selected ? ' selected' : ''}>\${h(c.name)}</option>\`).join('');

  box.innerHTML = \`<hr />
    <h2>\${h(guild.name)}</h2>
    <div class="field">
      <label>Queue channel <span class="hint">— where the panel and open calls live</span></label>
      <select id="panel">\${opts(data.channels, data.config.panel_channel_id)}</select>
    </div>
    <div class="field">
      <label>Results channel <span class="hint">— where finished matches get posted</span></label>
      <select id="results">\${opts(data.channels, data.config.results_channel_id)}</select>
    </div>
    <div class="field">
      <label>Voice category <span class="hint">— match voice channels are made here</span></label>
      <div class="row">
        <select id="voice">\${opts(data.categories, data.config.voice_category_id)}</select>
        <button class="btn" id="mkcat">New category</button>
      </div>
    </div>
    <div class="bar">
      <button class="btn solid" id="save">Save</button>
      <button class="btn" id="panelbtn">Post panel</button>
      <span class="status" id="status"></span>
    </div>\`;

  const status = (msg) => (document.getElementById('status').textContent = msg);

  document.getElementById('mkcat').onclick = async () => {
    const name = prompt('Category name', 'scrims');
    if (!name) return;
    const res = await fetch(\`/api/guild/\${guild.id}/category\`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return status('could not create it');
    const cat = await res.json();
    const sel = document.getElementById('voice');
    sel.insertAdjacentHTML('beforeend', \`<option value="\${cat.id}" selected>\${h(cat.name)}</option>\`);
    status('category created');
  };

  document.getElementById('save').onclick = async () => {
    const body = {
      panel_channel_id: document.getElementById('panel').value || null,
      results_channel_id: document.getElementById('results').value || null,
      voice_category_id: document.getElementById('voice').value || null,
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
