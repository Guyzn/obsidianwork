/* 便签 · 待办 / 火花速记（与「新建笔记」同源的追加式清单，直接落库） */
import { $, esc, api, debounce } from '../util.js';
import { toast, modal, flashSync } from '../app.js';

const refreshSoon = debounce((ctx) => ctx.refresh(), 600);

function todoRow(item) {
  const done = item.done;
  return `<div class="cap-row ${done ? 'done' : ''}">
    <button class="cap-check ${done ? 'on' : ''}" data-toggle="${esc(item.raw)}" title="${done ? '取消勾选' : '标记完成'}">${done ? '✓' : ''}</button>
    <span class="cap-text">${esc(item.text)}</span>
    ${item.date ? `<span class="cap-date dim mono">${esc(item.date)}</span>` : ''}
  </div>`;
}

async function undoCapture(backupId, ctx) {
  const ok = await modal({
    title: '撤销这次速记？',
    body: `<div>将把清单恢复到追加前的状态（Obsidian 里会立即同步）。</div>
           <div class="dim fs12" style="margin-top:6px">恢复前也会先把当前状态备份一份，随时可再撤回。</div>`,
    confirmLabel: '恢复',
  });
  if (!ok) return;
  try {
    const r = await api('POST', '/api/v3/backup/restore', { id: backupId });
    toast(`已恢复 ${r.relPath.split('/').pop()}`, { kind: 'ok' });
    ctx.refresh();
  } catch (e) { toast('恢复失败：' + e.message, { kind: 'err' }); }
}

export const captures = {
  id: 'captures',
  title: '便签',
  sub: '待办 / 火花 · 追加式速记，直接落库（与新建笔记同源：追加 + 备份 + 可撤销）',
  async render(el, params, ctx) {
    const d = await api('GET', '/api/v3/captures');
    const pending = d.todo.items.filter((i) => !i.done).slice().reverse();
    const done = d.todo.items.filter((i) => i.done).slice().reverse();
    const sparks = d.spark.items.slice().reverse();

    el.innerHTML = `
      <div class="toolbar">
        <div class="dim fs12">⚡ 待办 ${pending.length} 项未完成 · 已完成 ${done.length} · ✦ 火花 ${sparks.length} 条</div>
        <div class="toolbar-right">
          ${d.todo.exists ? '<button class="btn ghost" id="btnTodoObs">待办清单 · Obsidian</button>' : ''}
          ${d.spark.exists ? '<button class="btn ghost" id="btnSparkObs">火花清单 · Obsidian</button>' : ''}
        </div>
      </div>

      <div class="grid2">
        <div class="panel">
          <h2>⚡ 待办 <small>回车即存 · 点左侧圆圈勾选完成</small></h2>
          <div class="cap-add"><input id="todoAdd" class="input" placeholder="加一条待办，回车即存…"></div>
          <div class="cap-list" id="todoList">
            ${pending.map(todoRow).join('') || '<div class="dim list-pad">没有未完成待办</div>'}
          </div>
          ${done.length ? `<details class="cap-done"><summary>已完成（${done.length}）</summary><div class="cap-list dim-done">${done.map(todoRow).join('')}</div></details>` : ''}
        </div>

        <div class="panel">
          <h2>✦ 火花 <small>灵感与线索 · 回车即存</small></h2>
          <div class="cap-add"><input id="sparkAdd" class="input" placeholder="记一条火花，回车即存…"></div>
          <div class="cap-list" id="sparkList">
            ${sparks.map((i) => `
              <div class="cap-row">
                <span class="cap-text">${esc(i.text)}</span>
                ${i.date ? `<span class="cap-date dim mono">${esc(i.date)}</span>` : ''}
              </div>`).join('') || '<div class="dim list-pad">还没有火花</div>'}
          </div>
        </div>
      </div>`;

    /* 快速追加 */
    const add = async (kind, input) => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const r = await api('POST', '/api/v3/captures', { kind, text });
        toast(`已加入${kind === 'todo' ? '待办' : '火花'}`, {
          action: { label: '撤销', onClick: () => undoCapture(r.backupId, ctx) },
        });
        ctx.refresh();
      } catch (e) {
        toast('保存失败：' + e.message, { kind: 'err' });
        input.value = text;
      }
    };
    $('#todoAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') add('todo', e.target); });
    $('#sparkAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') add('spark', e.target); });

    /* 勾选 / 取消勾选 */
    el.querySelectorAll('button[data-toggle]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api('POST', '/api/v3/captures/toggle', { raw: b.dataset.toggle });
          ctx.refresh();
        } catch (e) { toast(e.message, { kind: 'err' }); }
      };
    });

    /* 在 Obsidian 打开清单 */
    const obs = (rel) => api('GET', `/api/v3/open?app=obsidian&path=${encodeURIComponent(rel)}`)
      .then(() => flashSync('已在 Obsidian 打开', 'self'))
      .catch((e) => toast(e.message, { kind: 'err' }));
    if ($('#btnTodoObs')) $('#btnTodoObs').onclick = () => obs(d.todo.relPath);
    if ($('#btnSparkObs')) $('#btnSparkObs').onclick = () => obs(d.spark.relPath);
  },

  onEvent(kind, d, ctx) {
    if (d.paths && d.paths.some((p) => p.startsWith('工作台/'))) refreshSoon(ctx);
  },
};
