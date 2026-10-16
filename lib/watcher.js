'use strict';
/*
 * ObsidianWork · 库监听层（机械盘友好）
 *
 * 原理：Node fs.watch 在 macOS 上直接挂 FSEvents（内核级），不轮询、不读盘——
 *   对机械盘零额外 IO 压力，事件到达即触发。
 * 职责：
 *   · 递归监听库目录，事件按 300ms 防抖合并成批次（编辑时文件会连发多次写事件）
 *   · 自写抑制：本工作台写入的文件在 800ms 内的回声事件不上报（P2 写回启用后生效）
 *   · 掉线检测：盘不在/目录消失/监听报错 → 标记 offline，每 10s 尝试重挂
 */
const fs = require('fs');

const DEBOUNCE_MS = 300;
const SELF_WRITE_WINDOW_MS = 800;
const RETRY_MS = 10000;

class Watcher {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;       // (batch) => void  batch = { paths:[], at }
    this.watcher = null;
    this.pending = new Map();       // relPath -> lastEventTime
    this.timer = null;
    this.retryTimer = null;
    this.selfWrites = new Map();    // relPath -> time
    this.state = {
      watching: false,
      offline: false,
      reason: '',
      startedAt: null,
      lastEventAt: null,
      lastBatchCount: 0,
      totalEvents: 0,
    };
  }

  start() {
    this._tryWatch();
    this._liveness();
    return this;
  }

  _tryWatch() {
    if (this.watcher) return;
    if (!fs.existsSync(this.root)) {
      this.state.offline = true;
      this.state.reason = '库目录不存在（盘未挂载？）';
      this.state.watching = false;
      this._scheduleRetry();
      return;
    }
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (ev, f) => this._push(ev, f));
      this.watcher.on('error', (e) => this._down(String(e && e.message || e)));
      this.state.watching = true;
      this.state.offline = false;
      this.state.reason = '';
      this.state.startedAt = this.state.startedAt || new Date().toISOString();
    } catch (e) {
      this._down(String(e && e.message || e));
    }
  }

  _down(reason) {
    this.state.watching = false;
    this.state.offline = true;
    this.state.reason = reason;
    try { this.watcher && this.watcher.close(); } catch (e) {}
    this.watcher = null;
    this._scheduleRetry();
  }

  _scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._tryWatch();
      if (!this.state.watching) this._scheduleRetry();
    }, RETRY_MS);
  }

  _liveness() {
    setInterval(() => {
      if (!this.state.watching && !this.retryTimer) this._tryWatch();
    }, RETRY_MS).unref();
  }

  _push(ev, f) {
    if (!f) return;
    const rel = String(f).split('\\').join('/');
    // 自身写入回声过滤
    const sw = this.selfWrites.get(rel);
    if (sw && Date.now() - sw < SELF_WRITE_WINDOW_MS) return;
    this.pending.set(rel, Date.now());
    this.state.totalEvents++;
    if (this.timer) return;
    this.timer = setTimeout(() => this._flush(), DEBOUNCE_MS);
  }

  _flush() {
    this.timer = null;
    if (this.pending.size === 0) return;
    const paths = [...this.pending.keys()];
    this.pending.clear();
    this.state.lastEventAt = new Date().toISOString();
    this.state.lastBatchCount = paths.length;
    try { this.onChange({ paths, at: this.state.lastEventAt }); }
    catch (e) { /* 回调异常不打断监听 */ }
  }

  /* P2 写回层调用：声明「这个文件是我自己改的」 */
  markSelfWrite(relPath) {
    this.selfWrites.set(String(relPath).split('\\').join('/'), Date.now());
    if (this.selfWrites.size > 200) {
      const cut = Date.now() - 60 * 1000;
      for (const [k, t] of this.selfWrites) if (t < cut) this.selfWrites.delete(k);
    }
  }

  status() {
    return { ...this.state, root: this.root };
  }

  close() {
    try { this.watcher && this.watcher.close(); } catch (e) {}
    this.watcher = null;
  }
}

module.exports = { Watcher };
