/* ObsidianWork · 壳：路由 / SSE / 监听状态 / toast / 确认弹窗 */
import { $, esc, fmtTime, store } from './util.js';
import { overview } from './views/overview.js';
import { captures } from './views/captures.js';
import { clients } from './views/clients.js';
import { client } from './views/client.js';
import { decisions } from './views/decisions.js';
import { knowledge } from './views/knowledge.js';
import { note } from './views/note.js';
import { search } from './views/search.js';
import { assets } from './views/assets.js';
import { system } from './views/system.js';

/* ---------------- 导航 ---------------- */
const NAV = [
  { key: 'overview', hash: '#/', label: '总览', icon: '◉' },
  { key: 'captures', hash: '#/captures', label: '便签', icon: '✎' },
  { key: 'clients', hash: '#/clients', label: '客户', icon: '☰' },
  { key: 'decisions', hash: '#/decisions', label: '决策', icon: '⚖' },
  { key: 'knowledge', hash: '#/knowledge', label: '知识', icon: '❖' },
  { key: 'search', hash: '#/search', label: '搜索', icon: '⌕' },
  { key: 'assets', hash: '#/assets', label: '资料', icon: '▦' },
  { key: 'system', hash: '#/system', label: '系统', icon: '⚙' },
];

function renderNav(activeKey) {
  $('#nav').innerHTML = NAV.map((n) => `
    <a class="nav-item ${activeKey === n.key ? 'active' : ''}" href="${n.hash}">
      <span class="nav-icon">${n.icon}</span>
      <span class="nav-label">${n.label}</span>
      ${n.phase ? `<span class="nav-phase">${n.phase}</span>` : ''}
    </a>`).join('');
}

