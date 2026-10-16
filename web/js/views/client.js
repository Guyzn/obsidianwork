/* 客户详情 · 单客户工作页（含追加跟进 / 状态更新写回） */
import { $, esc, api, fmtDT, daysLabel, daysClass, flagChips, copyText, store, debounce } from '../util.js';
import { toast, modal, flashSync } from '../app.js';

let myRelPath = null;
const todayYMD = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const OP_LABEL = { followup: '追加跟进', 'index-status': '状态更新', restore: '恢复', 'pre-restore': '恢复前备份', 'note-create': '新建笔记', 'capture-todo': '速记·待办', 'capture-spark': '速记·火花', 'capture-toggle': '勾选待办', trash: '移入 .trash' };
const refreshSoon = debounce((ctx) => ctx.refresh(), 600);

async function openIn(app, relPath) {
  try {
    await api('GET', `/api/v3/open?app=${app}&path=${encodeURIComponent(relPath)}`);
    flashSync(app === 'obsidian' ? '已在 Obsidian 打开' : '已用系统程序打开', 'self');
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

function summaryText(d) {
  const c = d.client;
  const out = [];
  out.push(`${c.ss ? c.ss + ' · ' : ''}${c.name}${c.country ? ' · ' + c.country : ''}`);
  out.push(`状态：${c.status || '—'}`);
  out.push(`最近活动：${c.lastDate || '—'}（${daysLabel(c.days)}）· 档案 ${(c.bytes / 1024).toFixed(1)} KB`);
  if (d.timeline.length) {
    out.push('最近动态：');
    for (const t of d.timeline.slice(0, 6)) out.push(`- ${t.date}：${t.text.replace(/\*\*/g, '').slice(0, 140)}`);
  }
  return out.join('\n');
}

/* ---------- 写回：追加跟进 ---------- */
async function flowFollowup(ss, relPath, ctx) {
  const ta = $('#fuText');
  const text = (ta && ta.value || '').trim();
  if (!text) { toast('先写点内容再提交', { kind: 'err' }); ta && ta.focus(); return; }
  const date = ($('#fuDate') && $('#fuDate').value) || todayYMD();
  let pre;
  try {
    pre = await api('POST', `/api/v3/clients/${encodeURIComponent(ss)}/followup`, { text, date, dryRun: true });
  } catch (e) { toast('预览失败：' + e.message, { kind: 'err' }); return; }
  const modeTip = pre.mode === 'merge-section' ? '并入档案末尾的当日跟进节' : '在档案末尾新建跟进节';
  const ok = await modal({
    title: '追加跟进 · 写入预览',
    body: `
      <div class="kv"><span>写入目标</span><code>${esc(pre.relPath)}</code></div>
      <div class="kv"><span>写入方式</span><span>纯追加，不改动任何已有内容 · ${modeTip}</span></div>
      <div class="kv"><span>字节变化</span><span>${pre.bytesBefore.toLocaleString()} → ${pre.bytesAfter.toLocaleString()} <span class="green">(+${pre.delta})</span></span></div>
      <div class="preview-label">将追加的内容</div>
      <pre class="preview">${esc(pre.previewMarkdown)}</pre>
      <div class="dim fs12">写入前自动做字节级备份，写入后可一键撤销；Obsidian 里会立即看到。</div>`,
    confirmLabel: '确认写入',
  });
  if (!ok) return;
  try {
    const r = await api('POST', `/api/v3/clients/${encodeURIComponent(ss)}/followup`, { text, date });
    ta.value = '';
    toast(`已追加到 ${r.relPath.split('/').pop()}（备份 ${r.backupId}）`, {
      action: { label: '撤销', onClick: () => undoRestore(r.backupId, ctx) },
    });
    ctx.refresh();
  } catch (e) { toast('写入失败：' + e.message, { kind: 'err' }); }
}

/* ---------- 写回：索引状态更新 ---------- */
async function flowStatus(ss, ctx) {
  const inp = $('#stText');
  const text = (inp && inp.value || '').trim();
  if (!text) { toast('先写状态更新内容', { kind: 'err' }); inp && inp.focus(); return; }
  let pre;
  try {
    pre = await api('POST', '/api/v3/index/status', { ss, text, dryRun: true });
  } catch (e) { toast('预览失败：' + e.message, { kind: 'err' }); return; }
  const ok = await modal({
    title: '索引状态更新 · 写入预览',
    body: `
      <div class="kv"><span>写入目标</span><code>${esc(pre.relPath)} · 第 ${pre.lineNo} 行</code></div>
      <div class="kv"><span>写入方式</span><span>只追加更新标注，旧值永不删除</span></div>
      <div class="kv"><span>字节变化</span><span>${pre.bytesBefore.toLocaleString()} → ${pre.bytesAfter.toLocaleString()} <span class="green">(+${pre.delta})</span></span></div>
      <div class="preview-label">追加的标注</div>
      <pre class="preview">${esc(pre.piece)}</pre>
      <div class="preview-label">更新后的完整状态行</div>
      <pre class="preview tall">${esc(pre.newStatus)}</pre>
      <div class="dim fs12">只此一行被替换，其余字节完全不动；写入前自动备份。</div>`,
    confirmLabel: '确认更新',
  });
  if (!ok) return;
  try {
    const r = await api('POST', '/api/v3/index/status', { ss, text });
    inp.value = '';
    toast(`索引第 ${r.lineNo} 行已更新（备份 ${r.backupId}）`, {
      action: { label: '撤销', onClick: () => undoRestore(r.backupId, ctx) },
    });
    ctx.refresh();
  } catch (e) { toast('更新失败：' + e.message, { kind: 'err' }); }
}

/* ---------- 恢复 ---------- */
async function undoRestore(backupId, ctx, isTrash = false) {
  const ok = await modal({
    title: isTrash ? '撤销这次新建？' : '恢复到写入前？',
    body: isTrash
      ? `<div>将把这篇笔记移入库内 <code>.trash</code>（可在 Obsidian 里找回，并非删除）。</div>`
      : `<div>将把目标文件逐字节恢复到这次写入前的状态。Obsidian 里会立即跟着变。</div>
         <div class="dim fs12" style="margin-top:6px">恢复前也会先把当前状态再备份一份（pre-restore），不怕手滑。</div>`,
    confirmLabel: isTrash ? '移入 .trash' : '恢复',
  });
  if (!ok) return;
  try {
    const r = await api('POST', '/api/v3/backup/restore', { id: backupId });
    toast(r.action === 'trashed' ? `已移入 .trash：${r.trashName}` : `已恢复 ${r.relPath.split('/').pop()} 到写入前版本`, { kind: 'ok' });
    ctx && ctx.refresh();
  } catch (e) { toast('恢复失败：' + e.message, { kind: 'err' }); }
}

/* ================= 视图 ================= */
export const client = {
  id: 'client',
  title: '客户详情',
  sub: (p) => p.ss,
  async render(el, params, ctx) {
    const d = await api('GET', `/api/v3/clients/${encodeURIComponent(params.ss)}`);
    const c = d.client;
    myRelPath = d.relPath;

    /* 记录“最近打开” */
    const rec = store.get('ow.recent', []).filter((x) => x.ss !== (c.ss || c.file));
    rec.unshift({ ss: c.ss || c.file, name: c.name, at: new Date().toISOString() });
    store.set('ow.recent', rec.slice(0, 10));

    const canWrite = !!d.relPath;
    const tl = d.timeline.map((t) => `
      <div class="tl-item">
        <div class="tl-date mono">${t.date}</div>
        <div class="tl-text" title="${esc(t.text)}">${esc(t.text.replace(/\*\*/g, ''))}</div>
      </div>`).join('') || '<div class="dim">档案里没有日期条目</div>';

    const backs = (d.backups || []).map((b) => `
      <div class="backup-item">
        <span class="mono fs11 dim">${fmtDT(b.at)}</span>
        <span class="chip sm">${OP_LABEL[b.op] || b.op}</span>
        <span class="dim fs11">${b.bytesBefore.toLocaleString()} B</span>
        ${b.hasFile
          ? `<button class="btn mini ghost" data-restore="${esc(b.id)}">恢复</button>`
          : (b.fileExisted === false
            ? `<button class="btn mini ghost" data-restore="${esc(b.id)}" data-trash="1">撤销创建</button>`
            : '<span class="dim fs11">无内容</span>')}
      </div>`).join('') || '<div class="dim fs12">还没有通过工作台写过这个档案</div>';

    el.innerHTML = `
      <div class="detail-head">
        <a class="back" href="#/clients">← 客户列表</a>
        <div class="dhrow">
          <h2 class="dhname">${c.ss ? `<span class="mono dim">${esc(c.ss)}</span> ` : ''}${esc(c.name)}${c.country ? `<span class="dim"> · ${esc(c.country)}</span>` : ''}</h2>
          <span class="ri-flags">${flagChips(c.flags)}</span>
          <span class="ri-days ${daysClass(c.days)}">${daysLabel(c.days)}</span>
        </div>
        <div class="dhstatus">${esc(c.status || '（索引中暂无状态）')}</div>
        <div class="dhmeta dim fs12">
          最近活动 ${c.lastDate || '—'} · 档案 ${d.relPath ? `${(c.bytes / 1024).toFixed(1)} KB` : '缺失！'} · 反链 ${d.backlinks.length}
        </div>
        <div class="dhbtns">
          ${d.relPath ? `<button class="btn" id="btnObs">在 Obsidian 打开</button>
          <button class="btn ghost" id="btnSys">默认程序打开</button>` : ''}
          <button class="btn ghost" id="btnCopy">复制摘要</button>
          ${(d.workspaceDirs || []).map((w) => `<button class="btn ghost ws-dir" data-rel="${esc(w.rel)}">📁 ${esc(w.name)}</button>`).join('')}
        </div>
      </div>

      <div class="grid2 detail-grid">
        <div class="col">
          <div class="panel">
            <h2>🕒 时间线 <small>来自档案日期条目 · 最新在上（${d.timeline.length} 条）</small></h2>
            <div class="timeline">${tl}</div>
          </div>
          <div class="panel">
            <h2>🗂 档案节 (${d.headings.length})</h2>
            <div class="sections">${d.headings.map((h) => `<span class="sec-item">${esc(h.text)}</span>`).join('') || '<span class="dim">无</span>'}</div>
          </div>
          <div class="panel">
            <h2>🔗 关联笔记（反链 ${d.backlinks.length}）</h2>
            <div class="list-pad">${d.backlinks.map((b) => `<a class="row-item slim" href="#" data-open-note="${esc(b.relPath)}"><span class="ri-name">${esc(b.title)}</span><span class="ri-sub">${esc(b.relPath)}</span></a>`).join('') || '<div class="dim fs12">没有其他笔记引用该档案</div>'}</div>
          </div>
        </div>

        <div class="col">
          <div class="panel write-panel">
            <h2>✏️ 追加跟进 <small>写入档案（纯追加 + 自动备份）</small></h2>
            <div class="list-pad">
              ${canWrite ? `
              <textarea id="fuText" class="input textarea" rows="4" placeholder="今天跟客户聊了什么？下一步是什么？（支持多行）"></textarea>
              <div class="write-row">
                <input type="date" id="fuDate" class="input" value="${todayYMD()}">
                <button class="btn primary" id="btnFu">预览并写入</button>
              </div>
              <div class="dim fs11" style="margin-top:6px">写入 → ${esc(d.relPath)}；Obsidian 立即可见；可一键撤销</div>
              ` : '<div class="dim">档案文件缺失，写回不可用</div>'}
            </div>
          </div>

          <div class="panel write-panel">
            <h2>🔄 索引状态更新 <small>只追加标注，旧值不删</small></h2>
            <div class="list-pad">
              ${canWrite ? `
              <input id="stText" class="input" placeholder="如：✅ 已收定金，转入生产排期">
              <div class="write-row">
                <button class="btn" id="btnSt">预览并更新</button>
              </div>
              <div class="dim fs11" style="margin-top:6px">更新客户档案索引里的状态行；标注自带日期与来源</div>
              ` : '<div class="dim">不可用</div>'}
            </div>
          </div>

          <div class="panel">
            <h2>🧾 写入记录 <small>备份与回滚</small></h2>
            <div class="list-pad"><div class="backup-list" id="backList">${backs}</div></div>
          </div>
        </div>
      </div>`;

    /* 绑定 */
    if (d.relPath) {
      $('#btnObs').onclick = () => openIn('obsidian', d.relPath);
      $('#btnSys').onclick = () => openIn('system', d.relPath);
    }
    $('#btnCopy').onclick = async () => {
      const ok = await copyText(summaryText(d));
      toast(ok ? '摘要已复制到剪贴板' : '复制失败', { kind: ok ? 'ok' : 'err' });
    };
    el.querySelectorAll('.ws-dir').forEach((b) => {
      b.onclick = () => api('GET', `/api/v3/open?app=system&root=workspace&path=${encodeURIComponent(b.dataset.rel)}`).catch((e) => toast(e.message, { kind: 'err' }));
    });
    el.querySelectorAll('[data-open-note]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); openIn('obsidian', a.dataset.openNote); };
    });
    const btnFu = $('#btnFu');
    if (btnFu) btnFu.onclick = () => flowFollowup(c.ss || c.file, d.relPath, ctx);
    const btnSt = $('#btnSt');
    if (btnSt) btnSt.onclick = () => flowStatus(c.ss || c.file, ctx);
    $('#backList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-restore]');
      if (b) undoRestore(b.dataset.restore, ctx, b.dataset.trash === '1');
    });
  },

  onEvent(kind, d, ctx) {
    if (myRelPath && d.paths && d.paths.includes(myRelPath)) refreshSoon(ctx);
  },
};
