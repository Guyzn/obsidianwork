'use strict';
/*
 * ObsidianWork · 库索引层（机械盘友好）
 *
 * 设计要点（实测依据：库盘为机械盘，随机读 5.1ms/次，77 篇全量顺序读 208ms）：
 *   · 启动做一次全量顺序读，把每篇的「元数据 + 全文」常驻内存（当前 ~0.7MB）
 *   · 之后所有查询（列表/搜索/阅读）零读盘
 *   · 文件变化由 watcher 上报，只重读变化的那一篇（增量）
 *   · 全文缓存设上限（默认 64MB），超限后退化为「元数据常驻 + 阅读时读取」
 *
 * 本层只读库文件，不做任何写入（写入统一走 writers 层，P2 引入）。
 */
const fs = require('fs');
const path = require('path');

const MAX_FULLTEXT_BYTES = 64 * 1024 * 1024;
const IGNORE_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

/* ---------- 基础工具 ---------- */
function localYMD(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
function todayYMD() { return localYMD(new Date()); }
function daysBetween(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}
const stripEmoji = (s) => String(s || '')
  .replace(/[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2B00}-\u{2BFF}]|\uFE0F|\u200D/gu, '')
  .trim();
const prettifyFile = (file) => file.replace(/^ss\d+[_-]/i, '').replace(/[_-]+/g, ' ').trim() || file;

/* ---------- 客户状态标记（沿用 m-deck v2 已验证口径） ---------- */
const FLAG_DEFS = [
  { key: 'todo',     label: '待办', test: (s) => s.includes('⏰') },
  { key: 'hot',      label: '火线', test: (s) => s.includes('🔥') },
  { key: 'risk',     label: '风险', test: (s) => s.includes('高风险') || s.includes('⚠️') || s.includes('⚠') },
  { key: 'changing', label: '变更', test: (s) => s.includes('🔄') },
  { key: 'paused',   label: '挂起', test: (s) => s.includes('⏸') },
  { key: 'parked',   label: '冷藏', test: (s) => s.includes('❄') },
  { key: 'done',     label: '闭环', test: (s) => {
      const t = s.replace(/^✅\s*/, '');
      return /^(已完结|已闭环)/.test(s) || (/^✅/.test(s) && /完结|闭环|结案/.test(t.slice(0, 30)));
    } },
  { key: 'idle',     label: '建档', test: (s) => /早期建档/.test(s) },
];
function flagsOf(status) {
  const s = String(status || '');
  return FLAG_DEFS.filter((f) => f.test(s)).map((f) => ({ key: f.key, label: f.label }));
}

/* ---------- 最近活动日期（只取 <= 今天） ---------- */
function lastActivity(text) {
  const today = todayYMD();
  let best = null;
  const push = (y, m, d) => {
    y = +y; m = +m; d = +d;
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (y < 2000 || ymd > today) return;
    if (!best || ymd > best) best = ymd;
  };
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) push(m[1], m[2], m[3]);
  for (const m of text.matchAll(/(\d{4})\.(\d{1,2})\.(\d{1,2})/g)) push(m[1], m[2], m[3]);
  return best;
}

/* ---------- 笔记元数据解析（标题 / 大纲 / 双链 / 时间线条目） ---------- */
function parseNoteMeta(text) {
  const lines = text.split('\n');
  let title = '';
  const headings = [];
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^(#{1,4})\s+(.+)/);
    if (!h) continue;
    const level = h[1].length;
    const text2 = h[2].replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (level === 1 && !title) title = text2;
    if (level >= 2 && level <= 3) headings.push({ level, text: text2 });
  }
  const links = [];
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t && !links.includes(t)) links.push(t);
  }
  // 时间线条目：行首 26 字符内出现日期即视为事件（覆盖「- 2026-10-08：…」与「- **状态（2026-10-08 更新）**：…」两种写法）
  const timeline = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.{0,26}?)(\d{4}-\d{2}-\d{2})/);
    if (m && !/交期|有效期/.test(m[1])) timeline.push({ date: m[2], text: line.replace(/^[-*]\s+/, '').slice(0, 300) });
  }
  return { title: title || '', headings, links, timeline };
}

