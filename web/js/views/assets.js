/* 资料中心 · 只读浏览（outputs / customers / 技能工具箱） */
import { $, esc, api, fmtDT, fmtBytes, copyText } from '../util.js';
import { toast, flashSync } from '../app.js';

const EXT_ICON = {
  docx: '📄', doc: '📄', xlsx: '📊', xls: '📊', csv: '📊',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼',
  txt: '📝', md: '📝', py: '🐍', pdf: '📕', zip: '🗜', json: '🧾', html: '🌐',
};
const icon = (name) => EXT_ICON[String(name).split('.').pop().toLowerCase()] || '📎';

async function openPath(rel, reveal) {
  try {
    await api('GET', `/api/v3/open?app=system&root=workspace&path=${encodeURIComponent(rel)}${reveal ? '&reveal=1' : ''}`);
    flashSync(reveal ? '已在 Finder 定位' : '已用系统程序打开', 'self');
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

export const assets = {
  id: 'assets',
  title: '资料',
  sub: '只读浏览 · 文件不搬动 · 全部用系统程序打开',
  async render(el, params, ctx) {
    const d = await api('GET', '/api/v3/assets');
    const toolOk = d.toolbox.filter((t) => t.available).length;

    el.innerHTML = `
      <div class="toolbar">
        <div class="dim fs12">交付物 ${d.outputs.total} 份 · 客户文件区 ${d.customers.folders.length} 个目录 · 技能 ${toolOk}/${d.toolbox.length} 可用</div>
        <div class="toolbar-right">
          <button class="btn ghost" id="btnOpenOutputs">📂 打开 outputs 目录</button>
        </div>
      </div>

      <div class="panel">
        <h2>📦 最近交付物 <small>outputs/ · 按时间倒序 · 只读</small></h2>
        <div class="asset-list">
          ${d.outputs.files.map((f) => `
            <div class="asset-row">
              <span class="asset-icon">${icon(f.name)}</span>
              <span class="asset-name" title="${esc(f.name)}">${esc(f.name)}</span>
              <span class="asset-size dim">${fmtBytes(f.size)}</span>
              <span class="asset-date dim">${fmtDT(f.mtimeMs)}</span>
              <button class="btn mini ghost" data-open="outputs/${esc(f.name)}">打开</button>
              <button class="btn mini ghost" data-reveal="outputs/${esc(f.name)}">Finder</button>
            </div>`).join('') || '<div class="dim list-pad">outputs/ 目录为空</div>'}
        </div>
      </div>

      <div class="panel">
        <h2>// 客户文件区 <small>customers/ · 只读 · 不搬进库</small></h2>
        <div class="list-pad">
          ${d.customers.folders.map((f) => `
            <div class="asset-row">
              <span class="asset-icon">▸</span>
              <span class="asset-name">${esc(f.name)}</span>
              <span class="asset-size dim">${f.files} 个文件</span>
              <span class="asset-date dim">${fmtDT(f.mtimeMs)}</span>
              <button class="btn mini ghost" data-folder="${esc(f.rel)}">Finder 打开</button>
            </div>`).join('')}
          ${d.customers.files.map((f) => `
            <div class="asset-row">
              <span class="asset-icon">${icon(f.name)}</span>
              <span class="asset-name">${esc(f.name)}</span>
              <span class="asset-size dim">${fmtBytes(f.size)}</span>
              <span class="asset-date dim">${fmtDT(f.mtimeMs)}</span>
              <button class="btn mini ghost" data-open="${esc(f.rel)}">打开</button>
            </div>`).join('')}
          ${(!d.customers.folders.length && !d.customers.files.length) ? '<div class="dim">暂无客户文件目录</div>' : ''}
        </div>
      </div>

      <div class="panel">
        <h2>🧰 技能工具箱 <small>点「复制触发语」，去对话里粘贴即可用</small></h2>
        <div class="list-pad">
          ${d.toolbox.length ? `<div class="tool-grid">
            ${d.toolbox.map((t) => `
              <div class="tool-card ${t.available ? '' : 'off'}">
                <div class="tool-title">${esc(t.title)}${t.available ? '' : '<span class="chip sm">未安装</span>'}</div>
                <div class="tool-desc dim">${esc(t.desc)}</div>
                <div class="tool-foot">
                  <button class="btn mini" data-trigger="${esc(t.trigger)}" ${t.available ? '' : 'disabled'}>复制「${esc(t.trigger)}」</button>
                </div>
              </div>`).join('')}
          </div>` : '<div class="dim">尚未配置技能清单——在 config.json 的 <code>toolbox</code> 字段里添加 {dir, title, desc, trigger} 条目即可。</div>'}
        </div>
      </div>`;

    $('#btnOpenOutputs').onclick = () => openPath('outputs', false);

    el.addEventListener('click', (e) => {
      const openB = e.target.closest('button[data-open]');
      if (openB) return openPath(openB.dataset.open, false);
      const revB = e.target.closest('button[data-reveal]');
      if (revB) return openPath(revB.dataset.reveal, true);
      const fdB = e.target.closest('button[data-folder]');
      if (fdB) return openPath(fdB.dataset.folder, false);
      const tgB = e.target.closest('button[data-trigger]');
      if (tgB) {
        copyText(tgB.dataset.trigger).then((ok) => toast(
          ok ? `已复制「${tgB.dataset.trigger}」——去对话里粘贴即可` : '复制失败',
          { kind: ok ? 'ok' : 'err' },
        ));
      }
    });
  },

  onEvent() { /* 资料区不跟随库变化自动刷新，避免打断浏览 */ },
};
