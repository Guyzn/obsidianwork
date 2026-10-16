#!/bin/bash
# ObsidianWork · 双击启动器
# 已安装（launchd）→ 直接打开工作台；未安装 → 引导安装
set -u
cd "$(dirname "$0")"

LABEL="com.obsidianwork.web"
PORT="${OW_PORT:-8788}"
CONFIG_FILE="$HOME/Library/Application Support/ObsidianWork/config.json"
[ -f "$CONFIG_FILE" ] && P="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("port",""))' "$CONFIG_FILE" 2>/dev/null)" && [ -n "$P" ] && PORT="$P"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "ObsidianWork 已在后台运行，正在打开工作台…"
  open "http://127.0.0.1:$PORT"
  exit 0
fi

echo "ObsidianWork 尚未注册为后台服务。"
printf "现在安装（推荐，开机自启）？[Y/n] "
read -r ANS
if [ "$ANS" = "n" ] || [ "$ANS" = "N" ]; then
  echo "临时启动（关掉这个窗口就停止）…"
  sleep 1
  open "http://127.0.0.1:$PORT" 2>/dev/null &
  exec ./launcher.sh server.js
else
  exec ./scripts/install-macos.sh
fi
