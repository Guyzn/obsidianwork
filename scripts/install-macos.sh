#!/bin/bash
# ObsidianWork · macOS 安装器
# 检测 Node → 写配置 → 注册 launchd 常驻 → 起服务 → 打开工作台
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LABEL="com.obsidianwork.web"
PORT="${OW_PORT:-8788}"
DATA_DIR="$HOME/Library/Application Support/ObsidianWork"
CONFIG_FILE="$DATA_DIR/config.json"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> ObsidianWork 安装器（macOS）"
echo "    项目目录：$ROOT"

# ---------- 1. Node 检测（沿用 launcher.sh 的解析顺序） ----------
NODE_BIN=""
WB_ROOT="$HOME/.workbuddy/binaries/node"
if [ -d "$WB_ROOT/versions" ]; then
  VER="$(cat "$WB_ROOT/versions/current" 2>/dev/null | tr -d '[:space:]')"
  [ -x "$WB_ROOT/versions/$VER/bin/node" ] && NODE_BIN="$WB_ROOT/versions/$VER/bin/node"
  if [ -z "$NODE_BIN" ]; then
    NODE_BIN="$(ls -d "$WB_ROOT"/versions/*/ 2>/dev/null | sort -V | tail -1)bin/node"
    [ -x "$NODE_BIN" ] || NODE_BIN=""
  fi
fi
[ -z "$NODE_BIN" ] && NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "!! 找不到 node。请先安装 Node.js >= 18（https://nodejs.org）再运行本脚本。"
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "!! node 版本过低（$("$NODE_BIN" -v)），需要 >= 18。"
  exit 1
fi
echo "==> Node：$NODE_BIN（v$("$NODE_BIN" -v | tr -d 'v')）"

# ---------- 2. 库路径 ----------
DEFAULT_VAULT="$ROOT/demo-vault"
VAULT_PATH=""
if [ -f "$CONFIG_FILE" ]; then
  VAULT_PATH="$("$NODE_BIN" -p 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).vaultPath||""}catch(e){""}' "$CONFIG_FILE")"
fi
if [ -z "$VAULT_PATH" ]; then
  echo ""
  echo "请选择你的 Obsidian 库路径（markdown 文件夹）。"
  echo "直接回车 = 先用内置演示库 demo-vault 跑起来，之后可随时改配置："
  printf "库路径 [演示库]："
  read -r INPUT
  INPUT="${INPUT%/}"
  if [ -z "$INPUT" ]; then
    VAULT_PATH="$DEFAULT_VAULT"
  elif [ -d "$INPUT" ]; then
    VAULT_PATH="$INPUT"
  else
    echo "!! 目录不存在：$INPUT"
    exit 1
  fi
fi
echo "==> 库路径：$VAULT_PATH"

# ---------- 3. 写配置（保留已有字段，只补缺的） ----------
mkdir -p "$DATA_DIR"
"$NODE_BIN" - "$CONFIG_FILE" "$VAULT_PATH" "$PORT" "$LABEL" <<'EOF'
const fs = require('fs');
const [file, vaultPath, port, label] = process.argv.slice(2);
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 新装 */ }
cfg.vaultPath = vaultPath;
cfg.vaultName = cfg.vaultName || require('path').basename(vaultPath);
cfg.port = cfg.port || parseInt(port, 10);
cfg.serviceLabel = cfg.serviceLabel || label;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
EOF
echo "==> 配置：$CONFIG_FILE"

# ---------- 4. launchd 常驻 ----------
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/launcher.sh</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$DATA_DIR/server.log</string>
  <key>StandardErrorPath</key>
  <string>$DATA_DIR/server.err</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "!! launchd 注册失败"; exit 1; }
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "==> launchd 已注册：$LABEL（开机自启 + 崩溃自拉起）"

# ---------- 5. 健康检查 + 打开 ----------
sleep 2
if curl -sf --max-time 3 "http://127.0.0.1:$PORT/api/v3/summary" >/dev/null 2>&1; then
  echo "==> 服务已起来：http://127.0.0.1:$PORT"
  open "http://127.0.0.1:$PORT"
else
  echo "!! 服务没起来，看日志：$DATA_DIR/server.err"
  exit 1
fi

echo ""
echo "安装完成。常用命令："
echo "  重启  launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo "  停止  launchctl bootout gui/\$(id -u)/$LABEL"
echo "  卸载  scripts/uninstall-macos.sh"
