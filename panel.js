// Quick API — side panel logic. No inline handlers (MV3 CSP safe).
const $ = (id) => document.getElementById(id);
const KEY = 'quickapi_v1';
let S = { draft: blank(), saved: [], history: [] };
let lastResp = null;
let respTab = 'pretty';

function blank() {
  return { method: 'GET', url: '', headers: [{ k: 'Accept', v: 'application/json', on: true }], body: '', token: '' };
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function load() {
  try { const r = await chrome.storage.local.get(KEY); if (r[KEY]) S = Object.assign(S, r[KEY]); } catch {}
  renderAll();
}
let st; function persist() { clearTimeout(st); st = setTimeout(() => chrome.storage.local.set({ [KEY]: S }).catch(() => {}), 250); }

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1400); }

// ---------- rendering ----------
function renderAll() { fillForm(); renderHeaders(); renderSaved(); renderHistory(); }

function fillForm() {
  $('method').value = S.draft.method; $('url').value = S.draft.url;
  $('body').value = S.draft.body; $('token').value = S.draft.token;
}
function renderHeaders() {
  const box = $('headerRows'); box.innerHTML = '';
  S.draft.headers.forEach((h, i) => {
    const row = document.createElement('div'); row.className = 'kv';
    row.innerHTML = `<input type="checkbox" ${h.on ? 'checked' : ''} data-i="${i}" data-f="on">
      <input type="text" placeholder="Name" value="${esc(h.k).replace(/"/g, '&quot;')}" data-i="${i}" data-f="k">
      <input type="text" placeholder="Value" value="${esc(h.v).replace(/"/g, '&quot;')}" data-i="${i}" data-f="v">
      <button class="x" data-del="${i}" title="Remove">×</button>`;
    box.appendChild(row);
  });
  const n = S.draft.headers.filter((h) => h.on && h.k).length;
  $('hCount').textContent = n || '';
}
function listItem(r, extra) {
  const d = document.createElement('div'); d.className = 'item';
  d.innerHTML = `<span class="m m-${r.method}">${r.method}</span>
    <div class="u"><div>${esc(r.name || r.url)}</div><div class="sub">${esc(extra || r.url)}</div></div>
    <button class="x" title="Delete">×</button>`;
  return d;
}
function renderSaved() {
  const q = $('savedSearch').value.toLowerCase(); const box = $('savedList'); box.innerHTML = '';
  const items = S.saved.filter((r) => (r.name + r.url).toLowerCase().includes(q));
  if (!items.length) { box.innerHTML = '<div class="empty">No saved requests yet.<br>Press ★ Save on the Request tab.</div>'; return; }
  items.forEach((r) => {
    const d = listItem(r);
    d.onclick = () => { S.draft = JSON.parse(JSON.stringify(r.req)); persist(); renderAll(); showView('request'); };
    d.querySelector('.x').onclick = (e) => { e.stopPropagation(); S.saved = S.saved.filter((x) => x.id !== r.id); persist(); renderSaved(); };
    box.appendChild(d);
  });
}
function ago(ts) { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; }
function renderHistory() {
  const q = $('histSearch').value.toLowerCase(); const box = $('histList'); box.innerHTML = '';
  const items = S.history.filter((r) => r.url.toLowerCase().includes(q));
  if (!items.length) { box.innerHTML = '<div class="empty">Nothing here yet.</div>'; return; }
  items.forEach((r) => {
    const d = listItem(r, `${r.status || 'ERR'} · ${ago(r.ts)} · ${r.url}`);
    d.querySelector('.u > div').textContent = r.url;
    d.onclick = () => { S.draft = JSON.parse(JSON.stringify(r.req)); persist(); renderAll(); showView('request'); };
    d.querySelector('.x').onclick = (e) => { e.stopPropagation(); S.history = S.history.filter((x) => x.id !== r.id); persist(); renderHistory(); };
    box.appendChild(d);
  });
}

