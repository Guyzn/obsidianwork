<p align="center">
  <img src="assets/banner-2560.png" alt="ObsidianWork Banner" width="100%">
</p>

# ObsidianWork

一个在机械盘上也能稳定跑的、管得住大量灵活数据的、与 Obsidian 实时互通的本地工作台。

> 基于你自己的 Obsidian 库（markdown 即数据库）。不装插件、不改 Obsidian 本体：
> 工作台与 Obsidian 直接读写同一批 `.md` 文件，文件一变、秒级推送；
> 客户档案、业务资料、技术内容、决策台账，全部走同一批文件。

[English README → README.md](README.md)

## 当前进度（2026-10-16）

| 阶段 | 状态 |
|------|------|
| P0 拍板 | ✅ 六项决策 + 定名 ObsidianWork（见 `docs/规划书.md` §10） |
| P1 实时数据层 | ✅ 库全量索引 / FSEvents 实时监听 / SSE 推送 / 只读 API |
| P2 多页壳 + 客户 CRM | ✅ 已落地（v0.2.0）：总览驾驶舱 / 客户雷达 / 客户详情 / 追加跟进写回 / 索引状态更新 / 字节级备份与一键回滚 / 系统页 |
| P3 决策 + 知识 + 搜索 | ✅ 已落地（v0.3.0）：决策中心 / 知识库 / 阅读器（双链·大纲·反链）/ 全库搜索 / 新建笔记（.trash 撤销） |
| **P4 资料 + 系统页** | ✅ **已落地（v0.4.0）**：资料中心（outputs/customers 只读浏览 + 技能工具箱）/ 断链体检 / 运维（日志 · 诊断包 · 一键重启） |
| **P4.5 便签合并** | ✅ **已落地（v0.5.0）**：待办/火花迁入 Obsidian 库（`工作台/待办.md`、`工作台/火花.md`），便签页（#/captures）+ 总览「待办速览」+ 新建弹窗统一入口；m-deck（:8765）同日退役 |
| P5 开源发布 | ✅ 已落地：隐私清洗 + demo-vault 演示库 + 安装器 + 双语 README + CI + GitHub |

**八个页面全部转正，功能闭环并已开源。** 实测：冷启动索引 71–184ms · 单文件增量重读 2ms · 搜索 3–12ms · 改字→推送秒级 · 断链清单与既有脚本逐条一致（0 条）。

## 快速开始

```bash
./scripts/install-macos.sh     # 安装器：检测 Node → 选库路径（回车用演示库）→ launchd 常驻 → 打开浏览器
# 或者手动跑：
./launcher.sh server.js        # 需要 Node >= 18（自动解析 WorkBuddy 自带 node，无则用系统 node）
# 打开 http://127.0.0.1:8788     ← 多页工作台
# http://127.0.0.1:8788/live.html ← P1 实时自测台（调试用，仍在）
```

- 配置文件：`~/Library/Application Support/ObsidianWork/config.json`（库路径 / 端口 / 工作区根 / 工具箱 / 模板链接等，全字段见英文 README）
- 未配置库路径时自动用内置 `demo-vault/` 演示库（14 篇虚构笔记）跑起来，随时可换成你自己的库
- 常驻服务（launchd）：`com.obsidianwork.web`（KeepAlive，日志在数据目录 `server.log`）；卸载用 `scripts/uninstall-macos.sh`
- 验证实时性：打开工作台 → 去 Obsidian 任意笔记里改一个字保存 → 「总览」的实时动态 1 秒内出现
- 验证写回：客户详情页「追加跟进」→ 预览（显示将写入的原文与字节变化）→ 确认 → Obsidian 里立即出现；随时「撤销」逐字节还原
- 验证双链：知识库 → 随便点开一篇 → 正文里的 `[[双链]]` 点击即跳；右侧有大纲/反链/出链；断链标红
- 验证资料与运维：资料页浏览交付物/工具箱；系统页可查日志、导出诊断包、一键重启（浏览器自动重连）
- 验证便签：「便签」页回车即存一条待办/火花（写进库内 `工作台/待办.md`、`工作台/火花.md`，Obsidian 里立即可见可编辑）；圆圈点击即勾选完成；「新建笔记」弹窗的待办/火花模板与便签页同源

