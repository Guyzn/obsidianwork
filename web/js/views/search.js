/* 搜索：全库全文（标题 > 正文加权）· 结果高亮 · 直达笔记 */
import { $, esc, api, debounce } from '../util.js';

const state = { q: '', last: null };
const run = debounce(async () => {
  const q = state.q.trim();
  const info = $('#sInfo');
  const box = $('#sResults');
  if (!box) return;
  if (!q) {
    box.innerHTML = '<div class="dim">输入关键词开始搜索（标题 / 正文 / 路径都会命中）</div>';
    if (info) info.textContent = '';
    return;
  }
  try {
    const data = await api('GET', '/api/v3/search?q=' + encodeURIComponent(q));
    state.last = data;
    const n = data.results.length;
    $('#sInfo').textContent = `${n} 篇命中 · 全库 ${data.ms}ms`;
    box.innerHTML = data.results.map((r) => `
      <a class="row-item s-result" href="#/notes/${encodeURIComponent(r.relPath)}">
        <span class="ri-main">
          <span class="ri-name">${hl(r.title, q)}</span>
          <span class="ri-sub">${esc(r.relPath)} · ${r.hits ? '正文 ' + r.hits + ' 处' : '标题/路径命中'}</span>
          ${r.snippet ? `<span class="s-snip">…${hl(r.snippet, q)}…</span>` : ''}
        </span>
      </a>`).join('') || '<div class="dim">没有命中，换个词试试（支持中文子串）</div>';
  } catch (e) {
    box.innerHTML = `<div class="red">${esc(e.message)}</div>`;
  }
}, 220);

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hl(text, q) {
  const e = esc(text);
  if (!q) return e;
  try {
    const re = new RegExp(escRe(q), 'gi');
    return e.replace(re, (m) => `<mark>${m}</mark>`);
  } catch (err) { return e; }
}

export const search = {
  id: 'search',
  title: '搜索',
  sub: '全库全文 · 内存索引毫秒级 · 回车即搜',
  async render(el) {
    el.innerHTML = `
      <div class="toolbar">
        <input id="sq" class="input search-input" placeholder="全库搜索：牌号 / 客户 / 标准 / 任意片段…" value="${esc(state.q)}">
        <div class="dim fs12" id="sTip">标题命中权重最高，正文命中带上下片断</div>
      </div>
      <div class="panel">
        <h2>结果 <small id="sInfo"></small></h2>
        <div class="list-pad" id="sResults"><div class="dim">输入关键词开始搜索（标题 / 正文 / 路径都会命中）</div></div>
      </div>`;
    const inp = $('#sq');
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.addEventListener('input', () => { state.q = inp.value; run(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.q = inp.value; run(); } });
    if (state.q.trim()) run();
  },

  onEvent() { /* 搜索页不自动刷新，避免打断输入 */ },
};
