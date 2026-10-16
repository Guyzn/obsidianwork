/* 系统 · 服务状态 + 备份与回滚 + 断链体检 + 运维 */
import { $, esc, api, fmtDT, fmtBytes, debounce } from '../util.js';
import { toast, modal } from '../app.js';

const OP_LABEL = { followup: '追加跟进', 'index-status': '状态更新', restore: '恢复', 'pre-restore': '恢复前备份', 'note-create': '新建笔记', 'capture-todo': '速记·待办', 'capture-spark': '速记·火花', 'capture-toggle': '勾选待办', trash: '移入 .trash' };
const refreshSoon = debounce((ctx) => ctx.refresh(), 800);

async function loadBroken() {
  const box = $('#blList');
  if (!box) return;
  box.innerHTML = '<div class="dim fs12">扫描中…</div>';
  try {
    const d = await api('GET', '/api/v3/links/broken');
    const info = $('#blInfo');
    if (info) info.textContent = d.count === 0 ? '全库双链健康 · 0 条断链' : `${d.count} 条断链`;
    box.innerHTML = d.count === 0
      ? '<div class="green fs12">✓ 没有断链——所有 [[双链]] 都能在库内找到目标</div>'
      : d.items.map((b) => `
          <div class="asset-row">
            <span class="asset-icon">🔗</span>
            <span class="asset-name">${esc(b.target)}</span>
            <span class="asset-date dim">来自 ${esc(b.from)}</span>
            <button class="btn mini ghost" data-broken-from="${esc(b.from)}">定位来源</button>
          </div>`).join('');
    box.querySelectorAll('button[data-broken-from]').forEach((btn) => {
      btn.onclick = () => api('GET', `/api/v3/open?app=obsidian&path=${encodeURIComponent(btn.dataset.brokenFrom)}`).catch((e) => toast(e.message, { kind: 'err' }));
    });
  } catch (e) {
    box.innerHTML = `<div class="red fs12">${esc(e.message)}</div>`;
  }
}

