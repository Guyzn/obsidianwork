/* ObsidianWork · 前端工具层（无依赖） */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
));

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}
export function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}
export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
export function daysLabel(days) {
  if (days == null) return '—';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return days + ' 天前';
}
export function daysClass(days) {
  if (days == null) return 'dim';
  if (days >= 14) return 'red';
  if (days >= 7) return 'amber';
  return '';
}

export function debounce(fn, ms = 250) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** 统一 API 调用：自动 JSON 化，失败抛 Error（message=服务端 error） */
export async function api(method, url, body) {
  const opt = { method };
  if (body !== undefined) {
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  let j = null;
  try { j = await r.json(); } catch (e) { throw new Error(`HTTP ${r.status}`); }
  if (!j || j.ok !== true) throw new Error((j && j.error) || `HTTP ${r.status}`);
  return j.data;
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
    return ok;
  }
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

export const CLIENT_FLAG_ORDER = ['todo', 'hot', 'risk', 'changing', 'paused', 'parked', 'done', 'idle'];
export function flagChips(flags = []) {
  return flags.map((f) => `<span class="chip ${f.key}">${esc(f.label)}</span>`).join('');
}
