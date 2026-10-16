#!/bin/bash
# ObsidianWork · macOS 卸载器
# 停服务 + 移除 launchd；配置与备份数据默认保留（可选删除）
set -u

LABEL="com.obsidianwork.web"
DATA_DIR="$HOME/Library/Application Support/ObsidianWork"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> 卸载 ObsidianWork（服务与自启）"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" && echo "==> 服务已停止：$LABEL"
else
  echo "==> 服务未在运行"
fi

if [ -f "$PLIST" ]; then
  rm "$PLIST" && echo "==> 已移除 launchd 配置"
fi

echo ""
printf "同时删除配置与备份数据（%s）？[y/N] " "$DATA_DIR"
read -r ANS
if [ "$ANS" = "y" ] || [ "$ANS" = "Y" ]; then
  rm -rf "$DATA_DIR" && echo "==> 数据目录已删除"
else
  echo "==> 数据目录保留：$DATA_DIR（含你的配置与全部写入备份）"
fi

echo ""
echo "完成。项目目录未动，随时可重新 scripts/install-macos.sh 装回。"
