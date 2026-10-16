/* 总览 · 驾驶舱 */
import { $, esc, api, fmtTime, fmtDT, daysLabel, daysClass, flagChips, store, debounce } from '../util.js';

const relTime = (iso) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + ' 秒前';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  return fmtTime(iso);
};

const TYPE_LABEL = { external: '改动', self: '写入', restore: '恢复' };

function actText(a) {
  const names = (a.paths || []).map((p) => p.split('/').pop().replace(/\.md$/, ''));
  const head = names.slice(0, 2).join('、') + (names.length > 2 ? ` 等 ${names.length} 处` : '');
  const op = a.op === 'followup' ? '追加跟进' : a.op === 'index-status' ? '更新索引' : a.op === 'restore' ? '恢复备份' : a.op === 'pre-restore' ? '恢复前备份' : '';
  return { head, op };
}

const refreshSoon = debounce((ctx) => ctx.refresh(), 700);

export const overview = {
  id: 'overview',
  title: '总览',
  sub: '驾驶舱 · 全部数据来自库索引，实时互通',
  async render(el, params, ctx) {
    el.innerHTML = `
      <div class="cards" id="ovCards">
        <div class="card"><div class="n" id="ovTotal">—</div><div class="l">客户总数</div></div>
        <div class="card hot"><div class="n" id="ovHot">—</div><div class="l">🔥 火线</div></div>
        <div class="card todo"><div class="n" id="ovTodo">—</div><div class="l">⏰ 待办</div></div>
        <div class="card risk"><div class="n" id="ovRisk">—</div><div class="l">⚠ 风险</div></div>
        <div class="card dec"><div class="n" id="ovDec">—</div><div class="l">待 Guy 裁决</div></div>
        <div class="card"><div class="n" id="ovToday">—</div><div class="l">今日动态</div></div>
      </div>
      <div class="grid2">
        <div class="col">
          <div class="panel">
            <h2>✎ 待办 <small id="ovCapSub"></small><a class="h2link" href="#/captures">去便签页 →</a></h2>
            <div id="ovCaptures" class="list-pad"><div class="dim">加载中…</div></div>
          </div>
          <div class="panel">
            <h2>⏳ 超期关注 <small id="ovFocusSub"></small><a class="h2link" href="#/clients">全部客户 →</a></h2>
            <div id="ovFocus" class="list-pad"><div class="dim">加载中…</div></div>
          </div>
          <div class="panel">
            <h2>⚖ 待 Guy 裁决 <small id="ovDecSub"></small></h2>
            <div id="ovDecList" class="list-pad"><div class="dim">加载中…</div></div>
          </div>
        </div>
        <div class="col">
          <div class="panel">
            <h2>📡 实时动态 <small>Obsidian 里改一个字，这里 1 秒内出现</small></h2>
            <div id="ovFeed" class="feed"><div class="dim list-pad">加载中…</div></div>
          </div>
          <div class="panel">
            <h2>🕘 最近打开</h2>
            <div id="ovRecent" class="list-pad"></div>
          </div>
        </div>
      </div>`;

    const [summary, cl, dec, act, caps] = await Promise.all([
      api('GET', '/api/v3/summary'),
      api('GET', '/api/v3/clients'),
      api('GET', '/api/v3/decisions'),
      api('GET', '/api/v3/activity?limit=50'),
      api('GET', '/api/v3/captures'),
    ]);

    /* 指标卡 */
    $('#ovTotal').textContent = summary.clients.total;
    $('#ovHot').textContent = summary.clients.hot;
    $('#ovTodo').textContent = summary.clients.todo;
    $('#ovRisk').textContent = summary.clients.risk;
    $('#ovDec').textContent = dec.openCount;
    $('#ovToday').textContent = act.todayCount;

    /* 待办速览 */
    const pend = caps.todo.items.filter((i) => !i.done).slice().reverse();
    $('#ovCapSub').textContent = pend.length ? `${pend.length} 项未完成 · 火花 ${caps.counts.spark}` : `全部完成 · 火花 ${caps.counts.spark}`;
    $('#ovCaptures').innerHTML = pend.slice(0, 4).map((i) => `
      <a class="row-item slim" href="#/captures">
        <span class="ri-main"><span class="ri-name">${esc(i.text)}</span>${i.date ? `<span class="ri-sub">${esc(i.date)}</span>` : ''}</span>
      </a>`).join('') || '<div class="dim">没有未完成待办 · 去便签页记一条</div>';

    /* 超期关注 */
    const focus = cl.clients
      .filter((c) => c.days != null && c.days >= 7)
      .sort((a, b) => (b.days || 0) - (a.days || 0))
      .slice(0, 9);
    $('#ovFocusSub').textContent = focus.length ? `≥7 天未动 · ${focus.length} 户` : '';
    $('#ovFocus').innerHTML = focus.length ? focus.map((c) => `
      <a class="row-item" href="#/clients/${encodeURIComponent(c.ss || c.file)}">
        <span class="ri-main">
          <span class="ri-name">${esc(c.name)}</span>
          <span class="ri-sub">${esc(c.ss || '')}${c.country ? ' · ' + esc(c.country) : ''}</span>
        </span>
        <span class="ri-flags">${flagChips(c.flags)}</span>
        <span class="ri-days ${daysClass(c.days)}">${daysLabel(c.days)}</span>
      </a>`).join('') : '<div class="dim">没有超期客户 · 节奏良好</div>';

    /* 待裁决 */
    const decItems = dec.open.slice(0, 6);
    $('#ovDecSub').textContent = `${dec.openCount} 项待拍板`;
    $('#ovDecList').innerHTML = decItems.length ? decItems.map((d) => `
      <details class="dec-item">
        <summary><span class="dec-n">#${d.n}</span> <span>${esc(d.title)}</span>${d.fresh ? '<span class="chip hot">新</span>' : ''}</summary>
        <div class="dec-note dim">${esc((d.handling || d.dispute || '').slice(0, 220))}</div>
      </details>`).join('') + `<div style="margin-top:8px"><a class="h2link" href="#/decisions">进入决策中心（含结案与原文）→</a></div>`
      : '<div class="dim">暂无待裁决项</div>';

    /* 实时动态 */
    renderFeed($('#ovFeed'), act.items);

    /* 最近打开 */
    const recent = store.get('ow.recent', []).slice(0, 6);
    $('#ovRecent').innerHTML = recent.length ? recent.map((r) => `
      <a class="row-item slim" href="#/clients/${encodeURIComponent(r.ss)}">
        <span class="ri-main"><span class="ri-name">${esc(r.name)}</span><span class="ri-sub">${esc(r.ss)}</span></span>
        <span class="ri-days dim">${fmtDT(r.at)}</span>
      </a>`).join('') : '<div class="dim">还没有打开过客户档案</div>';
  },

  onEvent(kind, d, ctx) {
    refreshSoon(ctx);
  },
};

function renderFeed(el, items) {
  if (!items || !items.length) {
    el.innerHTML = '<div class="dim list-pad">暂无动态。去 Obsidian 改一篇笔记试试。</div>';
    return;
  }
  el.innerHTML = items.map((a) => {
    const { head, op } = actText(a);
    const label = op || TYPE_LABEL[a.type] || a.type;
    return `<div class="feed-item ${a.type}">
      <span class="fi-time">${relTime(a.at)}</span>
      <span class="fi-kind ${a.type}">${esc(label)}</span>
      <span class="fi-path" title="${esc((a.paths || []).join('\n'))}">${esc(head)}</span>
      ${a.ms != null ? `<span class="fi-ms dim">${a.ms}ms</span>` : ''}
    </div>`;
  }).join('');
}
