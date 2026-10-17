/* 决策中心：待 Guy 裁决（全表 + 已结案折叠）+ 历史裁决 + 跳原文 */
import { $, esc, api, debounce } from '../util.js';
import { toast, flashSync } from '../app.js';

const refreshSoon = debounce((ctx) => ctx.refresh(), 800);

async function openIn(app, relPath) {
  try {
    await api('GET', `/api/v3/open?app=${app}&path=${encodeURIComponent(relPath)}`);
    flashSync('已在 Obsidian 打开', 'self');
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

function itemCard(d, relPath) {
  return `
    <details class="dec-card ${d.fresh ? 'is-fresh' : ''}">
      <summary>
        <span class="dec-n">#${d.n}</span>
        <span class="dec-title">${esc(d.title)}</span>
        ${d.fresh ? '<span class="chip hot">新</span>' : ''}
        <span class="dec-arrow">▾</span>
      </summary>
      <div class="dec-body">
        ${d.dispute ? `<div class="dec-field"><span class="dec-label">争议点</span><div>${esc(d.dispute)}</div></div>` : ''}
        ${d.handling ? `<div class="dec-field"><span class="dec-label">现状处理</span><div>${esc(d.handling)}</div></div>` : ''}
        <div class="dec-actions">
          <a class="btn mini ghost" href="#/notes/${encodeURIComponent(relPath)}">在索引中查看</a>
          <button class="btn mini ghost" data-obs="${esc(relPath)}">在 Obsidian 打开</button>
        </div>
      </div>
    </details>`;
}

export const decisions = {
  id: 'decisions',
  title: '决策',
  sub: '待 Guy 裁决 · 实时自索引（拍板后由同步流程结案）',
  async render(el, params, ctx) {
    const d = await api('GET', '/api/v3/decisions');
    const relPath = d.relPath;

    el.innerHTML = `
      <div class="cards three">
        <div class="card dec"><div class="n">${d.openCount}</div><div class="l">待裁决${d.freshCount ? `（含 ${d.freshCount} 项新）` : ''}</div></div>
        <div class="card"><div class="n">${d.closed.length}</div><div class="l">已结案</div></div>
        <div class="card"><div class="n">${d.history.length}</div><div class="l">历史裁决（其他确认）</div></div>
      </div>

      <div class="panel">
        <h2>// 待 Guy 裁决 <small>${esc(d.sectionTitle || '')} · 共 ${d.openCount} 项</small>
          <a class="h2link" href="#/notes/${encodeURIComponent(relPath)}">索引原文 →</a></h2>
        <div class="dec-list">
          ${d.open.map((x) => itemCard(x, relPath)).join('') || '<div class="dim list-pad">没有待裁决项 · 全部拍完</div>'}
        </div>
        ${d.footer ? `<div class="dec-footer dim">> ${esc(d.footer)}</div>` : ''}
      </div>

      <div class="panel">
        <h2>✅ 已结案 <small>点击展开（${d.closed.length}）</small></h2>
        <div class="dec-list">
          ${d.closed.map((x) => itemCard(x, relPath)).join('') || '<div class="dim list-pad">暂无</div>'}
        </div>
      </div>

      <div class="panel">
        <h2>📜 历史裁决 <small>${esc(d.historyTitle || '')}</small></h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th style="width:30%">事项</th><th>结论</th></tr></thead>
            <tbody>
              ${d.history.map((h) => `<tr><td><b>${esc(h.what)}</b></td><td class="status">${esc(h.conclusion)}</td></tr>`).join('') || '<tr><td colspan="2" class="dim">暂无</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-obs]');
      if (b) openIn('obsidian', b.dataset.obs);
    });
  },

  onEvent(kind, d, ctx) {
    if (d.paths && d.paths.some((p) => p.includes('客户档案索引'))) refreshSoon(ctx);
    else refreshSoon(ctx); // 索引之外的改动不常见，但保守刷新成本低
  },
};
