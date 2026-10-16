'use strict';
/*
 * ObsidianWork · 技能工具箱（资料中心用）
 *
 * 「只读索引 + 触发语复制」入口：清单在 config.json 的 toolbox 字段里配置
 * （[{dir, title, desc, trigger}]），技能本体在 skillsRoot（默认 ~/.workbuddy/skills/），
 * 本模块只做展示与可用性检测，不复制、不搬移任何内容。
 */
const fs = require('fs');
const path = require('path');

function listToolbox(skillsRoot, entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((t) => ({
    ...t,
    available: skillsRoot ? fs.existsSync(path.join(skillsRoot, t.dir, 'SKILL.md')) : false,
  }));
}

module.exports = { listToolbox };
