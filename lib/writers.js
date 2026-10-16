'use strict';
/*
 * ObsidianWork · 写入安全层（唯一被允许写库的模块）
 *
 * 红线（规划书 §3.4，2026-10-16 老板拍板）：
 *   · 只追加、可恢复   —— 任何写入前先做字节级备份；恢复 = 从备份字节级还原
 *   · 原子替换         —— 写临时文件 + fsync + rename，绝不半途留下写坏的文件
 *   · 不删旧值         —— 索引状态更新只做「追加标注」；跟进追加保证原文前缀字节不变
 *   · 金额/口径不自动化 —— 由调用层把关（本层只负责格式与安全）
 *
 * 两个写入操作：
 *   ① appendFollowup   追加跟进条目到客户档案（纯追加；同日已有跟进节则并入该节）
 *   ② appendIndexStatus 在客户档案索引的状态行追加更新标注（表内单行外科手术，改前逐字节核对）
 *
 * 安全机制：
 *   · 写前备份（backups/<ts>-<op>-<name>/file + meta.json），恢复前再备份一次当前状态（pre-restore）
 *   · 索引更新前后做前缀/后缀/行数自检，任何不一致直接拒绝写入
 *   · 备份轮转：保留最近 BACKUP_KEEP 份
 */
const fs = require('fs');
const path = require('path');

const MAX_FOLLOWUP_LEN = 2000;
const MAX_STATUS_LEN = 500;
const BACKUP_KEEP = 800;

/* ---------- 小工具 ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function tsId(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function todayYMD(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fail(msg, httpCode = 400) {
  const e = new Error(msg);
  e.httpCode = httpCode;
  throw e;
}
function slugKeep(s, maxLen = 24) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maxLen);
}
/* 备份目录名里的文件标识：中文名 slug 会为空，退回 'index'（索引）或 'note' */
function backupSlug(relPath) {
  const s = slugKeep(path.basename(relPath, '.md'), 30);
  if (s) return s;
  return /索引/.test(relPath) ? 'index' : 'note';
}
function normText(s, max, label) {
  const t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
  if (!t) fail(`${label}不能为空`);
  if (t.length > max) fail(`${label}过长（${t.length} 字 > 上限 ${max} 字）`);
  return t;
}
function normDate(s) {
  const t = String(s || '').trim();
  if (!t) return todayYMD();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) fail('日期格式须为 YYYY-MM-DD');
  const y = +t.slice(0, 4), m = +t.slice(5, 7), d = +t.slice(8, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) fail('日期无效');
  if (y < 2018 || y > new Date().getFullYear() + 1) fail('日期超出合理范围');
  return t;
}
const stripMd = (f) => String(f || '').replace(/\.md$/i, '');

/* =========================================================================
 * createWriters
 * 依赖注入：
 *   vault        —— 客户清单（vault.clients）与库根路径（vault.root）
 *   config       —— dataDir / indexFile / clientsDir
 *   markSelfWrite(rel)      —— 写入前调用，watcher 抑制回声事件
 *   onAfterWrite(rel, info) —— 写入成功后调用（刷新内存索引 + SSE 广播）
 * ========================================================================= */