/* ---------------- 路由 ---------------- */
const routes = [
  { re: /^#?\/?$/, key: 'overview', get: () => overview },
  { re: /^#\/captures\/?$/, key: 'captures', get: () => captures },
  { re: /^#\/clients\/?$/, key: 'clients', get: () => clients },
  { re: /^#\/clients\/(.+)$/, key: 'client', get: (m) => ({ view: client, params: { ss: decodeURIComponent(m[1]) } }) },
  { re: /^#\/decisions\/?$/, key: 'decisions', get: () => decisions },
  { re: /^#\/knowledge\/?$/, key: 'knowledge', get: () => knowledge },
  { re: /^#\/notes\/(.+)$/, key: 'note', get: (m) => ({ view: note, params: { path: decodeURIComponent(m[1]) } }) },
  { re: /^#\/search\/?$/, key: 'search', get: () => search },
  { re: /^#\/assets\/?$/, key: 'assets', get: () => assets },
  { re: /^#\/system\/?$/, key: 'system', get: () => system },
];

let current = null;      // { view, params, key }
let renderToken = 0;

function matchRoute(hash) {
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      const g = r.get(m);
      if (g && g.view) return { view: g.view, params: g.params || {}, key: r.key };
      return { view: g, params: {}, key: r.key };
    }
  }
  return { view: overview, params: {}, key: 'overview' };
}

async function renderRoute(force = false) {
  const { view, params, key } = matchRoute(location.hash || '#/');
  if (!force && current && current.view === view && current.hash === location.hash) return;
  current = { view, params, key, hash: location.hash };
  renderNav(key);
  const token = ++renderToken;
  const viewEl = $('#view');
  $('#pageTitle').textContent = view.title || '';
  $('#pageSub').textContent = typeof view.sub === 'function' ? view.sub(params) : (view.sub || '');
  const ctx = {
    refresh: () => renderRoute(true),
    refreshSoon: () => setTimeout(() => renderRoute(true), 600),
    go: (h) => { location.hash = h; },
  };
  try {
    await view.render(viewEl, params, ctx);
  } catch (e) {
    if (token === renderToken) {
      viewEl.innerHTML = `<div class="panel error-card"><b>页面加载失败</b><div class="dim">${esc(e.message || e)}</div><button class="btn" onclick="location.reload()">重新加载</button></div>`;
    }
  }
}

window.addEventListener('hashchange', () => renderRoute());

/* ---------------- 顶部同步提示 & 监听状态 ---------------- */
let syncTimer = null;
export function flashSync(text, kind = '') {
  const el = $('#syncChip');
  el.textContent = text;
  el.className = 'sync-chip show ' + kind;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { el.className = 'sync-chip'; el.textContent = '已同步'; }, 2600);
}

let watchState = null;
export function updateWatch(w) {
  if (!w) return;
  watchState = w;
  const dot = $('#sideWatch .dot');
  const txt = $('#sideWatchText');
  if (w.offline) {
    dot.className = 'dot off';
    txt.textContent = '库离线 · 自动重试中';
  } else {
    dot.className = 'dot';
    txt.textContent = '监听中' + (w.lastEventAt ? ` · ${fmtTime(w.lastEventAt)}` : '');
  }
}
export const getWatch = () => watchState;

/* ---------------- SSE ---------------- */
let helloSeen = false;
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onopen = () => { flashSync('实时连接已建立', 'ok'); $('#sseMini').className = 'sse-mini ok'; };
  es.onerror = () => { $('#sseMini').className = 'sse-mini off'; $('#sseMini').title = '实时流重连中…'; };
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    updateWatch(d.watch);
    $('#sideVault').textContent = (d.summary && d.summary.vault ? d.summary.vault.root : '') || '';
    if (helloSeen) {
      // 重连（例如工作台刚重启过）→ 刷新当前页，避免展示重启前的旧数据
      flashSync('连接已恢复 · 正在刷新', 'ok');
      setTimeout(() => renderRoute(true), 900);
    }
    helloSeen = true;
  });
  es.addEventListener('ping', (e) => updateWatch(JSON.parse(e.data).watch));
  es.addEventListener('change', (e) => {
    const d = JSON.parse(e.data);
    const isSelf = d.source === 'self';
    const first = (d.paths && d.paths[0]) || '';
    const name = first.split('/').pop().replace(/\.md$/, '');
    if (isSelf) {
      const opName = d.op === 'followup' ? '跟进已写入' : d.op === 'index-status' ? '状态已更新' : d.op === 'restore' ? '已恢复备份' : '已写入';
      flashSync(`${opName} · ${name}`, 'self');
    } else {
      flashSync(`库更新 · ${name}${d.paths.length > 1 ? ` 等 ${d.paths.length} 处` : ''}`, '');
    }
    try { current && current.view && current.view.onEvent && current.view.onEvent('change', d, { refreshSoon: () => setTimeout(() => renderRoute(true), 500) }); } catch (e2) { /* ignore */ }
  });
}

/* ---------------- Toast ---------------- */
export function toast(text, { action, kind = 'ok', ms = 5200 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="toast-text">${esc(text)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { action.onClick(); el.remove(); };
    el.appendChild(btn);
  }
  const x = document.createElement('button');
  x.className = 'toast-close';
  x.textContent = '✕';
  x.onclick = () => el.remove();
  el.appendChild(x);
  box.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, ms);
  while (box.children.length > 5) box.removeChild(box.firstChild);
}

/* ---------------- 确认弹窗（Promise 风格） ---------------- */
export function modal({ title, body, confirmLabel = '确认', cancelLabel = '取消', kind = '', extraHTML = '', okOnly = false }) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.innerHTML = `
      <div class="modal ${kind}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x">✕</button></div>
        <div class="modal-body">${body}</div>
        ${extraHTML}
        <div class="modal-foot">
          ${okOnly ? '' : `<button class="btn ghost modal-cancel">${esc(cancelLabel)}</button>`}
          <button class="btn primary modal-ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('.modal-x').onclick = () => done(false);
    const cancelBtn = wrap.querySelector('.modal-cancel');
    if (cancelBtn) cancelBtn.onclick = () => done(false);
    wrap.querySelector('.modal-ok').onclick = () => done(true);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    root.appendChild(wrap);
  });
}

/* ---------------- 主题三态切换：auto / light / dark ----------------
   只写 data-theme 属性，色彩全部由 CSS 变量 + 媒体查询接管；
   选择持久化于 localStorage，<head> 内联脚本负责绘制前恢复，避免白闪/墨闪。 */
function initThemeSelector() {
  const selector = $('#theme-selector');
  if (!selector) return;
  const buttons = selector.querySelectorAll('.seg-btn');
  const root = document.documentElement;

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    buttons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-theme') === theme));
    try { localStorage.setItem('ow-theme', theme); } catch (e) { /* ignore */ }
  }

  const current = root.getAttribute('data-theme') || 'auto';
  buttons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-theme') === current));
  buttons.forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.getAttribute('data-theme'))));
}

/* ---------------- 稿纸网格开关 ---------------- */
function initGridToggle() {
  const btn = $('#btnGridToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('manuscript-grid');
    btn.classList.toggle('active', enabled);
    btn.textContent = enabled ? '稿纸 ON' : '稿纸 OFF';
  });
}

/* ---------------- 启动 ---------------- */
$('#btnReload').onclick = () => renderRoute(true);
initThemeSelector();
initGridToggle();
renderRoute();
connectSSE();
$('#sideVault').title = '';