## 结构

```
ObsidianWork/
├── server.js          HTTP 入口（静态 + API + SSE）
├── lib/vault.js       库索引（机械盘友好：一次顺序读 + 全内存 + 增量重读）
├── lib/watcher.js     FSEvents 监听（300ms 防抖 / 自写抑制 / 掉线自动重挂）
├── lib/writers.js     写入安全层（唯一写库入口：备份 / 原子写 / 自检 / 恢复）
├── lib/toolbox.js     技能工具箱（配置驱动：config.json 的 toolbox 字段）
├── lib/config.js      配置解析（环境变量 > 配置文件 > 默认）
├── lib/api.js         REST + SSE 路由（含写回接口与防跨站守卫）
├── web/               多页工作台（index.html + css + js/views：总览/便签/客户/详情/决策/知识/阅读器/搜索/资料/系统）
├── web/vendor/        marked.min.js v12.0.2（MIT，固定版本入仓，无外部 CDN）
├── web/live.html      P1 实时自测台（保留，/live.html 直达）
├── demo-vault/        虚构演示库（14 篇，覆盖全部结构，开箱即跑）
├── scripts/           install-macos.sh 安装器 / uninstall-macos.sh 卸载器 / smoke-test.cjs
│                       generate-icon.py / generate-banner.py（重新生成品牌资产）
├── launcher.sh        Node 动态解析启动器（防版本升级断裂）
├── ObsidianWork.command  双击启动器
├── LICENSE            MIT
└── assets/            应用图标（icon.icns + SVG 源）与 README 横幅
```

## 写回安全机制（P2/P3）

每次写入 = 一次可撤销、可审计、字节级可回滚的事务：

1. **只追加 / 只标注**——跟进追加保证原文前缀字节不变；索引状态更新只做「追加标注」（旧值永不删除）；索引按「表内单行手术」处理，写前逐字节核对（前缀/后缀/行数/字节数四道自检，任何不一致直接拒写）；新建笔记只增不改（重名拒绝、路径校验）；
2. **写前备份**——每次写入先前把目标文件完整备份到 `~/Library/Application Support/ObsidianWork/backups/`；
3. **原子替换**——写临时文件 + fsync + rename，中途断电也不留半截文件；
4. **一键回滚**——写入成功的提示自带「撤销」；系统页/详情页可恢复任意历史版本；恢复前自动再备份当前状态（pre-restore），误恢复还能再撤回；**新建笔记的撤销 = 移入库内 `.trash`**（可找回，非删除）；
5. **防跨站**——写接口要求 JSON Content-Type + 本机来源校验。

写回接口（仅本机 127.0.0.1）：`POST /api/v3/clients/:ss/followup` · `POST /api/v3/index/status` · `POST /api/v3/notes` · `POST /api/v3/captures` · `POST /api/v3/captures/toggle` · `POST /api/v3/backup/restore`（均支持 `dryRun` 预览；toggle 为单行手术 `[ ]↔[x]`，字节数不变）。

## 机械盘设计口径（为什么它不怕慢盘）

1. 启动一次全量**顺序读**，全文常驻内存（700KB 级，上限 64MB 后自动退化）；
2. 此后查询、搜索全部走内存，**零读盘**；
3. 监听走 macOS **FSEvents 内核推送**（不轮询、不扫盘），变化只重读那一个文件；
4. 写操作（P2 起）只在用户操作时发生——原子写 + 写前备份，无任何定时轮询写。

## 边界

- 只绑 `127.0.0.1`，无云端、无账号；业务数据永不进代码仓。
- 写回从 P2 开始且**永远只走「追加 + 标注」**：金额/报关/法律口径不自动化，删除类操作永无。
- 与既有「工作区 ↔ 库」日同步自动化兼容：写入格式沿用库里既有约定，冲突仍走「日期较新为准」。
- License：MIT（见 LICENSE）。
