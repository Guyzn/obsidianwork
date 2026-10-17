/* 客户 · 雷达总表 */
import { $, esc, api, daysLabel, daysClass, flagChips, store, debounce } from '../util.js';
import { flashSync } from '../app.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '⏰ 待办' },
  { key: 'hot', label: '火线' },
  { key: 'risk', label: '风险' },
  { key: 'paused', label: '⏸ 挂起' },
  { key: 'done', label: '✅ 闭环' },
  { key: 'plain', label: '无标记' },
];

const state = {
  filter: 'all',
  q: '',
  sort: 'days',          // days | recent | ss | name
};

const refreshSoon = debounce((ctx) => ctx.refresh(), 700);

export const clients = {
  id: 'clients',
  title: '客户',
  sub: '雷达总表 · 索引表为准，实时同步',
  async render(el, params, ctx) {
    const { clients: list, counts } = await api('GET', '/api/v3/clients');

    el.innerHTML = `
      <div class="toolbar">
        <div class="chips" id="clChips">
          ${FILTERS.map((f) => `<button class="chipbtn ${state.filter === f.key ? 'active' : ''}" data-f="${f.key}">${f.label}${f.key === 'all' ? ` <b>${counts.total}</b>` : ''}</button>`).join('')}
        </div>
        <div class="toolbar-right">
          <input id="clQ" class="input" placeholder="按名称 / 编号 / 国别筛选…" value="${esc(state.q)}">
          <select id="clSort" class="input select">
            <option value="days">超期优先</option>
            <option value="recent">最近活动</option>
            <option value="ss">编号</option>
            <option value="name">名称</option>
          </select>
        </div>
      </div>
      <div class="panel">
        <h2>客户雷达 <small id="clCount"></small></h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>编号</th><th>客户 / 国别</th><th>标记</th><th>最近活动</th><th>状态（索引摘要）</th><th class="op-col">操作</th></tr></thead>
            <tbody id="clBody"></tbody>
          </table>
        </div>
      </div>`;

    $('#clSort').value = state.sort;

    const apply = () => {
      const q = state.q.trim().toLowerCase();
      let rows = list.filter((c) => {
        if (state.filter === 'plain') { if (c.flags.length) return false; }
        else if (state.filter !== 'all') { if (!c.flags.some((f) => f.key === state.filter)) return false; }
        if (!q) return true;
        return [c.name, c.ss, c.country, c.status].join(' ').toLowerCase().includes(q);
      });
      if (state.sort === 'days') rows = rows.slice().sort((a, b) => (a.days == null ? 1 : b.days == null ? -1 : b.days - a.days));
      else if (state.sort === 'recent') rows = rows.slice().sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')));
      else if (state.sort === 'ss') rows = rows.slice().sort((a, b) => String(a.ss || a.file).localeCompare(String(b.ss || b.file)));
      else if (state.sort === 'name') rows = rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));

      $('#clCount').textContent = `${rows.length} / ${list.length} 户`;
      $('#clBody').innerHTML = rows.map((c) => `
        <tr class="cl-row" data-ss="${esc(c.ss || c.file)}">
          <td class="ss">${esc(c.ss || '—')}</td>
          <td class="name"><b>${esc(c.name)}</b>${c.country ? `<span class="dim"> · ${esc(c.country)}</span>` : ''}</td>
          <td>${flagChips(c.flags) || '<span class="dim">—</span>'}</td>
          <td class="${daysClass(c.days)}" style="white-space:nowrap">${daysLabel(c.days)}<div class="dim mono fs11">${c.lastDate || ''}</div></td>
          <td class="status">${esc((c.status || '').slice(0, 120))}${(c.status || '').length > 120 ? '…' : ''}</td>
          <td class="op-col">
            <button class="btn mini" data-act="detail">档案</button>
            <button class="btn mini ghost" data-act="obsidian" title="在 Obsidian 打开">Obs</button>
          </td>
        </tr>`).join('') || `<tr><td colspan="6" class="dim" style="padding:16px">没有符合条件的客户</td></tr>`;
    };

    $('#clChips').addEventListener('click', (e) => {
      const b = e.target.closest('.chipbtn');
      if (!b) return;
      state.filter = b.dataset.f;
      el.querySelectorAll('.chipbtn').forEach((x) => x.classList.toggle('active', x === b));
      apply();
    });
    $('#clQ').addEventListener('input', (e) => { state.q = e.target.value; apply(); });
    $('#clSort').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });

    $('#clBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr.cl-row');
      if (!tr) return;
      const ss = tr.dataset.ss;
      const btn = e.target.closest('button[data-act]');
      const act = btn ? btn.dataset.act : 'detail';
      if (act === 'obsidian') {
        const c = list.find((x) => (x.ss || x.file) === ss);
        const file = c.file.toLowerCase().endsWith('.md') ? c.file : c.file + '.md';
        try {
          await api('GET', `/api/v3/open?app=obsidian&path=${encodeURIComponent('Clients/' + file)}`);
          flashSync('已在 Obsidian 打开', 'self');
        } catch (err) { flashSync(err.message, ''); }
        return;
      }
      location.hash = '#/clients/' + encodeURIComponent(ss);
    });

    apply();
  },

  onEvent(kind, d, ctx) { refreshSoon(ctx); },
};