function createWriters({ vault, config, markSelfWrite, onAfterWrite }) {
  const backupRoot = path.join(config.dataDir, 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });

  /* ---------- 备份 ---------- */
  function makeBackup(absPath, relPath, op, note) {
    const name = `${tsId()}-${slugKeep(op, 16) || 'op'}-${backupSlug(relPath)}`;
    let dir = path.join(backupRoot, name);
    let n = 2;
    while (fs.existsSync(dir)) { dir = path.join(backupRoot, `${name}-${n}`); n++; }
    fs.mkdirSync(dir, { recursive: true });
    const exists = fs.existsSync(absPath);
    if (exists) fs.copyFileSync(absPath, path.join(dir, 'file'));
    const info = {
      id: path.basename(dir),
      at: new Date().toISOString(),
      op,
      relPath,
      fileExisted: exists,
      bytesBefore: exists ? fs.statSync(absPath).size : 0,
      note: note ? String(note).slice(0, 300) : '',
      app: 'ObsidianWork',
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(info, null, 2), 'utf8');
    pruneBackups();
    return info;
  }

  function pruneBackups() {
    try {
      const names = fs.readdirSync(backupRoot).sort();
      if (names.length <= BACKUP_KEEP) return;
      for (const n of names.slice(0, names.length - BACKUP_KEEP)) {
        fs.rmSync(path.join(backupRoot, n), { recursive: true, force: true });
      }
    } catch (e) { /* 轮转失败不影响写入 */ }
  }

  /* ---------- 原子写（temp + fsync + rename） ---------- */
  function atomicWriteBytes(absPath, buf) {
    const dir = path.dirname(absPath);
    const tmp = path.join(dir, `.obsidianwork.tmp.${process.pid}.${Date.now()}.md`);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, buf, 0, buf.length, 0);
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    }
    try {
      fs.renameSync(tmp, absPath);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
      throw e;
    }
  }

  /* ---------- 路径解析（直读磁盘，不依赖内存索引新鲜度） ---------- */
  function resolveClient(ssOrFile) {
    const key = String(ssOrFile || '').toUpperCase();
    const raw = String(ssOrFile || '');
    const c = vault.clients.find((x) =>
      x.ss === key || x.file === raw || stripMd(x.file) === stripMd(raw));
    if (!c) fail('未找到该客户', 404);
    const base = stripMd(c.file);
    const candidates = [`${config.clientsDir}/${base}.md`, `${base}.md`];
    for (const rel of candidates) {
      const abs = path.join(vault.root, rel);
      if (fs.existsSync(abs)) return { client: c, relPath: rel, absPath: abs };
    }
    // 兜底：大小写不敏感扫描
    const dir = path.join(vault.root, config.clientsDir);
    if (fs.existsSync(dir)) {
      const want = `${base}.md`.toLowerCase();
      const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === want);
      if (hit) {
        const rel = `${config.clientsDir}/${hit}`;
        return { client: c, relPath: rel, absPath: path.join(vault.root, rel) };
      }
    }
    fail(`客户档案文件不存在：${base}.md`, 404);
  }

  function resolveIndex() {
    const rel = config.indexFile;
    const abs = path.join(vault.root, rel);
    if (fs.existsSync(abs)) return { relPath: rel, absPath: abs };
    // 兜底：按名字大小写不敏感找
    const want = rel.toLowerCase();
    try {
      const hit = fs.readdirSync(vault.root).find((f) => f.toLowerCase() === want);
      if (hit) return { relPath: hit, absPath: path.join(vault.root, hit) };
    } catch (e) { /* ignore */ }
    fail(`索引文件不存在：${rel}`, 404);
  }

  /* =======================================================================
   * ① 追加跟进（纯追加；同日已有「跟进（date · ObsidianWork）」节则并入）
   * ======================================================================= */
  function buildFollowup(absPath, date, text) {
    const raw = fs.readFileSync(absPath);
    const content = raw.toString('utf8');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const bulletHead = `- **${date}**：${lines[0]}`;
    const bullet = bulletHead + lines.slice(1).map((l) => `\n  ${l}`).join('');

    // 找最后一个 `## ` 节；若恰好是同日跟进节 → 直接并入，否则新建节
    const h2s = [...content.matchAll(/^## .*$/gm)];
    const lastH2 = h2s.length ? h2s[h2s.length - 1][0] : '';
    const sameDay = lastH2.startsWith(`## 跟进（${date} · ObsidianWork）`);

    let prefix = raw;
    if (prefix.length && prefix[prefix.length - 1] !== 0x0a) {
      prefix = Buffer.concat([prefix, Buffer.from('\n', 'utf8')]);
    }
    const addition = sameDay
      ? `${bullet}\n`
      : `\n## 跟进（${date} · ObsidianWork）\n${bullet}\n`;
    const buf = Buffer.concat([prefix, Buffer.from(addition, 'utf8')]);
    return {
      buf,
      mode: sameDay ? 'merge-section' : 'new-section',
      previewMarkdown: (sameDay ? '' : `## 跟进（${date} · ObsidianWork）\n`) + bullet,
    };
  }

  function prepareFollowup(ssOrFile, body) {
    const { client, relPath, absPath } = resolveClient(ssOrFile);
    const date = normDate(body && body.date);
    const text = normText(body && body.text, MAX_FOLLOWUP_LEN, '跟进内容');
    const built = buildFollowup(absPath, date, text);
    const bytesBefore = fs.statSync(absPath).size;
    return {
      client, relPath, absPath, date, text,
      buf: built.buf, mode: built.mode, previewMarkdown: built.previewMarkdown,
      bytesBefore, bytesAfter: built.buf.length,
    };
  }

  function dryRunFollowup(ssOrFile, body) {
    const p = prepareFollowup(ssOrFile, body);
    return {
      relPath: p.relPath, date: p.date, mode: p.mode,
      previewMarkdown: p.previewMarkdown,
      bytesBefore: p.bytesBefore, bytesAfter: p.bytesAfter,
      delta: p.bytesAfter - p.bytesBefore,
    };
  }

  function applyFollowup(ssOrFile, body) {
    const p = prepareFollowup(ssOrFile, body);
    const backup = makeBackup(p.absPath, p.relPath, 'followup', `追加跟进 ${p.date}`);
    try { markSelfWrite && markSelfWrite(p.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(p.absPath, p.buf);
    // 自检：新文件必须是「原文前缀 + 追加」的形式
    let verify = 'ok';
    try {
      const after = fs.readFileSync(p.absPath);
      if (!after.slice(0, p.bytesBefore).equals(fs.readFileSync(path.join(backupRoot, backup.id, 'file')))) verify = 'prefix-mismatch';
    } catch (e) { verify = 'verify-skipped'; }
    const info = { op: 'followup', backupId: backup.id, relPath: p.relPath };
    try { onAfterWrite && onAfterWrite(p.relPath, info); } catch (e) { /* ignore */ }
    return {
      relPath: p.relPath, date: p.date, mode: p.mode,
      previewMarkdown: p.previewMarkdown,
      bytesBefore: p.bytesBefore, bytesAfter: p.bytesAfter,
      backupId: backup.id, verify,
    };
  }

  /* =======================================================================
   * ② 索引状态行更新（只做追加标注；表内单行替换 + 逐字节自检）
   * ======================================================================= */
  function statusAppend(oldStatus, date, text) {
    const t = text.replace(/\|/g, '｜').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const old = String(oldStatus || '').trim();
    const piece = `**${date} 更新（ObsidianWork）**：${t}`;
    if (!old) return piece;
    return `${old}${/[；;、]\s*$/.test(old) ? '' : '；'}${piece}`;
  }

  function findIndexRow(lines, base) {
    const needles = [`[[${base}]]`, `[[${base}|`];
    const hits = [];
    let section = '';
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const h = t.match(/^#{2,4}\s+(.+)/);
      if (h) { section = h[1]; continue; }
      if (!t.startsWith('|')) continue;
      if (!needles.some((n) => t.includes(n))) continue;
      hits.push({ i, section });
    }
    return hits;
  }

  function prepareIndexStatus(ssOrFile, body) {
    const { client } = resolveClient(ssOrFile);
    const idx = resolveIndex();
    const rawBuf = fs.readFileSync(idx.absPath);
    const content = rawBuf.toString('utf8');
    if (content.includes('\r\n')) fail('索引文件为 CRLF 行尾（请先转 LF 或改用 Obsidian 手动更新）');
    const lines = content.split('\n');
    const base = stripMd(client.file);
    const hits = findIndexRow(lines, base);
    if (hits.length === 0) fail('索引中未找到该客户行', 404);
    if (hits.length > 1) fail(`索引中有 ${hits.length} 行匹配该客户，为避免误改请手动处理`);
    const { i, section } = hits[0];
    const rawLine = lines[i];
    const parts = rawLine.split('|');
    const fileIdx = parts.findIndex((p) => p.includes(`[[${base}`));
    if (fileIdx < 0) fail('索引行解析失败（未找到链接位）');
    const noSs = /暂无 SS 编号/.test(section);
    const statusStart = fileIdx + (noSs ? 1 : 2);

    const date = normDate(body && body.date);
    const text = normText(body && body.text, MAX_STATUS_LEN, '状态更新内容');

    let oldStatus = '';
    let newStatus = '';
    let newParts;
    let statusEnd = parts.length - 1;
    while (statusEnd > statusStart && parts[statusEnd].trim() === '') statusEnd--;
    if (statusEnd < statusStart) {
      // 没有状态段：直接插到定位位之后
      newStatus = statusAppend('', date, text);
      newParts = [...parts.slice(0, statusStart), ` ${newStatus} `, ...parts.slice(statusStart)];
    } else {
      oldStatus = parts.slice(statusStart, statusEnd + 1).join('|').trim();
      newStatus = statusAppend(oldStatus, date, text);
      newParts = [...parts.slice(0, statusStart), ` ${newStatus} `, ...parts.slice(statusEnd + 1)];
    }
    const newLine = newParts.join('|');

    /* —— 自检 —— */
    if (newLine === rawLine) fail('内部校验失败（行未变化）');
    if (!newLine.startsWith(parts.slice(0, statusStart).join('|'))) fail('内部校验失败（前缀不一致）');
    const oldSuffix = parts.slice(statusEnd + 1).join('|');
    const newSuffix = newParts.slice(statusEnd + 1).join('|');
    if (oldSuffix !== newSuffix) fail('内部校验失败（后缀不一致）');
    if (Buffer.byteLength(newLine) <= Buffer.byteLength(rawLine)) fail('内部校验失败（新行未变长）');

    const newLines = lines.slice();
    newLines[i] = newLine;
    const newBuf = Buffer.from(newLines.join('\n'), 'utf8');
    if (newBuf.length !== rawBuf.length - Buffer.byteLength(rawLine) + Buffer.byteLength(newLine)) {
      fail('内部校验失败（字节数不符预期）');
    }
    return {
      client, relPath: idx.relPath, absPath: idx.absPath,
      lineNo: i + 1, rawLine, newLine,
      oldStatus, newStatus,
      piece: statusAppend('', date, text),
      buf: newBuf, bytesBefore: rawBuf.length, bytesAfter: newBuf.length,
    };
  }

  function dryRunIndexStatus(ssOrFile, body) {
    const p = prepareIndexStatus(ssOrFile, body);
    return {
      relPath: p.relPath, lineNo: p.lineNo,
      oldStatus: p.oldStatus, newStatus: p.newStatus, piece: p.piece,
      beforeLine: p.rawLine, afterLine: p.newLine,
      bytesBefore: p.bytesBefore, bytesAfter: p.bytesAfter,
      delta: p.bytesAfter - p.bytesBefore,
    };
  }

  function applyIndexStatus(ssOrFile, body) {
    const p = prepareIndexStatus(ssOrFile, body);
    const backup = makeBackup(p.absPath, p.relPath, 'index-status', `状态更新 #${p.lineNo} ${stripMd(p.client.file)}`);
    try { markSelfWrite && markSelfWrite(p.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(p.absPath, p.buf);
    const info = { op: 'index-status', backupId: backup.id, relPath: p.relPath };
    try { onAfterWrite && onAfterWrite(p.relPath, info); } catch (e) { /* ignore */ }
    return {
      relPath: p.relPath, lineNo: p.lineNo,
      oldStatus: p.oldStatus, newStatus: p.newStatus, piece: p.piece,
      beforeLine: p.rawLine, afterLine: p.newLine,
      bytesBefore: p.bytesBefore, bytesAfter: p.bytesAfter,
      backupId: backup.id,
    };
  }

  /* =======================================================================
   * ③ 新建笔记（三模板 + 导航双链头；撤销 = 移入 .trash，非删除）
   * ======================================================================= */
  const NOTE_TEMPLATES = {
    knowledge: {
      key: 'knowledge', label: '知识笔记',
      folders: ['产品知识', '业务流程', '客户沟通', '行业参考', '风控案例'],
      fields: ['folder', 'title'],
      build({ title, date }) {
        return [
          `# ${title}`, '',
          `> 相关：[[${config.noteLinks.hub}]] · 建档 ${date}（ObsidianWork 工作台）`, '',
          '---', '',
          '## 要点', '', '- ', '',
          '## 正文', '',
        ].join('\n');
      },
    },
    risk: {
      key: 'risk', label: '风控案例',
      folders: ['风控案例'],
      fields: ['title'],
      build({ title, date }) {
        return [
          `# ${title}`, '',
          `> 相关：[[${config.noteLinks.riskIndex}]] · [[${config.noteLinks.hub}]] · 建档 ${date}（ObsidianWork 工作台）`, '',
          '---', '',
          '## 类型', '', '', '## 手法链', '', '', '## 应对与结局', '', '', '## 教训', '',
        ].join('\n');
      },
    },
    client: {
      key: 'client', label: '客户档案',
      folders: ['Clients'],
      fields: ['ss', 'name', 'country'],
      build({ name, country, date, ss }) {
        return [
          `# SS${ss} — ${name}${country ? `（${country}）` : ''}`, '',
          '> 相关：' + `[[${config.noteLinks.clientsIndex}]] · [[${config.noteLinks.clientGuide}]] · [[${config.noteLinks.hub}]]`,
          `> 建档 ${date}（ObsidianWork 工作台）`, '',
          '---', '',
          '## 主体画像', '',
          '- 公司：', `- 国家/地区：${country || ''}`,
          '- 类型：（库存商 / 终端 / 中间商）', '- 联系人：', '- 联系方式：', '- 语言偏好：', '',
          '## 询盘与跟进', '',
          `- **${date}**：工作台建档（ObsidianWork）`, '',
          '## 备注', '',
        ].join('\n');
      },
    },
  };

  function noteFileName(tpl, body) {
    if (tpl.key === 'client') {
      const ssRaw = String(body.ss || '').trim().replace(/^ss/i, '').replace(/\D/g, '');
      if (!/^\d{3,6}$/.test(ssRaw)) fail('SS 编号需为 3-6 位数字（如 01234）');
      const name = String(body.name || '').trim();
      if (!name) fail('客户名称不能为空');
      const slug = name.toLowerCase()
        .replace(/[\s\u3000]+/g, '_')
        .replace(/[\/\\:*?"<>|#\[\]]/g, '')
        .replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      if (!slug) fail('客户名称无法生成文件名');
      return `ss${ssRaw}_${slug}.md`;
    }
    const title = String(body.title || '').trim();
    if (!title) fail('标题不能为空');
    if (title.length > 60) fail('标题过长（≤60 字）');
    if (/[\/\\:*?"<>|#\[\]]/.test(title)) fail('标题不能包含 / \\ : * ? " < > | # [ ] 字符');
    if (/^[.…\s]/.test(title) || /[.\s]$/.test(title)) fail('标题首尾不能是点或空格');
    return `${title}.md`;
  }

  function prepareCreateNote(body) {
    const key = String((body && body.template) || 'knowledge');
    const tpl = NOTE_TEMPLATES[key];
    if (!tpl) fail('未知模板');
    let folder = tpl.folders[0];
    if (tpl.key === 'knowledge') {
      folder = String(body.folder || '');
      if (!tpl.folders.includes(folder)) fail('请选择有效分区（' + tpl.folders.join(' / ') + '）');
    }
    const date = todayYMD();
    const file = noteFileName(tpl, body);
    const relPath = `${folder}/${file}`;
    const absPath = path.join(vault.root, relPath);
    const rootWithSep = vault.root.endsWith(path.sep) ? vault.root : vault.root + path.sep;
    if (!absPath.startsWith(rootWithSep)) fail('路径越界');
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fail(`目标目录不存在：${folder}/`, 404);
    if (fs.existsSync(absPath)) fail(`同名文件已存在：${relPath}（换个标题，或直接去 Obsidian 编辑）`, 409);
    const content = tpl.build({
      title: String(body.title || '').trim(),
      name: String(body.name || '').trim(),
      country: String(body.country || '').trim(),
      ss: String(body.ss || '').trim().replace(/^ss/i, '').replace(/\D/g, ''),
      date,
    });
    const buf = Buffer.from(content, 'utf8');
    return { tpl, relPath, absPath, content, buf, date };
  }

  function dryRunCreateNote(body) {
    const p = prepareCreateNote(body);
    return { relPath: p.relPath, template: p.tpl.key, content: p.content, bytes: p.buf.length, date: p.date };
  }

  function applyCreateNote(body) {
    const p = prepareCreateNote(body);
    const backup = makeBackup(p.absPath, p.relPath, 'note-create', `新建笔记（${p.tpl.label}）`);
    try { markSelfWrite && markSelfWrite(p.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(p.absPath, p.buf);
    const info = { op: 'note-create', backupId: backup.id, relPath: p.relPath };
    try { onAfterWrite && onAfterWrite(p.relPath, info); } catch (e) { /* ignore */ }
    return { relPath: p.relPath, template: p.tpl.key, content: p.content, bytes: p.buf.length, backupId: backup.id };
  }

  function templates() {
    const captures = [
      { key: 'todo', kind: 'capture', label: '待办', desc: '速记 · 追加到 工作台/待办.md（可勾选完成）', fields: ['text'] },
      { key: 'spark', kind: 'capture', label: '火花', desc: '速记 · 追加到 工作台/火花.md', fields: ['text'] },
    ];
    const notes = Object.values(NOTE_TEMPLATES).map((t) => ({
      key: t.key, kind: 'note', label: t.label, folders: t.folders, fields: t.fields,
    }));
    return [...captures, ...notes];
  }

  /* =======================================================================
   * ④ 速记（待办 / 火花）：追加到工作台清单（与新建笔记同一套安全层）
   * ======================================================================= */
  const CAPTURE_TARGETS = {
    todo: {
      kind: 'todo', label: '待办', relPath: '工作台/待办.md',
      header: [
        '# 待办', '',
        '> 工作台速记 · 追加式清单 · 在 Obsidian 里勾选，或在工作台「便签」页操作',
        `> 相关：[[${config.noteLinks.hub}]]`, '',
      ].join('\n'),
      build(date, text) { return `- [ ] ${date} ${text}`; },
    },
    spark: {
      kind: 'spark', label: '火花', relPath: '工作台/火花.md',
      header: [
        '# 火花', '',
        '> 工作台速记 · 灵感与线索 · 随时整理进知识库',
        `> 相关：[[${config.noteLinks.hub}]]`, '',
      ].join('\n'),
      build(date, text) { return `- ${date}：${text}`; },
    },
  };

  function prepareCapture(kind, body) {
    const t = CAPTURE_TARGETS[kind];
    if (!t) fail('未知速记类型（todo / spark）');
    const date = normDate(body && body.date);
    const text = normText(body && body.text, 600, '速记内容').replace(/\s+/g, ' ');
    const relPath = t.relPath;
    const absPath = path.join(vault.root, relPath);
    const rootWithSep = vault.root.endsWith(path.sep) ? vault.root : vault.root + path.sep;
    if (!absPath.startsWith(rootWithSep)) fail('路径越界');
    const line = t.build(date, text);
    let buf;
    let fresh;
    if (fs.existsSync(absPath)) {
      const raw = fs.readFileSync(absPath);
      let prefix = raw;
      if (prefix.length && prefix[prefix.length - 1] !== 0x0a) {
        prefix = Buffer.concat([prefix, Buffer.from('\n', 'utf8')]);
      }
      buf = Buffer.concat([prefix, Buffer.from(line + '\n', 'utf8')]);
      fresh = false;
    } else {
      buf = Buffer.from(t.header + '\n' + line + '\n', 'utf8');
      fresh = true;
    }
    return {
      t, relPath, absPath, date, text, line, buf, fresh,
      bytesBefore: fresh ? 0 : fs.statSync(absPath).size,
    };
  }

  function dryRunCapture(kind, body) {
    const p = prepareCapture(kind, body);
    return {
      relPath: p.relPath, kind: p.t.kind, line: p.line, fresh: p.fresh,
      bytesBefore: p.bytesBefore, bytesAfter: p.buf.length, delta: p.buf.length - p.bytesBefore,
    };
  }

  function applyCapture(kind, body) {
    const p = prepareCapture(kind, body);
    if (p.fresh) fs.mkdirSync(path.dirname(p.absPath), { recursive: true });
    const backup = makeBackup(p.absPath, p.relPath, `capture-${p.t.kind}`, `速记（${p.t.label}）`);
    try { markSelfWrite && markSelfWrite(p.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(p.absPath, p.buf);
    const info = { op: 'capture', backupId: backup.id, relPath: p.relPath };
    try { onAfterWrite && onAfterWrite(p.relPath, info); } catch (e) { /* ignore */ }
    return {
      relPath: p.relPath, kind: p.t.kind, line: p.line, fresh: p.fresh,
      bytesBefore: p.bytesBefore, bytesAfter: p.buf.length, backupId: backup.id,
    };
  }

  /* 勾选 / 取消勾选待办（单行手术：仅 [ ]↔[x]，长度与字节数不变） */
  function toggleCapture(body) {
    const raw = String((body && body.raw) || '').trim();
    if (!raw) fail('缺少条目内容');
    if (!/^- \[[ xX]\]/.test(raw)) fail('该条目不是待办格式');
    const t = CAPTURE_TARGETS.todo;
    const absPath = path.join(vault.root, t.relPath);
    if (!fs.existsSync(absPath)) fail('待办清单不存在', 404);
    const rawBuf = fs.readFileSync(absPath);
    const content = rawBuf.toString('utf8');
    if (content.includes('\r\n')) fail('清单为 CRLF 行尾，请在 Obsidian 中手动勾选');
    const lines = content.split('\n');
    const idxs = [];
    lines.forEach((l, i) => { if (l.trim() === raw) idxs.push(i); });
    if (!idxs.length) fail('未找到该条目（可能刚被编辑过，刷新再试）', 404);
    if (idxs.length > 1) fail('存在重复条目，为避免误改请在 Obsidian 中勾选', 409);
    const i = idxs[0];
    const oldLine = lines[i];
    const wasDone = /^- \[[xX]\]/.test(oldLine.trim());
    const newLine = wasDone
      ? oldLine.replace('- [x]', '- [ ]').replace('- [X]', '- [ ]')
      : oldLine.replace('- [ ]', '- [x]');
    if (newLine === oldLine) fail('内部校验失败（未变化）');
    if (newLine.length !== oldLine.length) fail('内部校验失败（长度变化）');
    const newLines = lines.slice();
    newLines[i] = newLine;
    const newBuf = Buffer.from(newLines.join('\n'), 'utf8');
    if (newBuf.length !== rawBuf.length) fail('内部校验失败（字节数变化）');
    const backup = makeBackup(absPath, t.relPath, 'capture-toggle', `${wasDone ? '取消勾选' : '勾选'}：${raw.slice(0, 60)}`);
    try { markSelfWrite && markSelfWrite(t.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(absPath, newBuf);
    const info = { op: 'capture-toggle', backupId: backup.id, relPath: t.relPath };
    try { onAfterWrite && onAfterWrite(t.relPath, info); } catch (e) { /* ignore */ }
    return { relPath: t.relPath, beforeLine: oldLine, afterLine: newLine, done: !wasDone, backupId: backup.id };
  }

  /* =======================================================================
   * 备份列表 / 恢复 / 活动详情
   * ======================================================================= */
  function listBackups({ relPath, limit = 100 } = {}) {
    const out = [];
    let names = [];
    try { names = fs.readdirSync(backupRoot); } catch (e) { return out; }
    for (const name of names) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(backupRoot, name, 'meta.json'), 'utf8'));
        if (relPath && meta.relPath !== relPath) continue;
        meta.hasFile = fs.existsSync(path.join(backupRoot, name, 'file'));
        out.push(meta);
      } catch (e) { /* 跳过不完整目录 */ }
    }
    out.sort((a, b) => (String(a.id) < String(b.id) ? 1 : -1));
    return out.slice(0, limit);
  }

  function getBackup(id) {
    const metaPath = path.join(backupRoot, id, 'meta.json');
    if (!fs.existsSync(metaPath)) fail('备份不存在', 404);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.hasFile = fs.existsSync(path.join(backupRoot, id, 'file'));
    return meta;
  }

  function restoreBackup(id) {
    if (!/^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/.test(String(id || ''))) fail('备份 ID 无效');
    const meta = getBackup(id);
    const src = path.join(backupRoot, id, 'file');
    // 目标必须在库内
    const rootWithSep = vault.root.endsWith(path.sep) ? vault.root : vault.root + path.sep;
    const targetAbs = path.join(vault.root, meta.relPath);
    if (!targetAbs.startsWith(rootWithSep)) fail('备份目标越界');
    if (!/\.md$/i.test(meta.relPath)) fail('拒绝恢复非 md 文件');

    // 撤销「新建笔记」：移入库内 .trash（可在 Obsidian 找回，非删除）
    if (!fs.existsSync(src) && meta.fileExisted === false) {
      if (!fs.existsSync(targetAbs)) {
        return { relPath: meta.relPath, restoredFrom: id, action: 'already-gone' };
      }
      const trashDir = path.join(vault.root, '.trash');
      fs.mkdirSync(trashDir, { recursive: true });
      const d = new Date();
      const stamp = `${todayYMD()} ${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
      let trashName = `${path.basename(meta.relPath, '.md')} ${stamp}.md`;
      let n = 2;
      while (fs.existsSync(path.join(trashDir, trashName))) {
        trashName = `${path.basename(meta.relPath, '.md')} ${stamp}-${n}.md`;
        n++;
      }
      try { markSelfWrite && markSelfWrite(meta.relPath); } catch (e) { /* ignore */ }
      fs.renameSync(targetAbs, path.join(trashDir, trashName));
      const info = { op: 'trash', backupId: id, relPath: meta.relPath };
      try { onAfterWrite && onAfterWrite(meta.relPath, info); } catch (e) { /* ignore */ }
      return { relPath: meta.relPath, restoredFrom: id, action: 'trashed', trashName, at: meta.at };
    }
    if (!fs.existsSync(src)) fail('该备份没有文件内容（可能是纯标记）', 409);
    // 恢复前先备份当前状态（pre-restore），误恢复还能再撤回
    let preBackupId = null;
    if (fs.existsSync(targetAbs)) {
      preBackupId = makeBackup(targetAbs, meta.relPath, 'pre-restore', `恢复 ${id} 前自动备份`).id;
    }
    const buf = fs.readFileSync(src);
    try { markSelfWrite && markSelfWrite(meta.relPath); } catch (e) { /* ignore */ }
    atomicWriteBytes(targetAbs, buf);
    const info = { op: 'restore', backupId: id, relPath: meta.relPath, preBackupId };
    try { onAfterWrite && onAfterWrite(meta.relPath, info); } catch (e) { /* ignore */ }
    return { relPath: meta.relPath, restoredFrom: id, preBackupId, bytes: buf.length, at: meta.at };
  }

  return {
    backupRoot,
    dryRunFollowup, applyFollowup,
    dryRunIndexStatus, applyIndexStatus,
    dryRunCreateNote, applyCreateNote, templates,
    dryRunCapture, applyCapture, toggleCapture,
    listBackups, getBackup, restoreBackup,
  };
}

module.exports = { createWriters, todayYMD };