function showView(v) {
  document.querySelectorAll('.view').forEach((e) => e.classList.add('hidden'));
  $('view-' + v).classList.remove('hidden');
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
}
function showPane(p) {
  document.querySelectorAll('.pane').forEach((e) => e.classList.add('hidden'));
  $('pane-' + p).classList.remove('hidden');
  document.querySelectorAll('#reqTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.pane === p));
}

// ---------- request ----------
function buildRequest() {
  const d = S.draft; const headers = {};
  d.headers.filter((h) => h.on && h.k.trim()).forEach((h) => { headers[h.k.trim()] = h.v; });
  if (d.token.trim()) headers['Authorization'] = 'Bearer ' + d.token.trim();
  const hasBody = !['GET', 'HEAD'].includes(d.method) && d.body.trim();
  if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = looksJson(d.body) ? 'application/json' : 'text/plain';
  }
  let url = d.url.trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  return { url, init: { method: d.method, headers, body: hasBody ? d.body : undefined } };
}
const looksJson = (s) => { try { JSON.parse(s); return true; } catch { return false; } };

async function send() {
  if (!S.draft.url.trim()) { toast('Enter a URL first'); return; }
  if (/^curl\s/i.test(S.draft.url.trim())) { importCurl(S.draft.url); }
  const { url, init } = buildRequest();
  const btn = $('send'); btn.classList.add('loading'); btn.textContent = 'Sending…';
  const t0 = performance.now();
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, Object.assign({ signal: ctl.signal }, init));
    const text = await res.text(); const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    lastResp = { status: res.status, statusText: res.statusText, headers, body: text, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    lastResp = { status: 0, statusText: 'Error', headers: {}, ms: Math.round(performance.now() - t0),
      body: e.name === 'AbortError' ? 'Request timed out after 30 seconds.' : 'Could not reach the server.\n' + e.message };
  }
  clearTimeout(to); btn.classList.remove('loading'); btn.textContent = 'Send';
  S.history.unshift({ id: uid(), method: S.draft.method, url, status: lastResp.status, ts: Date.now(), req: JSON.parse(JSON.stringify(S.draft)) });
  S.history = S.history.slice(0, 100); persist(); renderHistory(); renderResp();
}

function highlight(json) {
  return esc(json).replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (m) => {
    let c = 'jn'; if (/^"/.test(m)) c = /:$/.test(m) ? 'jk' : 'js'; else if (/true|false|null/.test(m)) c = 'jb';
    return `<span class="${c}">${m}</span>`;
  });
}
function renderResp() {
  const r = lastResp; const out = $('resp');
  if (!r) { out.innerHTML = '<span class="muted">Hit Send to see the response here.</span>'; $('meta').innerHTML = ''; return; }
  const size = new Blob([r.body]).size;
  $('meta').innerHTML = `<span class="badge b${String(r.status)[0]}">${r.status || 'ERR'} ${esc(r.statusText)}</span><span>${r.ms} ms</span><span>${size > 1024 ? (size / 1024).toFixed(1) + ' KB' : size + ' B'}</span>`;
  if (respTab === 'rheaders') {
    out.innerHTML = Object.keys(r.headers).map((k) => `<span class="jk">${esc(k)}</span>: ${esc(r.headers[k])}`).join('\n') || '<span class="muted">No headers</span>';
  } else if (respTab === 'raw') { out.textContent = r.body; }
  else {
    try { out.innerHTML = highlight(JSON.stringify(JSON.parse(r.body), null, 2)); }
    catch { out.textContent = r.body || '(empty response)'; }
  }
}