/* =========================================================================
 * Vault：库索引
 * ========================================================================= */
class Vault {
  constructor(vaultPath, opts = {}) {
    this.root = vaultPath;
    this.indexFile = opts.indexFile || '客户档案索引.md';
    this.clientsDir = opts.clientsDir || 'Clients';
    this.notes = new Map();      // relPath -> { relPath, mtimeMs, size, text|null, title, headings, links, timeline, folder }
    this.fullTextBytes = 0;
    this.clients = [];
    this.indexAuthority = null;
    this.decisions = { items: [], total: 0, openCount: 0, freshCount: 0 };
    this.healthy = false;
    this.error = null;
    this.scanMs = 0;
    this.lastScanAt = null;
  }

  /* ---- 全量扫描（启动一次；顺序读，机械盘友好） ---- */
  scanAll() {
    const t0 = Date.now();
    this.notes.clear();
    this.fullTextBytes = 0;
    try {
      this._walk(this.root, '');
      this._rebuildClients();
      this.healthy = true;
      this.error = null;
    } catch (e) {
      this.healthy = false;
      this.error = String(e && e.message || e);
    }
    this.scanMs = Date.now() - t0;
    this.lastScanAt = new Date().toISOString();
    return this.scanMs;
  }

  _walk(absDir, relDir) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { if (relDir === '') throw e; return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        this._walk(path.join(absDir, ent.name), relDir ? `${relDir}/${ent.name}` : ent.name);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
        const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
        this._loadNote(rel);
      }
    }
  }

  _loadNote(relPath) {
    const abs = path.join(this.root, relPath);
    let stat, text = null;
    try {
      stat = fs.statSync(abs);
      if (this.fullTextBytes < MAX_FULLTEXT_BYTES && stat.size < 2 * 1024 * 1024) {
        text = fs.readFileSync(abs, 'utf8');
        this.fullTextBytes += Buffer.byteLength(text);
      }
    } catch (e) { return null; }
    const prev = this.notes.get(relPath);
    if (prev && prev.text) this.fullTextBytes -= Buffer.byteLength(prev.text);
    const meta = parseNoteMeta(text || '');
    const note = {
      relPath,
      absPath: abs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      text,
      title: meta.title || relPath.replace(/\.md$/, '').split('/').pop(),
      headings: meta.headings,
      links: meta.links,
      timeline: meta.timeline,
      folder: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '',
    };
    this.notes.set(relPath, note);
    return note;
  }

  /* ---- 增量：watcher 上报的批次 ---- */
  handleChanges(paths) {
    const t0 = Date.now();
    let reloaded = 0, removed = 0, indexTouched = false;
    for (const rel of paths) {
      if (!rel || rel.startsWith('.obsidian/') || rel.includes('/.obsidian/')) continue;
      if (rel.startsWith('.')) continue;
      const norm = rel.split(path.sep).join('/');
      if (!norm.toLowerCase().endsWith('.md')) continue;
      const abs = path.join(this.root, norm);
      if (!fs.existsSync(abs)) {
        if (this.notes.delete(norm)) removed++;
        continue;
      }
      this._loadNote(norm);
      reloaded++;
      if (norm === this.indexFile || norm.endsWith('/' + this.indexFile)) indexTouched = true;
    }
    this._rebuildClients();
    this.healthy = true;
    return { reloaded, removed, indexTouched, ms: Date.now() - t0, at: new Date().toISOString() };
  }

  /* ---- 客户视图：索引表为准 + 档案正文补最近活动 ---- */
  _rebuildClients() {
    const indexNote = this._findNote(this.indexFile);
    const indexText = indexNote ? (indexNote.text || '') : '';
    const clients = this._parseIndex(indexText);
    this.indexAuthority = (indexText.match(/状态权威[：:]\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    const clientsPrefix = this.clientsDir + '/';
    for (const c of clients) {
      const file = c.file.toLowerCase().endsWith('.md') ? c.file : c.file + '.md';
      const note = this.notes.get(clientsPrefix + file) || this.notes.get(file);
      if (note) {
        c.lastDate = lastActivity(note.text || '') || null;
        c.days = c.lastDate ? daysBetween(c.lastDate) : null;
        c.sections = note.headings.map((h) => h.text);
        c.bytes = note.size;
        c.mtime = new Date(note.mtimeMs).toISOString();
        c.exists = true;
      } else {
        c.lastDate = null; c.days = null; c.sections = []; c.exists = false;
      }
    }
    this.clients = clients;
    this.decisions = this._parseDecisions(indexText);
  }

  _findNote(nameLike) {
    if (this.notes.has(nameLike)) return this.notes.get(nameLike);
    for (const [rel, n] of this.notes) {
      if (rel === nameLike || rel.endsWith('/' + nameLike)) return n;
    }
    return null;
  }

  _parseIndex(text) {
    const clients = [];
    let section = '';
    const TABLE_SECTIONS = /(活跃客户|特殊编号|暂无 SS 编号)/;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const h = line.match(/^#{2,4}\s+(.+)/);
      if (h) { section = h[1]; continue; }
      if (!TABLE_SECTIONS.test(section)) continue;
      if (!line.startsWith('|') || !line.includes('[[')) continue;
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
      if (cells.length < 2) continue;
      const file = (cells[0].match(/\[\[([^\]]+)\]\]/) || [])[1];
      if (!file) continue;
      const ss = (file.match(/^(ss\d+)/i) || [])[1];
      const noSsSection = /暂无 SS 编号/.test(section);
      let name = '', country = '', status = '';
      if (noSsSection) {
        name = prettifyFile(file);
        status = (cells[1] || '').trim();
      } else {
        const nameRaw = cells[1] || '';
        const [left, right] = nameRaw.split('·');
        name = stripEmoji(left || '').trim() || file;
        country = stripEmoji((right || '').split('·')[0] || '').trim();
        status = cells.slice(2).join(' ') || '';
      }
      clients.push({
        file,
        ss: ss ? ss.toUpperCase() : '',
        name, country,
        status: status.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim(),
        flags: flagsOf(status),
        special: /特殊编号/.test(section),
        section,
      });
    }
    return clients;
  }

  _parseDecisions(text) {
    const out = {
      items: [], open: [], closed: [],
      total: 0, openCount: 0, freshCount: 0,
      footer: '', sectionTitle: '',
      history: [], historyTitle: '',
      relPath: this.indexFile,
    };
    const tidy = (s) => String(s || '')
      .replace(/~~([^~]*)~~/g, '$1')
      .replace(/\*\*/g, '').replace(/`/g, '')
      .replace(/\s+/g, ' ').trim();

    // ---- 待 Guy 裁决 表（全量：开启 + 已结案） ----
    const hm = text.match(/(?:^|\n)(#{2,4}[^\n]*待\s*Guy\s*裁决[^\n]*)/);
    if (hm) {
      out.sectionTitle = tidy(hm[1].replace(/^#+\s*/, ''));
      let body = text.slice(text.indexOf(hm[1]) + hm[1].length);
      const nextSec = body.search(/\n## /);
      if (nextSec >= 0) body = body.slice(0, nextSec);
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('>')) { if (!out.footer) out.footer = tidy(line.replace(/^>\s*/, '')); continue; }
        const m = line.match(/^\|\s*(\d+)\s*\|/);
        if (!m) continue;
        const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
        if (cells.length < 3) continue;
        const num = +cells[0];
        if (!Number.isFinite(num)) continue;
        const itemRaw = cells[1] || '';
        const open = !/^✅/.test(itemRaw);
        const fresh = /🆕/.test(itemRaw);
        let title = tidy(itemRaw)
          .replace(/🆕|✅|⚠️|⚠/g, '')
          .replace(/（20\d{2}[^）]*）/g, '')
          .replace(/（[^）]{20,}）/g, '（…）')
          .trim();
        if (title.length > 64) title = title.slice(0, 64) + '…';
        out.items.push({
          n: num, title, open, fresh,
          dispute: tidy(cells[2] || ''),
          handling: tidy(cells[3] || ''),
          raw: line,
        });
      }
    }
    out.open = out.items.filter((i) => i.open);
    out.closed = out.items.filter((i) => !i.open);
    out.total = out.items.length;
    out.openCount = out.open.length;
    out.freshCount = out.open.filter((i) => i.fresh).length;

    // ---- 其他确认（历史裁决记录） ----
    const h = text.match(/##\s*其他确认[^\n]*/);
    if (h) {
      out.historyTitle = tidy(h[0].replace(/^#+\s*/, ''));
      const body = text.slice(text.indexOf(h[0]) + h[0].length);
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('## ')) break;
        const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
        if (!m) continue;
        if (/^-{2,}$/.test(m[1]) || /^-{2,}$/.test(m[2])) continue;
        if (m[1] === '事项') continue;
        out.history.push({ what: tidy(m[1]), conclusion: tidy(m[2]) });
      }
    }
    return out;
  }

  /* ---- 对外查询 ---- */
  counts() {
    const c = this.clients;
    return {
      total: c.length,
      todo: c.filter((x) => x.flags.some((f) => f.key === 'todo')).length,
      hot: c.filter((x) => x.flags.some((f) => f.key === 'hot')).length,
      paused: c.filter((x) => x.flags.some((f) => f.key === 'paused')).length,
      risk: c.filter((x) => x.flags.some((f) => f.key === 'risk')).length,
    };
  }

  summary() {
    return {
      generatedAt: new Date().toISOString(),
      vault: { root: this.root, healthy: this.healthy, error: this.error },
      notes: { count: this.notes.size, fullTextBytes: this.fullTextBytes },
      clients: this.counts(),
      decisions: { openCount: this.decisions.openCount, freshCount: this.decisions.freshCount, total: this.decisions.total },
      indexAuthority: this.indexAuthority,
      scanMs: this.scanMs,
      lastScanAt: this.lastScanAt,
    };
  }

  clientDetail(ss) {
    const key = String(ss || '').toUpperCase();
    const c = this.clients.find((x) => x.ss === key || x.file === ss);
    if (!c) return null;
    const file = c.file.toLowerCase().endsWith('.md') ? c.file : c.file + '.md';
    const note = this.notes.get(this.clientsDir + '/' + file) || this.notes.get(file);
    const base = c.file.replace(/\.md$/, '');
    const backlinks = [];
    for (const [rel, n] of this.notes) {
      if (n.links.some((l) => l === base || l === file || l.endsWith('/' + base))) {
        backlinks.push({ relPath: rel, title: n.title });
      }
    }
    return {
      client: c,
      relPath: note ? note.relPath : null,
      timeline: note ? note.timeline.slice().reverse().slice(0, 60) : [],
      headings: note ? note.headings : [],
      backlinks,
    };
  }

  knowledgeTree() {
    const SECTIONS = ['产品知识', '业务流程', '客户沟通', '行业参考', '风控案例'];
    const byFolder = new Map();
    const root = [];
    for (const [rel, n] of this.notes) {
      const folder = n.folder || '';
      const item = { relPath: rel, title: n.title, size: n.size, mtimeMs: n.mtimeMs };
      if (!folder) { root.push(item); continue; }
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(item);
    }
    const byTitle = (a, b) => a.title.localeCompare(b.title, 'zh');
    const sections = SECTIONS
      .filter((f) => byFolder.has(f))
      .map((f) => ({ folder: f, notes: byFolder.get(f).slice().sort(byTitle) }));
    const others = [...byFolder.keys()]
      .filter((f) => !SECTIONS.includes(f) && f !== this.clientsDir)
      .sort((a, b) => a.localeCompare(b, 'zh'))
      .map((f) => ({ folder: f, notes: byFolder.get(f).slice().sort(byTitle) }));
    return {
      sections,
      others,
      root: root.sort(byTitle),
      clientsCount: (byFolder.get(this.clientsDir) || []).length,
      total: this.notes.size,
    };
  }

  /* ---- 速记清单（工作台/待办.md、工作台/火花.md） ---- */
  captures() {
    const read = (rel) => {
      const n = this.notes.get(rel);
      if (n && n.text != null) return n.text;
      const abs = path.join(this.root, rel);
      try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
    };
    const todo = { relPath: '工作台/待办.md', exists: false, items: [] };
    const spark = { relPath: '工作台/火花.md', exists: false, items: [] };

    const t = read(todo.relPath);
    if (t != null) {
      todo.exists = true;
      for (const raw of t.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^- \[([ xX])\]\s*(?:(\d{4}-\d{2}-\d{2})\s+)?(.+)$/);
        if (m) todo.items.push({ raw: line, done: m[1].toLowerCase() === 'x', date: m[2] || null, text: m[3].trim() });
      }
    }
    const s = read(spark.relPath);
    if (s != null) {
      spark.exists = true;
      for (const raw of s.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^-\s*(?:(\d{4}-\d{2}-\d{2})[：:]\s*)?(.+)$/);
        if (m && m[2] && !/^\[[ xX]\]/.test(m[2])) spark.items.push({ raw: line, date: m[1] || null, text: m[2].trim() });
      }
    }
    return {
      todo, spark,
      counts: {
        todoPending: todo.items.filter((i) => !i.done).length,
        todoDone: todo.items.filter((i) => i.done).length,
        spark: spark.items.length,
      },
    };
  }

  /* ---- 链接解析表：供阅读器把 [[目标]] 解析成库内路径 ---- */
  linkmap() {
    const paths = [];
    const bases = {};
    for (const [rel] of this.notes) {
      const noExt = rel.replace(/\.md$/i, '');
      const base = noExt.split('/').pop();
      paths.push(noExt);
      if (!(base in bases)) bases[base] = noExt;
    }
    return { paths, bases };
  }

  /* ---- 断链清单：逻辑与既有同步脚本一致（basename 或 relpath 均算命中） ---- */
  brokenLinks() {
    const names = new Set();
    for (const [rel] of this.notes) {
      names.add(rel.split('/').pop().replace(/\.md$/i, ''));
      names.add(rel.replace(/\.md$/i, ''));
    }
    const broken = [];
    const seen = new Set();
    for (const [rel, n] of this.notes) {
      const text = n.text != null ? n.text : '';
      if (!text) continue;
      for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
        const t = m[1].trim();
        if (!t || names.has(t)) continue;
        const key = rel + '\u0000' + t;
        if (seen.has(key)) continue;
        seen.add(key);
        broken.push({ from: rel, title: n.title, target: t });
      }
    }
    return broken;
  }

  note(relPath) {
    const norm = String(relPath || '').split(path.sep).join('/');
    const n = this.notes.get(norm);
    if (!n) return null;
    let text = n.text;
    if (text == null) { try { text = fs.readFileSync(n.absPath, 'utf8'); } catch (e) { text = ''; } }
    const base = norm.replace(/\.md$/, '');
    const backlinks = [];
    for (const [rel, o] of this.notes) {
      if (rel === norm) continue;
      if (o.links.some((l) => l === base || l === norm || l === base.split('/').pop())) {
        backlinks.push({ relPath: rel, title: o.title });
      }
    }
    return { relPath: norm, title: n.title, headings: n.headings, links: n.links, backlinks, size: n.size, mtime: new Date(n.mtimeMs).toISOString(), text };
  }

  search(q, limit = 30) {
    const query = String(q || '').trim();
    if (query.length < 1) return [];
    const ql = query.toLowerCase();
    const results = [];
    for (const [rel, n] of this.notes) {
      const text = n.text != null ? n.text : '';
      const inTitle = (n.title || '').toLowerCase().includes(ql);
      const inPath = rel.toLowerCase().includes(ql);
      let hits = 0, snippet = '';
      if (text) {
        const tl = text.toLowerCase();
        let idx = 0;
        while (hits < 20) {
          const p = tl.indexOf(ql, idx);
          if (p < 0) break;
          hits++;
          if (!snippet) {
            const start = Math.max(0, p - 40);
            snippet = text.slice(start, p + query.length + 60).replace(/\n/g, ' ');
          }
          idx = p + ql.length;
        }
      }
      if (!inTitle && !inPath && hits === 0) continue;
      const score = (inTitle ? 100 : 0) + (inPath ? 30 : 0) + Math.min(hits, 10) * 8;
      results.push({ relPath: rel, title: n.title, folder: n.folder, hits, snippet, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

module.exports = { Vault, FLAG_DEFS, flagsOf, lastActivity, parseNoteMeta, localYMD, daysBetween };
