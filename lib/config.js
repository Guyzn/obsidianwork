'use strict';
/*
 * ObsidianWork · 配置层
 * 配置优先级：环境变量 > 配置文件 > 默认
 * 配置文件：~/Library/Application Support/ObsidianWork/config.json
 * 运行时数据（日志/备份/缓存）统一放上面这个目录，项目目录保持纯净可分发。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const DATA_DIR = path.join(HOME, 'Library/Application Support/ObsidianWork');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* 无配置或损坏，走默认 */ }

  const vaultPath = process.env.OW_VAULT || fileCfg.vaultPath || '';
  const port = parseInt(process.env.OW_PORT || String(fileCfg.port || 8788), 10);
  const indexFile = process.env.OW_INDEX_FILE || fileCfg.indexFile || '客户档案索引.md';
  const clientsDir = process.env.OW_CLIENTS_DIR || fileCfg.clientsDir || 'Clients';
  const workspaceRoot = process.env.OW_WORKSPACE || fileCfg.workspaceRoot || '';
  const skillsRoot = process.env.OW_SKILLS || fileCfg.skillsRoot || path.join(HOME, '.workbuddy', 'skills');
  const serviceLabel = process.env.OW_SERVICE_LABEL || fileCfg.serviceLabel || 'com.obsidianwork.web';

  // 新建笔记模板里的「相关」双链（可按你的库结构在 config.json 里覆盖）
  const noteLinks = {
    hub: '知识库总入口',
    clientsIndex: '客户档案索引',
    clientGuide: '客户沟通/客户画像建档规范',
    riskIndex: '风控案例/风控案例索引',
    ...(fileCfg.noteLinks || {}),
  };

  // 技能工具箱清单（{dir, title, desc, trigger}[]；默认空，在 config.json 里按需配置）
  const toolbox = Array.isArray(fileCfg.toolbox) ? fileCfg.toolbox : [];

  return {
    vaultPath,
    port,
    indexFile,
    clientsDir,
    workspaceRoot, // 工作区根（资料中心/customers 打开用；只读浏览，不搬文件）
    skillsRoot,    // 技能目录（工具箱可用性检测；只读）
    serviceLabel,  // launchd 服务名（系统页「一键重启」用）
    noteLinks,
    toolbox,
    dataDir: DATA_DIR,
    configFile: CONFIG_FILE,
    vaultName: fileCfg.vaultName || (vaultPath ? path.basename(vaultPath) : ''),
  };
}

module.exports = { loadConfig, DATA_DIR, CONFIG_FILE };
