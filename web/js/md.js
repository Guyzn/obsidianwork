/* ObsidianWork · Markdown 渲染（包裹 vendor/marked，v12.0.2 固定版本）
 * 职责：
 *   · [[双链]] → 可点击链接（命中库内笔记则给出 #/notes/… 路径，未命中标记断链）
 *   · 原始 HTML 一律转义（笔记只应写 markdown）
 *   · 渲染后为标题补锚点（供大纲跳转；DOM 后处理，与渲染器版本解耦）
 *   · linkmap 缓存（60s），供阅读器解析出链/反链
 */
import { api, esc } from './util.js';

let LM = null;
let LMAt = 0;

export async function ensureLinkmap(force = false) {
  if (!LM || force || Date.now() - LMAt > 60000) {
    LM = await api('GET', '/api/v3/linkmap');
    LM._pathsLower = new Map(LM.paths.map((p) => [p.toLowerCase(), p]));
    LM._basesLower = {};
    for (const [k, v] of Object.entries(LM.bases)) LM._basesLower[k.toLowerCase()] = v;
    LMAt = Date.now();
  }
  return LM;
}

/** 把 [[目标]] 解析成库内路径（无 .md 后缀）；未命中返回 null */
export function resolveTarget(target) {
  if (!LM) return null;
  const t = String(target || '').replace(/\.md$/i, '').trim();
  if (!t) return null;
  if (LM.paths.includes(t)) return t;
  const hit = LM._pathsLower.get(t.toLowerCase());
  if (hit) return hit;
  const base = t.split('/').pop();
  const hitBase = LM._basesLower[base.toLowerCase()];
  return hitBase || null;
}

/* ---------- marked 配置 ---------- */
function setup() {
  if (!window.marked) {
    console.error('marked 未加载（vendor/marked.min.js）');
    return;
  }
  window.marked.use({
    gfm: true,
    breaks: false,
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), text: (m[2] || m[1]).trim() };
      },
      renderer(token) {
        const rel = resolveTarget(token.target);
        if (rel) {
          return `<a class="wikilink" href="#/notes/${encodeURIComponent(rel + '.md')}" data-target="${esc(token.target)}">${esc(token.text)}</a>`;
        }
        return `<a class="wikilink broken" href="#" data-target="${esc(token.target)}" title="断链：库中未找到 [[${esc(token.target)}]]">${esc(token.text)}</a>`;
      },
    }],
    renderer: {
      html(text) { return esc(text); },
    },
  });
}
setup();

/* ---------- 渲染 ---------- */
export function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/^-+|-+$/g, '') || 'h';
}

/**
 * 渲染 markdown 文本 → { html, headings: [{level, text, id}] }
 * 标题锚点在渲染结果上后处理生成（保证大纲与正文 id 完全一致）。
 */
export function renderMD(text) {
  const html = window.marked.parse(String(text || ''));
  const box = document.createElement('div');
  box.innerHTML = html;
  const headings = [];
  const used = {};
  box.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const base = slugify(h.textContent);
    let id = base;
    if (used[base]) { used[base]++; id = `${base}-${used[base]}`; } else { used[base] = 1; }
    h.id = id;
    headings.push({ level: +h.tagName.slice(1), text: h.textContent.trim(), id });
  });
  return { html: box.innerHTML, headings };
}
