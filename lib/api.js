'use strict';
/*
 * ObsidianWork · API 层
 *
 * 读取（P1）：summary / clients / decisions / knowledge / notes / search / open
 * 写入（P2，走 writers 安全层）：
 *   POST /api/v3/clients/:ss/followup   追加跟进（{date?, text, dryRun?}）
 *   POST /api/v3/index/status           索引状态行追加更新（{ss, date?, text, dryRun?}）
 *   POST /api/v3/backup/restore         从备份恢复（{id}）
 * 管理（P2）：GET /api/v3/backups、GET /api/v3/activity
 *
 * 约定：所有 JSON 响应 { ok: true, data } / { ok: false, error }
 * 写接口守卫：必须 application/json + 来源须为本机页面（防跨站）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { localYMD } = require('./vault');
const { listToolbox } = require('./toolbox');

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

function readBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > max) { req.destroy(); reject(new Error('请求体过大')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function createRouter({ vault, watcher, config, writers }) {
  /* ---------- SSE 中枢 ---------- */
  const sseClients = new Set();
  function sseBroadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch (e) { sseClients.delete(res); }
    }
  }
  setInterval(() => {
    const payload = `event: ping\ndata: ${JSON.stringify({ watch: watcher.status(), notes: vault.notes.size })}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch (e) { sseClients.delete(res); }
    }
  }, 25000).unref();

  /* ---------- 活动环形缓冲（总览实时动态 / 今日动态数） ---------- */
  const activity = [];
  const MAX_ACTIVITY = 160;
  function recordActivity(evt) {
    activity.push(evt);
    if (activity.length > MAX_ACTIVITY) activity.splice(0, activity.length - MAX_ACTIVITY);
  }

  /* ---------- 客户文件区（workspace customers/）清单，120s 缓存 ---------- */
  let wsCache = { at: 0, dirs: [] };
  function workspaceDirsFor(client) {
    if (!config.workspaceRoot) return [];
    const now = Date.now();
    if (now - wsCache.at > 120000) {
      wsCache = { at: now, dirs: [] };
      try {
        const root = path.join(config.workspaceRoot, 'customers');
        for (const name of fs.readdirSync(root)) {
          try {
            if (fs.statSync(path.join(root, name)).isDirectory()) wsCache.dirs.push(name);
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* 目录不存在则保持空 */ }
    }
    const tokens = [client.ss, stripMd(client.file)].filter(Boolean).map((s) => String(s).toUpperCase());
    const first = stripMd(client.file).split(/[_-]/)[0];
    if (first && first.length >= 4) tokens.push(first.toUpperCase());
    return wsCache.dirs
      .filter((d) => tokens.some((t) => d.toUpperCase().includes(t)))
      .map((d) => ({ name: d, rel: `customers/${d}` }));
  }
  const stripMd = (f) => String(f || '').replace(/\.md$/i, '');

  /* ---------- 资料区（只读浏览） ---------- */
  function listDir(absDir) {
    const out = { dir: absDir, files: [], total: 0 };
    try {
      for (const name of fs.readdirSync(absDir)) {
        if (name.startsWith('.')) continue;
        try {
          const st = fs.statSync(path.join(absDir, name));
          out.files.push({ name, size: st.size, mtimeMs: st.mtimeMs, isDir: st.isDirectory() });
        } catch (e) { /* ignore */ }
      }
      out.files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      out.total = out.files.length;
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  }
  function countFiles(absDir, depth = 0) {
    if (depth > 4) return 0;
    let n = 0;
    try {
      for (const name of fs.readdirSync(absDir)) {
        if (name.startsWith('.')) continue;
        const p = path.join(absDir, name);
        try {
          const st = fs.statSync(p);
          n += st.isDirectory() ? countFiles(p, depth + 1) : 1;
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    return n;
  }
  function assetsData() {
    const ws = config.workspaceRoot;
    const data = {
      workspaceRoot: ws || null,
      outputs: { files: [], total: 0 },
      customers: { folders: [], files: [] },
      toolbox: listToolbox(config.skillsRoot, config.toolbox),
    };
    if (!ws) return data;
    data.outputs = listDir(path.join(ws, 'outputs'));
    try {
      const cdir = path.join(ws, 'customers');
      for (const name of fs.readdirSync(cdir)) {
        if (name.startsWith('.')) continue;
        const abs = path.join(cdir, name);
        try {
          const st = fs.statSync(abs);
          if (st.isDirectory()) {
            data.customers.folders.push({ name, rel: `customers/${name}`, files: countFiles(abs), mtimeMs: st.mtimeMs });
          } else {
            data.customers.files.push({ name, rel: `customers/${name}`, size: st.size, mtimeMs: st.mtimeMs });
          }
        } catch (e) { /* ignore */ }
      }
      data.customers.folders.sort((a, b) => b.mtimeMs - a.mtimeMs);
      data.customers.files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch (e) { /* 目录不存在则留空 */ }
    return data;
  }

  /* ---------- 日志尾读 ---------- */
  function tailFile(abs, n) {
    try {
      const st = fs.statSync(abs);
      const max = 512 * 1024;
      let text;
      if (st.size > max) {
        const fd = fs.openSync(abs, 'r');
        const buf = Buffer.alloc(max);
        fs.readSync(fd, buf, 0, max, st.size - max);
        fs.closeSync(fd);
        text = buf.toString('utf8');
        const nl = text.indexOf('\n');
        if (nl >= 0) text = text.slice(nl + 1);
      } else {
        text = fs.readFileSync(abs, 'utf8');
      }
      return text.split('\n').slice(-n).join('\n');
    } catch (e) {
      return `（读取失败：${e && e.message}）`;
    }
  }

  /* ---------- 诊断包 ---------- */
  function buildDiagnostics() {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const stage = path.join(os.tmpdir(), `ObsidianWork-诊断-${stamp}`);
    fs.mkdirSync(stage, { recursive: true });
    const put = (name, content) => fs.writeFileSync(path.join(stage, name), content, 'utf8');
    put('health.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      app: 'ObsidianWork',
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      uptimeSec: Math.round(process.uptime()),
      vault: { root: vault.root, healthy: vault.healthy, error: vault.error, scanMs: vault.scanMs, lastScanAt: vault.lastScanAt },
      notes: { count: vault.notes.size, fullTextBytes: vault.fullTextBytes },
      clients: vault.counts(),
      decisions: { openCount: vault.decisions.openCount, total: vault.decisions.total },
      watch: watcher.status(),
      sseClients: sseClients.size,
      backupRoot: writers.backupRoot,
      backups: writers.listBackups({ limit: 500 }).length,
    }, null, 2));
    put('broken-links.json', JSON.stringify({ count: vault.brokenLinks().length, items: vault.brokenLinks() }, null, 2));
    put('backups.json', JSON.stringify(writers.listBackups({ limit: 500 }), null, 2));
    for (const name of ['server.log', 'server.err']) {
      const src = path.join(__dirname, '..', name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, name));
    }
    const zipName = `ObsidianWork-诊断-${stamp}.zip`;
    const downloads = path.join(os.homedir(), 'Downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const zipPath = path.join(downloads, zipName);
    try {
      execFileSync('ditto', ['-c', '-k', '--keepParent', stage, zipPath], { timeout: 30000 });
    } catch (e) {
      fs.rmSync(stage, { recursive: true, force: true });
      const err = new Error(`打包失败：${e && e.message}`);
      err.httpCode = 500;
      throw err;
    }
    fs.rmSync(stage, { recursive: true, force: true });
    return { path: zipPath, bytes: fs.statSync(zipPath).size };
  }

  /* ---------- 写请求守卫 ---------- */
  function guard(req) {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('application/json')) return '需要 Content-Type: application/json';
    const origin = req.headers.origin;
    if (origin) {
      const ok = [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`];
      if (!ok.includes(origin)) return '来源不被允许';
    }
    return null;
  }

  /* ======================= GET ======================= */
  async function handleGet(req, res, url, p) {
    switch (p) {
      case '/api/v3/summary': {
        const today = localYMD(new Date());
        const todayCount = activity.filter((a) => String(a.at || '').slice(0, 10) === today).length;
        return json(res, 200, { ok: true, data: { ...vault.summary(), todayCount, watch: watcher.status() } });
      }

      case '/api/v3/clients':
        return json(res, 200, { ok: true, data: { clients: vault.clients, counts: vault.counts() } });

      case '/api/v3/decisions':
        return json(res, 200, { ok: true, data: vault.decisions });

      case '/api/v3/knowledge/tree':
        return json(res, 200, { ok: true, data: vault.knowledgeTree() });

      case '/api/v3/linkmap':
        return json(res, 200, { ok: true, data: vault.linkmap() });

      case '/api/v3/links/broken': {
        const items = vault.brokenLinks();
        return json(res, 200, { ok: true, data: { count: items.length, items } });
      }

      case '/api/v3/notes/templates':
        return json(res, 200, { ok: true, data: { templates: writers.templates() } });

      case '/api/v3/captures':
        return json(res, 200, { ok: true, data: vault.captures() });

      case '/api/v3/assets':
        return json(res, 200, { ok: true, data: assetsData() });

      case '/api/v3/system/log': {
        const lines = Math.min(parseInt(url.searchParams.get('lines') || '200', 10) || 200, 2000);
        return json(res, 200, {
          ok: true,
          data: {
            lines,
            log: tailFile(path.join(__dirname, '..', 'server.log'), lines),
            err: tailFile(path.join(__dirname, '..', 'server.err'), 60),
          },
        });
      }

      case '/api/v3/activity': {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '60', 10) || 60, 200);
        const today = localYMD(new Date());
        return json(res, 200, {
          ok: true,
          data: {
            items: activity.slice(-limit).reverse(),
            todayCount: activity.filter((a) => String(a.at || '').slice(0, 10) === today).length,
          },
        });
      }

      case '/api/v3/backups': {
        const rel = url.searchParams.get('relPath') || undefined;
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
        return json(res, 200, { ok: true, data: { backups: writers.listBackups({ relPath: rel, limit }) } });
      }

      case '/api/v3/system/health':
        return json(res, 200, {
          ok: true,
          data: {
            node: process.version,
            uptimeSec: Math.round(process.uptime()),
            vault: { root: vault.root, healthy: vault.healthy, error: vault.error, scanMs: vault.scanMs, lastScanAt: vault.lastScanAt },
            notes: { count: vault.notes.size, fullTextBytes: vault.fullTextBytes },
            clients: vault.counts(),
            overdue: vault.clients.filter((c) => c.days != null && c.days >= 7).length,
            watch: watcher.status(),
            sseClients: sseClients.size,
            backupRoot: writers.backupRoot,
            backups: writers.listBackups({ limit: 1 }).length ? '有' : '空',
          },
        });

      case '/api/events': {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        res.write(`event: hello\ndata: ${JSON.stringify({
          at: new Date().toISOString(),
          summary: vault.summary(),
          watch: watcher.status(),
        })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
    }

    // /api/v3/clients/:ss
    let m = p.match(/^\/api\/v3\/clients\/([^/]+)$/);
    if (m) {
      const detail = vault.clientDetail(decodeURIComponent(m[1]));
      if (!detail) return json(res, 404, { ok: false, error: '客户不存在' });
      detail.workspaceDirs = workspaceDirsFor(detail.client);
      detail.backups = writers.listBackups({ relPath: detail.relPath, limit: 30 });
      return json(res, 200, { ok: true, data: detail });
    }

    // /api/v3/notes?path=…
    if (p === '/api/v3/notes') {
      const rel = url.searchParams.get('path') || '';
      const note = vault.note(rel);
      if (!note) return json(res, 404, { ok: false, error: '笔记不存在' });
      return json(res, 200, { ok: true, data: note });
    }

    // /api/v3/search?q=…
    if (p === '/api/v3/search') {
      const q = url.searchParams.get('q') || '';
      const t0 = Date.now();
      const results = vault.search(q, 30);
      return json(res, 200, { ok: true, data: { q, results, ms: Date.now() - t0 } });
    }

    // /api/v3/open?path=…&app=obsidian|system&root=vault|workspace
    if (p === '/api/v3/open') {
      const rel = url.searchParams.get('path') || '';
      const app = url.searchParams.get('app') || 'system';
      const rootKind = url.searchParams.get('root') || 'vault';
      const base = rootKind === 'workspace' ? (config.workspaceRoot || '') : vault.root;
      if (!base) return json(res, 400, { ok: false, error: '未配置 workspaceRoot' });
      const norm = rel.split(path.sep).join('/');
      const abs = path.join(base, norm);
      const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
      if (!abs.startsWith(baseWithSep)) return json(res, 400, { ok: false, error: '路径越界' });
      if (!fs.existsSync(abs)) return json(res, 404, { ok: false, error: '文件不存在' });
      const reveal = url.searchParams.get('reveal') === '1';
      if (app === 'obsidian') {
        if (rootKind !== 'vault') return json(res, 400, { ok: false, error: '仅库内文件可在 Obsidian 打开' });
        const vaultName = config.vaultName || path.basename(vault.root);
        const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(norm.replace(/\.md$/, ''))}`;
        execFile('open', [uri], () => {});
      } else {
        execFile('open', reveal ? ['-R', abs] : [abs], () => {});
      }
      return json(res, 200, { ok: true, data: { opened: norm, app, root: rootKind, reveal } });
    }

    return json(res, 404, { ok: false, error: `未知接口 ${p}` });
  }

  /* ======================= POST（写操作，全部走 writers） ======================= */
  async function handlePost(req, res, url, p) {
    const g = guard(req);
    if (g) return json(res, 403, { ok: false, error: g });
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (e) {
      return json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    }
    try {
      let m = p.match(/^\/api\/v3\/clients\/([^/]+)\/followup$/);
      if (m) {
        const ss = decodeURIComponent(m[1]);
        const out = body.dryRun ? writers.dryRunFollowup(ss, body) : writers.applyFollowup(ss, body);
        return json(res, 200, { ok: true, data: out });
      }
      if (p === '/api/v3/index/status') {
        const out = body.dryRun ? writers.dryRunIndexStatus(body.ss, body) : writers.applyIndexStatus(body.ss, body);
        return json(res, 200, { ok: true, data: out });
      }
      if (p === '/api/v3/backup/restore') {
        return json(res, 200, { ok: true, data: writers.restoreBackup(body.id) });
      }
      if (p === '/api/v3/notes') {
        const out = body.dryRun ? writers.dryRunCreateNote(body) : writers.applyCreateNote(body);
        return json(res, 200, { ok: true, data: out });
      }
      if (p === '/api/v3/captures') {
        const kind = String(body.kind || '');
        const out = body.dryRun ? writers.dryRunCapture(kind, body) : writers.applyCapture(kind, body);
        return json(res, 200, { ok: true, data: out });
      }
      if (p === '/api/v3/captures/toggle') {
        return json(res, 200, { ok: true, data: writers.toggleCapture(body) });
      }
      if (p === '/api/v3/system/restart') {
        // 先回响应，再异步重启（launchd KeepAlive 会拉起新实例；浏览器 SSE 自动重连）
        setTimeout(() => {
          try {
            execFile('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${config.serviceLabel || 'com.obsidianwork.web'}`], () => { /* ignore */ });
          } catch (e) { /* ignore */ }
        }, 450);
        return json(res, 200, { ok: true, data: { restarting: true } });
      }
      if (p === '/api/v3/system/diagnostics') {
        const out = buildDiagnostics();
        if (body.reveal === true) {
          try { execFile('open', ['-R', out.path], () => { /* ignore */ }); } catch (e) { /* ignore */ }
        }
        return json(res, 200, { ok: true, data: out });
      }
    } catch (e) {
      return json(res, e.httpCode || 500, { ok: false, error: String(e && e.message || e) });
    }
    return json(res, 404, { ok: false, error: `未知接口 ${p}` });
  }

  /* ---------- 路由入口 ---------- */
  async function handle(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET') return handleGet(req, res, url, p);
    if (req.method === 'POST') return handlePost(req, res, url, p);
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  return { handle, sseBroadcast, recordActivity, sseCount: () => sseClients.size };
}

module.exports = { createRouter };
