/* 笔记阅读器：markdown 渲染 · 双链可点 · 大纲/反链/出链 */
import { $, esc, api, fmtDT, fmtBytes, copyText } from '../util.js';
import { toast, flashSync } from '../app.js';
import { ensureLinkmap, resolveTarget, renderMD } from '../md.js';

async function openIn(app, relPath) {
  try {
    await api('GET', `/api/v3/open?app=${app}&path=${encodeURIComponent(relPath)}`);
    flashSync(app === 'obsidian' ? '已在 Obsidian 打开' : '已用系统程序打开', 'self');
  } catch (e) { toast(e.message, { kind: 'err' }); }
}

const FOLDER_LABEL = {
  '产品知识': '产品知识', '业务流程': '业务流程', '客户沟通': '客户沟通',
  '行业参考': '行业参考', '风控案例': '风控案例', 'Clients': '客户档案',
};

export const note = {
  id: 'note',
  title: '笔记',
  sub: (p) => p.path,
  async render(el, params, ctx) {
    const relPath = params.path;
    await ensureLinkmap();
    const n = await api('GET', '/api/v3/notes?path=' + encodeURIComponent(relPath));
    const { html, headings } = renderMD(n.text);

    const folder = relPath.includes('/') ? relPath.split('/')[0] : '';
    const backTo = folder === 'Clients' ? { href: '#/clients', label: '客户' } : { href: '#/knowledge', label: '知识库' };

    el.innerHTML = `
      <div class="detail-head reader-head">
        <a class="back" href="${backTo.href}">← ${backTo.label}</a>
        <div class="dhrow">
          <h2 class="dhname">${esc(n.title)}</h2>
          ${folder ? `<span class="chip sm">${esc(FOLDER_LABEL[folder] || folder)}</span>` : ''}
        </div>
        <div class="dhmeta dim fs12">
          <span class="mono">${esc(relPath)}</span> · ${fmtBytes(n.size)} · 更新 ${fmtDT(n.mtime)} · 反链 ${n.backlinks.length} · 出链 ${n.links.length}
        </div>
        <div class="dhbtns">
          <button class="btn" id="btnObsNote">在 Obsidian 打开</button>
          <button class="btn ghost" id="btnSysNote">默认程序打开</button>
          <button class="btn ghost" id="btnCopyPath">复制路径</button>
        </div>
      </div>
      <div class="grid2 reader-grid">
        <div class="panel md-panel"><div class="md-body" id="mdBody">${html}</div></div>
        <div class="col">
          <div class="panel"><h2>// 大纲 <small>${headings.filter((h) => h.level <= 3).length}</small></h2>
            <div class="outline" id="outline">
              ${headings.filter((h) => h.level <= 3).map((h) => `<a class="ol-item lv${h.level}" data-h="${esc(h.id)}" title="${esc(h.text)}">${esc(h.text)}</a>`).join('') || '<div class="dim list-pad">无标题层级</div>'}
            </div>
          </div>
          <div class="panel"><h2>// 反向链接 <small>${n.backlinks.length}</small></h2>
            <div class="list-pad">${n.backlinks.map((b) => `
              <a class="row-item slim" href="#/notes/${encodeURIComponent(b.relPath)}">
                <span class="ri-main"><span class="ri-name">${esc(b.title)}</span><span class="ri-sub">${esc(b.relPath)}</span></span>
              </a>`).join('') || '<div class="dim fs12">没有其他笔记引用本文</div>'}
            </div>
          </div>
          <div class="panel"><h2>↗ 出链 <small>${n.links.length}</small></h2>
            <div class="list-pad">${n.links.map((t) => {
              const rel = resolveTarget(t);
              return `<a class="row-item slim outlink ${rel ? '' : 'broken'}" data-target="${esc(t)}" href="${rel ? '#/notes/' + encodeURIComponent(rel + '.md') : '#'}">
                <span class="ri-main"><span class="ri-name">${esc(t)}</span></span>
                <span class="ri-days ${rel ? 'dim' : 'red'}">${rel ? '库内' : '断链'}</span>
              </a>`;
            }).join('') || '<div class="dim fs12">本文没有出链</div>'}
            </div>
          </div>
        </div>
      </div>`;

    /* 打开动作 */
    $('#btnObsNote').onclick = () => openIn('obsidian', relPath);
    $('#btnSysNote').onclick = () => openIn('system', relPath);
    $('#btnCopyPath').onclick = async () => {
      const ok = await copyText(relPath);
      toast(ok ? '路径已复制' : '复制失败', { kind: ok ? 'ok' : 'err' });
    };

    /* 正文里的双链点击（含断链提示） */
    $('#mdBody').addEventListener('click', (e) => {
      const a = e.target.closest('a.wikilink');
      if (!a) return;
      e.preventDefault();
      const rel = resolveTarget(a.dataset.target);
      if (rel) location.hash = '#/notes/' + encodeURIComponent(rel + '.md');
      else toast(`断链：库中未找到 [[${a.dataset.target}]]`, { kind: 'err' });
    });

    /* 出链里点断链也提示 */
    el.querySelectorAll('.outlink.broken').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        toast(`断链：库中未找到 [[${a.dataset.target}]]`, { kind: 'err' });
      });
    });

    /* 大纲跳转 */
    $('#outline').addEventListener('click', (e) => {
      const a = e.target.closest('.ol-item');
      if (!a) return;
      const h = document.getElementById(a.dataset.h);
      if (h) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        h.classList.add('flash-target');
        setTimeout(() => h.classList.remove('flash-target'), 1500);
      }
    });
  },

  onEvent(kind, d, ctx) {
    try {
      const cur = (location.hash || '').replace(/^#\/notes\//, '');
      if (cur && d.paths && d.paths.includes(decodeURIComponent(cur))) ctx.refreshSoon();
    } catch (e) { /* ignore */ }
  },
};
