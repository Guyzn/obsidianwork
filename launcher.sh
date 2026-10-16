#!/bin/bash
# ObsidianWork 稳定启动器
# 优先动态解析 WorkBuddy 自带 node（versions/current，防版本升级后 launchd 路径失效）；
# 没有 WorkBuddy 时自动退回系统 PATH 里的 node（>= 18 即可）。
# 用法：launcher.sh <script.js> [args...]   （WorkingDirectory 应为 ObsidianWork/）
set -u
NODE_ROOT="$HOME/.workbuddy/binaries/node"
VER="$(cat "$NODE_ROOT/versions/current" 2>/dev/null | tr -d '[:space:]')"
NODE_BIN="$NODE_ROOT/versions/$VER/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(ls -d "$NODE_ROOT"/versions/*/ 2>/dev/null | sort -V | tail -1)bin/node"
fi
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[obsidianwork] 找不到可用 node（检查 $NODE_ROOT/versions）" >&2
  exit 78
fi
exec "$NODE_BIN" "$@"
