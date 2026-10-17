/* 知识库：五分区树 + 枢纽 + 新建笔记 */
import { $, esc, api, fmtDT } from '../util.js';
import { toast, modal } from '../app.js';

const GLYPH = { '产品知识': '⌗', '业务流程': '⌗', '客户沟通': '⌗', '行业参考': '⌗', '风控案例': '⌗' };

function noteRow(n) {
  return `<a class="row-item slim" href="#/notes/${encodeURIComponent(n.relPath)}">
    <span class="ri-main">
      <span class="ri-name">${esc(n.title)}</span>
      <span class="ri-sub">${esc(n.relPath.split('/').pop())}</span>
    </span>
    <span class="ri-days dim">${fmtDT(n.mtimeMs)}</span>
  </a>`;
}

function sectionPanel(sec) {
  return `<div class="panel k-panel">
    <h2>${GLYPH[sec.folder] || '⌗'} ${esc(sec.folder)} <small>${sec.notes.length} 篇</small></h2>
    <div class="list-pad k-list">${sec.notes.map(noteRow).join('')}</div>
  </div>`;
}

export const knowledge = {
  id: 'knowledge',
  title: '知识',
  sub: '五个分区 + 两个枢纽 · 双链互通 · 与 Obsidian 同一批文件',
  async render(el, params, ctx) {
    const tree = await api('GET', '/api/v3/knowledge/tree');
    const secCount = tree.sections.reduce((s, g) => s + g.notes.length, 0);

    el.innerHTML = `
      <div class="toolbar">
        <div class="dim fs12">共 ${tree.total} 篇 · 知识分区 ${secCount} 篇 · 客户档案 ${tree.clientsCount} 份</div>
        <div class="toolbar-right"><button class="btn primary" id="btnNewNote">＋ 新建笔记</button></div>
      </div>

      <div class="hub-row">
        ${tree.root.map((r) => `<a class="hub-card" href="#/notes/${encodeURIComponent(r.relPath)}">
          <div class="hub-title">${esc(r.title)}</div>
          <div class="hub-sub dim">${esc(r.relPath)}</div>
        </a>`).join('')}
        <a class="hub-card" href="#/clients">
          <div class="hub-title">📇 客户档案区</div>
          <div class="hub-sub dim">${tree.clientsCount} 份 · 去客户雷达</div>
        </a>
      </div>

      <div class="k-grid">
        ${tree.sections.map(sectionPanel).join('')}
        ${tree.others.map(sectionPanel).join('')}
      </div>`;

    $('#btnNewNote').onclick = () => openCreateModal(ctx);
  },

  onEvent(kind, d, ctx) {
    // 库笔记增删改都会影响树
    if (d.paths && d.paths.some((p) => !p.startsWith('Clients/'))) ctx.refreshSoon();
  },
};