// ---------- cURL ----------
function tokenize(s) {
  const out = []; const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g; let m;
  s = s.replace(/\\\r?\n/g, ' ');
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}
function importCurl(text) {
  const t = tokenize(text.trim()); const d = blank(); d.headers = []; let hasBody = false;
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (a === '-X' || a === '--request') d.method = (t[++i] || 'GET').toUpperCase();
    else if (a === '-H' || a === '--header') { const h = t[++i] || ''; const p = h.indexOf(':'); if (p > 0) d.headers.push({ k: h.slice(0, p).trim(), v: h.slice(p + 1).trim(), on: true }); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(a)) { d.body = t[++i] || ''; hasBody = true; }
    else if (a === '-u' || a === '--user') { d.headers.push({ k: 'Authorization', v: 'Basic ' + btoa(t[++i] || ''), on: true }); }
    else if (!a.startsWith('-') && !d.url) d.url = a;
  }
  if (hasBody && d.method === 'GET') d.method = 'POST';
  const bi = d.headers.findIndex((h) => h.k.toLowerCase() === 'authorization' && /^bearer /i.test(h.v));
  if (bi >= 0) { d.token = d.headers[bi].v.slice(7); d.headers.splice(bi, 1); }
  S.draft = d; persist(); renderAll(); toast('cURL imported');
}
function toCurl() {
  const { url, init } = buildRequest(); const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  let c = `curl -X ${init.method} ${q(url)}`;
  Object.entries(init.headers).forEach(([k, v]) => { c += ` \\\n  -H ${q(k + ': ' + v)}`; });
  if (init.body) c += ` \\\n  -d ${q(init.body)}`;
  return c;
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.view) showView(t.dataset.view);
  if (t.dataset.pane) showPane(t.dataset.pane);
  if (t.dataset.rtab) { respTab = t.dataset.rtab; document.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b === t)); renderResp(); }
  if (t.dataset.del !== undefined) { S.draft.headers.splice(+t.dataset.del, 1); persist(); renderHeaders(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.f) { S.draft.headers[+t.dataset.i][t.dataset.f] = t.dataset.f === 'on' ? t.checked : t.value; persist(); $('hCount').textContent = S.draft.headers.filter((h) => h.on && h.k).length || ''; }
});
$('method').onchange = (e) => { S.draft.method = e.target.value; persist(); };
$('url').oninput = (e) => { S.draft.url = e.target.value; persist(); };
$('url').onpaste = (e) => {
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  if (/^\s*curl\s/i.test(txt)) { e.preventDefault(); importCurl(txt); }
};
$('url').onkeydown = (e) => { if (e.key === 'Enter') send(); };
$('body').oninput = (e) => { S.draft.body = e.target.value; persist(); };
$('token').oninput = (e) => { S.draft.token = e.target.value; persist(); };
$('send').onclick = send;
$('addHeader').onclick = () => { S.draft.headers.push({ k: '', v: '', on: true }); persist(); renderHeaders(); };
$('beautify').onclick = () => { try { S.draft.body = JSON.stringify(JSON.parse(S.draft.body), null, 2); $('body').value = S.draft.body; persist(); } catch { toast('Body is not valid JSON'); } };
$('clear').onclick = () => { S.draft = blank(); lastResp = null; persist(); renderAll(); renderResp(); };
$('copyCurl').onclick = () => { if (!S.draft.url.trim()) return toast('Enter a URL first'); navigator.clipboard.writeText(toCurl()).then(() => toast('cURL copied')); };
$('copyResp').onclick = () => { if (!lastResp) return; navigator.clipboard.writeText(respTab === 'rheaders' ? JSON.stringify(lastResp.headers, null, 2) : lastResp.body).then(() => toast('Copied')); };
$('save').onclick = () => {
  if (!S.draft.url.trim()) return toast('Enter a URL first');
  let name; try { name = new URL(buildRequest().url).pathname; } catch { name = S.draft.url; }
  const label = prompt('Name this request:', S.draft.method + ' ' + name);
  if (label === null) return;
  S.saved.unshift({ id: uid(), name: label || S.draft.url, method: S.draft.method, url: S.draft.url, req: JSON.parse(JSON.stringify(S.draft)) });
  persist(); renderSaved(); toast('Saved ★');
};
$('savedSearch').oninput = renderSaved;
$('histSearch').oninput = renderHistory;
$('clearHist').onclick = () => { S.history = []; persist(); renderHistory(); };
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); });

load();
