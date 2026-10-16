<p align="center">
  <img src="docs/assets/banner-2560.png" alt="ObsidianWork Banner" width="100%">
</p>

# ObsidianWork

**A local workbench that stays fast on mechanical hard drives, manages lots of flexible data, and stays in real-time sync with your Obsidian vault.**

Your vault is the database. Obsidian is the editor. ObsidianWork is the workbench — a dashboard and operation panel over the same `.md` files. No cloud, no account, no middleman, no plugins to install in Obsidian.

[中文文档 → README.zh-CN.md](README.zh-CN.md)

---

## Why

- **Markdown is the only source of truth.** ObsidianWork reads and writes the same `.md` files Obsidian does. Change a file in Obsidian → the workbench updates in ~1s. Write back from the workbench → Obsidian sees it instantly.
- **Built for mechanical disks.** One sequential full scan at startup (everything into memory), then FSEvents kernel events only — no polling, no rescanning. Queries and search never touch the disk.
- **A write-back layer with a safety net.** Every write is byte-level backed up, atomically replaced (temp + fsync + rename), and one-click restorable. Note creation "undo" moves the file into `.trash` instead of deleting.
- **Zero dependencies.** Pure Node (built-in modules only) + vanilla JS frontend. No `npm install`, no build step. Clone and run.

## Features

| Page | What it does |
|------|--------------|
| ◉ Overview | Live activity feed, client radar summary, decision counts, quick stats |
| ✎ Captures | Quick todo/spark memos — Enter to save, one click to toggle done. Stored as plain `.md` in your vault |
| ☰ Clients | CRM radar table (status flags, overdue days) + detail pages with append-only follow-up writes |
| ⚖ Decisions | Decision log parsed from your index file: open / fresh / closed / history |
| ❖ Knowledge | Five-section knowledge tree + note reader (wikilinks, outline, backlinks) |
| ⌕ Search | Full-text search across the vault, in-memory, milliseconds |
| ▦ Assets | Read-only browser for deliverables & a configurable skill toolbox |
| ⚙ System | Backups & one-click restore, broken-link checkup, logs, diagnostics, restart |

## Quick Start (macOS, 30 seconds)

```bash
git clone https://github.com/<you>/obsidianwork.git
cd obsidianwork
./scripts/install-macos.sh
```

The installer will:

1. Find a usable Node (WorkBuddy-bundled first, system `node` as fallback; needs **Node ≥ 18**)
2. Ask for your vault path — **just press Enter** to boot with the bundled `demo-vault/` (14 fictional notes covering every structure)
3. Write `~/Library/Application Support/ObsidianWork/config.json`
4. Register a launchd service (`com.obsidianwork.web`: keep-alive + start at login)
5. Open `http://127.0.0.1:8788` in your browser

**Don't want the service?** Run it manually instead:

```bash
./launcher.sh server.js        # or: node server.js
```

**Double-click option:** `ObsidianWork.command` — opens the workbench if running, otherwise offers to install.

## Configuration

Config file: `~/Library/Application Support/ObsidianWork/config.json`
(Environment variables override it: `OW_VAULT`, `OW_PORT`, `OW_INDEX_FILE`, `OW_CLIENTS_DIR`, `OW_SERVICE_LABEL`, …)

| Key | Default | Meaning |
|-----|---------|---------|
| `vaultPath` | *(empty → demo-vault)* | Absolute path of your Obsidian vault |
| `port` | `8788` | HTTP port (bound to 127.0.0.1 only) |
| `indexFile` | `客户档案索引.md` | Index file name inside the vault (client table + decisions live here) |
| `clientsDir` | `Clients` | Folder holding client profiles |
| `workspaceRoot` | `""` | Optional workspace root for the Assets page (read-only) |
| `skillsRoot` | `~/.workbuddy/skills` | Optional skills folder for toolbox availability checks |
| `serviceLabel` | `com.obsidianwork.web` | launchd label used by the in-app restart button |
| `noteLinks` | *(see source)* | Wikilinks used in new-note templates (`hub`, `clientsIndex`, `clientGuide`, `riskIndex`) |
| `toolbox` | `[]` | Skill entries shown on the Assets page: `{dir, title, desc, trigger}` |

Point `vaultPath` at your own vault any time and restart — the demo vault is never required.

## The Vault Format (no plugins, no frontmatter)

ObsidianWork parses plain markdown conventions instead of metadata:

- **Client profiles**: `Clients/SS<number>_<Name>.md` with dated follow-up lines (`- **YYYY-MM-DD**: …`)
- **Index file**: tables under `## 活跃客户` style headers; status emojis drive the radar (⏰ todo · 🔥 hot · ⚠️ risk · 🔄 changing · ⏸ paused · ❄ parked · ✅ done)
- **Decisions**: a table under `## 待 Guy 裁决` (✅ prefix = closed, 🆕 = fresh), history under `## 其他确认`
- **Captures**: `工作台/待办.md` (`- [ ] YYYY-MM-DD …`) and `工作台/火花.md` (`- YYYY-MM-DD：…`)
- **Knowledge**: folders `产品知识 / 业务流程 / 客户沟通 / 行业参考 / 风控案例`, `[[wikilinks]]` everywhere

See `demo-vault/` for a complete working example — copy its conventions into your own vault.

## Write-back Safety (the hard rules)

1. **Append-only / annotate-only** — follow-ups append at the end; index status updates only append annotations (old values are never deleted); table edits are single-line surgery with byte-level prefix/suffix/line-count checks, refusing to write on any mismatch.
2. **Backup before every write** — full byte copy into `~/Library/Application Support/ObsidianWork/backups/`.
3. **Atomic replace** — temp file + fsync + rename; a power cut mid-write never leaves a half-written file.
4. **One-click restore** — every write toast has Undo; restoring first backs up the current state (pre-restore), so a mistaken restore can itself be undone. Note creation undo = move into `.trash`, never delete.
5. **No dangerous automation** — amounts, legal/customs wording are never auto-written; deletes don't exist. Write APIs require JSON Content-Type + same-origin check.

## Privacy

- Binds to `127.0.0.1` only. No cloud, no telemetry, no account.
- Your vault, logs, backups and config stay on your machine (runtime state lives in `~/Library/Application Support/ObsidianWork/`, never in this repo).
- All screenshots and the demo data are fictional.

## Project Layout

```
obsidianwork/
├── server.js            HTTP entry (static + API + SSE)
├── launcher.sh          Node-resolving launcher (survives Node upgrades)
├── ObsidianWork.command Double-click starter
├── lib/vault.js         Vault index (mechanical-disk friendly: one sequential read, all in-memory, incremental reloads)
├── lib/watcher.js       FSEvents watcher (300ms debounce, self-write suppression, auto re-attach)
├── lib/writers.js       Write safety layer (the ONLY vault-writing module)
├── lib/api.js           REST + SSE routes (write guards included)
├── lib/config.js        Config resolution
├── lib/toolbox.js       Skill toolbox (config-driven)
├── web/                 Multi-page workbench (vanilla ES modules, no build step)
├── demo-vault/          Fictional sample vault (14 notes, all structures covered)
├── scripts/             install-macos.sh / uninstall-macos.sh
└── docs/assets/         Logo & banner (SVG sources + PNG)
```

## Uninstall

```bash
./scripts/uninstall-macos.sh   # stops the service + removes launchd entry; config & backups kept unless you say otherwise
```

## License

MIT © 2026 Guyzn Huang