export const system = {
  id: 'system',
  title: '系统',
  sub: '服务 / 监听 / 备份与回滚 / 断链体检 / 运维',
  async render(el, params, ctx) {
    const [health, backups] = await Promise.all([
      api('GET', '/api/v3/system/health'),
      api('GET', '/api/v3/backups?limit=80'),
    ]);
    const w = health.watch;

    el.innerHTML = `
      <div class="cards three">
        <div class="card"><div class="n small" id="sysWatch">${w.offline ? '离线' : '在听'}</div><div class="l">库监听 ${w.offline ? '· ' + esc(w.reason || '') : ''}</div></div>
        <div class="card"><div class="n small">${health.notes.count}<span class="unit">篇</span></div><div class="l">库笔记 · ${fmtBytes(health.notes.fullTextBytes)} 全文在内存</div></div>
        <div class="card"><div class="n small">${health.uptimeSec >= 3600 ? (health.uptimeSec / 3600).toFixed(1) + '<span class="unit">小时</span>' : Math.round(health.uptimeSec / 60) + '<span class="unit">分钟</span>'}</div><div class="l">服务运行时长 · Node ${esc(health.node)}</div></div>
      </div>

      <div class="panel">
        <h2>🏥 库与服务状态</h2>
        <div class="list-pad kv-grid">
          <div class="kv"><span>库路径</span><code>${esc(health.vault.root)}</code></div>
          <div class="kv"><span>索引状态</span><span>${health.vault.healthy ? '<span class="green">健康</span>' : `<span class="red">异常：${esc(health.vault.error || '')}</span>`}</span></div>
          <div class="kv"><span>启动扫描</span><span>${health.vault.scanMs} ms（机械盘一次顺序读）· ${esc(health.vault.lastScanAt || '')}</span></div>
          <div class="kv"><span>监听详情</span><span>总事件 ${w.totalEvents} · 最近批次 ${w.lastBatchCount} 个 · ${esc(w.lastEventAt || '—')}</span></div>
          <div class="kv"><span>客户雷达</span><span>${(health.clients && health.clients.total) || 0} 户 · 待办 ${(health.clients && health.clients.todo) || 0} · 火线 ${(health.clients && health.clients.hot) || 0} · 超期(≥7天) <b class="${health.overdue ? 'amber' : ''}">${health.overdue != null ? health.overdue : '—'}</b></span></div>
          <div class="kv"><span>实时连接</span><span>${health.sseClients} 个浏览器在线</span></div>
          <div class="kv"><span>备份目录</span><code>${esc(health.backupRoot)}</code></div>
        </div>
      </div>

      <div class="panel">
        <h2>🧾 备份与回滚 <small>每次写入自动备份 · 一键恢复任意版本</small></h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>操作</th><th>目标文件</th><th>写入前大小</th><th>备注</th><th class="op-col">操作</th></tr></thead>
            <tbody>
              ${backups.backups.map((b) => `
                <tr>
                  <td class="mono fs11" style="white-space:nowrap">${fmtDT(b.at)}</td>
                  <td><span class="chip sm">${OP_LABEL[b.op] || esc(b.op)}</span></td>
                  <td class="mono fs11">${esc(b.relPath)}</td>
                  <td class="mono fs11">${b.bytesBefore != null ? b.bytesBefore.toLocaleString() + ' B' : '—'}</td>
                  <td class="dim fs12">${esc(b.note || '')}</td>
                  <td class="op-col">
                    ${b.hasFile
                      ? `<button class="btn mini ghost" data-restore="${esc(b.id)}">恢复到此前</button>`
                      : (b.fileExisted === false
                        ? `<button class="btn mini ghost" data-restore="${esc(b.id)}" data-trash="1">撤销创建</button>`
                        : '<span class="dim fs11">—</span>')}
                  </td>
                </tr>`).join('') || `<tr><td colspan="6" class="dim" style="padding:16px">还没有备份记录（每次通过工作台写入会自动生成）</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h2>🔗 断链体检 <small id="blInfo">…</small><button class="btn mini ghost" id="blRefresh">重新扫描</button></h2>
        <div class="list-pad" id="blList"><div class="dim fs12">扫描中…</div></div>
      </div>

      <div class="panel">
        <h2>🛠 运维</h2>
        <div class="list-pad ops-row">
          <button class="btn ghost" id="opLog">查看日志</button>
          <button class="btn ghost" id="opDiag">导出诊断包</button>
          <button class="btn ghost danger" id="opRestart">重启工作台</button>
          <span class="dim fs12" style="margin-left:auto">诊断包含日志 + 健康快照 + 断链/备份清单，导出到「下载」并在 Finder 定位</span>
        </div>
      </div>`;

    /* 断链体检 */
    loadBroken();
    $('#blRefresh').onclick = loadBroken;

    /* 查看日志 */
    $('#opLog').onclick = async () => {
      try {
        const d = await api('GET', '/api/v3/system/log?lines=240');
        await modal({
          title: '服务日志（尾部 240 行）',
          body: `<pre class="preview tall" style="max-height:52vh">${esc(d.log)}</pre>`
            + (d.err && d.err.trim() ? `<div class="preview-label">server.err（尾 60 行）</div><pre class="preview">${esc(d.err)}</pre>` : ''),
          okOnly: true,
          confirmLabel: '关闭',
        });
      } catch (e) { toast(e.message, { kind: 'err' }); }
    };

    /* 导出诊断包 */
    $('#opDiag').onclick = async () => {
      const btn = $('#opDiag');
      btn.disabled = true; btn.textContent = '打包中…';
      try {
        const r = await api('POST', '/api/v3/system/diagnostics', { reveal: true });
        toast(`诊断包已导出：${r.path.split('/').pop()}（${(r.bytes / 1024).toFixed(0)} KB，Finder 已定位）`, { kind: 'ok', ms: 9000 });
      } catch (e) { toast('导出失败：' + e.message, { kind: 'err' }); }
      finally { btn.disabled = false; btn.textContent = '导出诊断包'; }
    };

    /* 重启工作台 */
    $('#opRestart').onclick = async () => {
      const ok = await modal({
        title: '重启工作台？',
        body: `<div>服务将重启（约 2 秒），浏览器会自动重连；期间页面短暂无响应属正常。</div>
               <div class="dim fs12" style="margin-top:6px">库监听与索引会在启动后自动恢复，库文件不受影响。</div>`,
        confirmLabel: '重启',
      });
      if (!ok) return;
      try {
        await api('POST', '/api/v3/system/restart', {});
        toast('正在重启…页面会在几秒到十几秒内自动恢复', { kind: 'ok', ms: 9000 });
      } catch (e) { toast(e.message, { kind: 'err' }); }
    };

    el.querySelectorAll('button[data-restore]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.restore;
        const isTrash = b.dataset.trash === '1';
        const ok = await modal({
          title: isTrash ? '撤销这次新建？' : '恢复这个备份？',
          body: isTrash
            ? `<div>将把这篇笔记移入库内 <code>.trash</code>（可在 Obsidian 里找回，并非删除）。</div>`
            : `<div>将把目标文件逐字节恢复到备份时的状态。</div><div class="dim fs12" style="margin-top:6px">恢复前也会先把当前状态备份一份，随时可再撤回。</div>`,
          confirmLabel: isTrash ? '移入 .trash' : '恢复',
        });
        if (!ok) return;
        try {
          const r = await api('POST', '/api/v3/backup/restore', { id });
          toast(r.action === 'trashed' ? `已移入 .trash：${r.trashName}` : `已恢复 ${r.relPath.split('/').pop()}`, { kind: 'ok' });
          ctx.refresh();
        } catch (e) { toast('恢复失败：' + e.message, { kind: 'err' }); }
      };
    });
  },

  onEvent(kind, d, ctx) { refreshSoon(ctx); },
};