/* ================= 新建（笔记 / 速记） ================= */
async function openCreateModal(ctx) {
  const { templates } = await api('GET', '/api/v3/notes/templates');
  let tpl = templates.find((t) => t.key === 'knowledge') || templates[0];

  const root = document.createElement('div');
  root.className = 'modal-mask';
  root.innerHTML = `
    <div class="modal wide">
      <div class="modal-head"><h3>新建（笔记 / 速记）</h3><button class="modal-x">✕</button></div>
      <div class="modal-body">
        <div class="tpl-chips">
          ${templates.map((t) => `<button class="chipbtn ${t.key === tpl.key ? 'active' : ''}" data-t="${t.key}">${esc(t.label)}</button>`).join('')}
        </div>
        <div class="tpl-fields"></div>
        <div class="form-msg"></div>
        <div class="preview-label">内容预览（先点「预览」）</div>
        <pre class="preview tall">—</pre>
        <div class="dim fs12"><b>待办 / 火花</b> = 速记（追加到工作台清单，可勾选、可撤销）；其余 = 新建笔记（Obsidian 立即可见，不满意可一键撤销）。客户档案建档后，记得让同步流程把它登记进「客户档案索引」。</div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-act="cancel">取消</button>
        <button class="btn ghost" data-act="dry">预览</button>
        <button class="btn primary" data-act="create" disabled>确认保存</button>
      </div>
    </div>`;

  const $in = (sel) => root.querySelector(sel);
  const isCapture = () => tpl.kind === 'capture';
  const setMsg = (text, cls) => { const m = $in('.form-msg'); m.textContent = text || ''; m.className = 'form-msg ' + (cls || ''); };

  function renderFields() {
    $in('.tpl-fields').innerHTML = `
      ${isCapture() ? `<label class="field"><span>内容</span><input class="input" id="fText" placeholder="${tpl.key === 'todo' ? '如：给 XX 客户回邮件确认交期' : '想到什么就先记下来…'}"></label>` : ''}
      ${tpl.key === 'knowledge' ? `<label class="field"><span>分区</span><select class="input" id="fFolder">${tpl.folders.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>` : ''}
      ${tpl.fields.includes('title') ? `<label class="field"><span>标题</span><input class="input" id="fTitle" placeholder="如：SUS310S 耐热钢管要点"></label>` : ''}
      ${tpl.fields.includes('ss') ? `<label class="field"><span>SS 编号</span><input class="input" id="fSs" placeholder="纯数字，如 01234"></label>` : ''}
      ${tpl.fields.includes('name') ? `<label class="field"><span>客户名称</span><input class="input" id="fName" placeholder="公司名（英文/拼音为主）"></label>` : ''}
      ${tpl.fields.includes('country') ? `<label class="field"><span>国别</span><input class="input" id="fCountry" placeholder="如 巴西"></label>` : ''}
    `;
    $in('.preview').textContent = '—';
    $in('[data-act="create"]').disabled = true;
    setMsg(tpl.desc || '');
  }

  function collect() {
    const g = (sel) => { const n = $in(sel); return n ? n.value : ''; };
    if (isCapture()) return { kind: tpl.key, text: g('#fText').trim() };
    const body = { template: tpl.key };
    if (tpl.key === 'knowledge') body.folder = g('#fFolder');
    if (tpl.fields.includes('title')) body.title = g('#fTitle').trim();
    if (tpl.fields.includes('ss')) body.ss = g('#fSs').trim();
    if (tpl.fields.includes('name')) body.name = g('#fName').trim();
    if (tpl.fields.includes('country')) body.country = g('#fCountry').trim();
    return body;
  }

  const close = () => root.remove();
  $in('.modal-x').onclick = close;
  $in('[data-act="cancel"]').onclick = close;
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  $in('.tpl-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chipbtn');
    if (!b) return;
    tpl = templates.find((t) => t.key === b.dataset.t);
    root.querySelectorAll('.chipbtn').forEach((x) => x.classList.toggle('active', x === b));
    renderFields();
  });

  $in('[data-act="dry"]').onclick = async () => {
    try {
      if (isCapture()) {
        const out = await api('POST', '/api/v3/captures', { ...collect(), dryRun: true });
        setMsg(`将追加到：${out.relPath}${out.fresh ? '（首次创建）' : `（${out.bytesBefore} → ${out.bytesAfter} 字节）`}`, 'ok');
        $in('.preview').textContent = out.line;
      } else {
        const out = await api('POST', '/api/v3/notes', { ...collect(), dryRun: true });
        setMsg(`将创建：${out.relPath}（${out.bytes} 字节）`, 'ok');
        $in('.preview').textContent = out.content;
      }
      $in('[data-act="create"]').disabled = false;
    } catch (e) { setMsg(e.message, 'err'); }
  };

  $in('[data-act="create"]').onclick = async () => {
    try {
      if (isCapture()) {
        const out = await api('POST', '/api/v3/captures', collect());
        close();
        toast(`已加入${tpl.label}（${out.relPath.split('/').pop()}）`, {
          action: { label: '撤销', onClick: () => undoCreate(out.backupId, ctx, true) },
        });
        ctx.refresh();
      } else {
        const out = await api('POST', '/api/v3/notes', collect());
        close();
        toast(`已创建 ${out.relPath}`, {
          action: { label: '撤销（移入 .trash）', onClick: () => undoCreate(out.backupId, ctx) },
        });
        location.hash = '#/notes/' + encodeURIComponent(out.relPath);
        ctx.refresh();
      }
    } catch (e) { setMsg(e.message, 'err'); }
  };

  $('#modalRoot').appendChild(root);
  renderFields();
}

async function undoCreate(backupId, ctx, isCapture = false) {
  const ok = await modal({
    title: isCapture ? '撤销这次速记？' : '撤销这次新建？',
    body: isCapture
      ? `<div>将把清单恢复到追加前的状态（Obsidian 里会立即同步）。</div>`
      : `<div>将把这篇笔记移入库内 <code>.trash</code>（可在 Obsidian 里找回，并非删除）。</div>`,
    confirmLabel: isCapture ? '恢复' : '移入 .trash',
  });
  if (!ok) return;
  try {
    const r = await api('POST', '/api/v3/backup/restore', { id: backupId });
    toast(r.action === 'trashed' ? `已移入 .trash：${r.trashName}` : '已撤销', { kind: 'ok' });
    if (location.hash.startsWith('#/notes/')) location.hash = '#/knowledge';
    ctx.refresh();
  } catch (e) { toast('撤销失败：' + e.message, { kind: 'err' }); }
}
