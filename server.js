'use strict';
/*
 * ObsidianWork · 服务入口（P4：多页工作台 + 写入安全层 + 决策/知识/搜索/资料/运维）
 *
 *   node server.js            （或 ./launcher.sh server.js）
 *   默认 http://127.0.0.1:8788
 *
 * P1 能力：库全量索引 + FSEvents 实时监听 + SSE 推送 + 只读 API。
 * P2 新增：多页壳（总览/客户/详情/系统）、追加跟进写回、索引状态更新、备份与一键回滚。
 * P3 新增：决策中心、知识库树、笔记阅读器（双链/反链）、全库搜索、新建笔记（三模板）。
 * P4 新增：资料中心（只读浏览 + 技能工具箱）、断链体检、运维（日志/诊断包/重启）。
 * 只绑 127.0.0.1；写库只经 writers 安全层（备份 + 原子写 + 自检）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { Vault } = require('./lib/vault');
const { Watcher } = require('./lib/watcher');
const { createWriters } = require('./lib/writers');
const { createRouter } = require('./lib/api');

const config = loadConfig();
const WEB_ROOT = path.join(__dirname, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/* 只关心「真实笔记」的变化：非隐藏路径、非隐藏文件、.md 结尾 */
function isRelevantRel(p) {
  if (!p) return false;
  const segs = String(p).split('/');
  if (segs.some((s) => s.startsWith('.'))) return false;
  return segs[segs.length - 1].toLowerCase().endsWith('.md');
}

/* ---------- 库初始化 ---------- */
let vault = null;
let watcher = null;
let writers = null;
let router = null;

if (!config.vaultPath) {
  // 首启兜底：没配库路径时，若仓库自带 demo-vault 演示库则先用它跑起来
  const demo = path.join(__dirname, 'demo-vault');
  if (fs.existsSync(path.join(demo, '客户档案索引.md'))) {
    config.vaultPath = demo;
    config.vaultName = 'demo-vault';
    console.log('[ObsidianWork] 未配置库路径 → 先用内置 demo-vault 演示库跑起来');
    console.log('[ObsidianWork] 换成你自己的 Obsidian 库：编辑 ' + config.configFile + ' 的 vaultPath');
  } else {
    console.error('[ObsidianWork] 未配置库路径。请在 config.json 里设置 vaultPath：');
    console.error('   ' + config.configFile);
  }
}
if (config.vaultPath) {
  const t0 = Date.now();
  vault = new Vault(config.vaultPath, { indexFile: config.indexFile, clientsDir: config.clientsDir });
  const scanMs = vault.scanAll();
  if (!vault.healthy) {
    console.error(`[ObsidianWork] 库扫描失败：${vault.error}`);
  }

  watcher = new Watcher(config.vaultPath, (batch) => {
    const rels = (batch.paths || []).filter(isRelevantRel);
    if (!rels.length) return;
    const result = vault.handleChanges(rels);
    const payload = { paths: rels, result, notes: vault.notes.size, at: batch.at };
    if (router) {
      router.recordActivity({ at: batch.at, type: 'external', paths: rels, reloaded: result.reloaded, removed: result.removed, ms: result.ms });
      router.sseBroadcast('change', payload);
    }
    console.log(`[watch] ${rels.length} 个变化 → 重读 ${result.reloaded} / 移除 ${result.removed}（${result.ms}ms）`);
  }).start();

  writers = createWriters({
    vault,
    config,
    markSelfWrite: (rel) => watcher.markSelfWrite(rel),
    onAfterWrite: (rel, info) => {
      const result = vault.handleChanges([rel]);
      if (router) {
        router.recordActivity({ at: new Date().toISOString(), type: info.op === 'restore' ? 'restore' : 'self', paths: [rel], op: info.op, backupId: info.backupId, reloaded: result.reloaded, ms: result.ms });
        router.sseBroadcast('change', { paths: [rel], result, notes: vault.notes.size, at: new Date().toISOString(), source: 'self', op: info.op });
      }
      console.log(`[write] ${info.op} → ${rel}（备份 ${info.backupId}，索引重读 ${result.ms}ms）`);
    },
  });

  console.log(`[ObsidianWork] 库: ${config.vaultPath}`);
  console.log(`[ObsidianWork] 扫描: ${vault.notes.size} 篇 / ${(vault.fullTextBytes / 1024).toFixed(0)} KB 全文，用时 ${scanMs}ms（机械盘顺序读）`);
  console.log(`[ObsidianWork] 客户: ${vault.clients.length} · 待裁决: ${vault.decisions.openCount} · 写入层: 就绪（备份 → ${writers.backupRoot}）`);
}

router = createRouter({ vault, watcher, config, writers });

/* ---------- 静态文件 ---------- */
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(WEB_ROOT, safe);
  if (!abs.startsWith(WEB_ROOT)) return notFound(res);
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(abs).toLowerCase();
    // 本地工具：禁止缓存，保证代码/样式每次都是最新（更新后无感刷新）
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(abs).pipe(res);
  });
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
}

/* ---------- 主服务 ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    Promise.resolve(router.handle(req, res, url)).catch((e) => {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      } catch (e2) { /* ignore */ }
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[ObsidianWork] 端口 ${config.port} 被占用——请先停掉其他实例（lsof -tiTCP:${config.port} | xargs kill）`);
    process.exit(1);
  }
  throw e;
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[ObsidianWork] 就绪 → http://127.0.0.1:${config.port}  (P4 多页工作台)`);
});

process.on('SIGTERM', () => { try { watcher && watcher.close(); } catch (e) { } process.exit(0); });
process.on('SIGINT', () => { try { watcher && watcher.close(); } catch (e) { } process.exit(0); });
