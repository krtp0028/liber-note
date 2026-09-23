# Liber

Lightweight hierarchical Markdown notes. A native desktop app (Tauri 2 + Rust + TypeScript) for people who like tree-based notes like CherryTree, but want plain `.md` files, a Markdown preview that can sit on any side, and deep configuration.

## Highlights

- **Tree-first notes** — folders are the tree, files are notes, `.md` and `.txt`
- **Multi-placement notes (DAG)** — a note can appear in several places in the tree via `also_under`, without duplicating the file
- **Rollups** — every node shows subtree task progress (`3/7 ✓`), word counts, and numeric field sums; click a badge to filter
- **Inherited context** — tags flow down from branch notes (`Docs.md` governs `Docs/**`); chips show where they came from
- **Preview anywhere** — hidden / right / left / bottom / top, cycled with `Ctrl+Shift+V`, draggable splitter, scroll sync
- **Deep configuration** — layered TOML config, theme files, `custom.css`, hot reload, config health panel
- **Lua scripting** — `init.lua` with commands, hooks, and keymaps
- **Attachments** — paste or drop images into a note; they land in `assets/` and render in the preview
- **Tag browser & tasks** — tag counts in the sidebar, and an open-tasks panel with click-to-jump
- **Autocomplete** — `[[` suggests notes, `#` suggests tags while typing
- **Daily notes** — `Ctrl+Shift+D` opens (or creates) today's note under the configured journal folder
- **Split view, zoom, export** — a read-only second pane, `Ctrl+=`/`Ctrl+-`/`Ctrl+0`, HTML export and browser-based PDF printing
- **Node colors & icons** — `color:` and `icon:` frontmatter render in the tree
- **CherryTree-style UI** — dense toolbar, icon tree with strong selection, Markdown formatting bar, native menu bar, note tabs, and a status bar with node metadata and cursor position
- **Lightweight** — ~5 MB exe, ~1.8 MB installer, ~270 ms cold start, plain files on disk

## Install

Download the latest build for your platform from the GitHub Releases page:

- **Windows**: run `Liber_<version>_x64-setup.exe` (NSIS). WebView2 is downloaded by the installer if missing. SmartScreen may warn about the unsigned installer — choose **More info → Run anyway**.
- **Linux**: `liber_<version>_amd64.AppImage` (portable, bundles WebKitGTK) or `liber_<version>_amd64.deb` for Debian/Ubuntu (requires WebKitGTK 4.1).
- **macOS**: `Liber_<version>_universal.dmg` (Apple Silicon and Intel). The app is unsigned, so the first launch needs right-click → **Open**.
- **Portable (Windows)**: place `liber-portable.txt` next to `liber.exe`; all config lives in `liber-data/` beside the exe.
- **From source**: `npx tauri build` on any platform.

## Getting started

1. Start Liber and click **Open Folder** to pick a vault (any folder of Markdown files).
2. Browse the tree: arrows navigate, `Enter` opens, folders expand with the twisty.
3. Edit in the left pane; the preview updates live; autosave is on.
4. `Ctrl+Shift+P` opens the command palette; `Ctrl+P` quick-opens a note; `Ctrl+Shift+F` searches the vault.

## Note format

Plain Markdown with optional YAML frontmatter:

```markdown
---
parent: Projects/Alpha # logical re-parent; the file stays where it is
also_under: [Reference/Postgres] # extra tree placements (mirrors)
order: 3 # sibling order within its folder
tags: [project-alpha]
hours: 12 # numeric fields can be summed by rollups
---

# Note body

- [ ] task items feed the rollup badges
      See [[Postgres]] for context.
```

- A note `Docs.md` next to a folder `Docs/` acts as a **branch note**: its `tags` (and other configured keys) are inherited by everything under `Docs/**`.
- `[[Wiki Links]]` resolve by path, filename, or `[[Target|alias]]`; backlinks are listed under the preview.
- Missing parents land under **Dangling**; circular parents are flagged and broken safely.

## Configuration

Layered, later wins: built-in defaults → user config → vault config.

- User config: `%APPDATA%\liber\config.toml` (Linux: `~/.config/liber/`, macOS: `~/Library/Application Support/liber/`)
- Vault config: `<vault>/.liber/config.toml`
- Themes: `%APPDATA%\liber\themes\*.toml`
- Escape hatch: `%APPDATA%\liber\custom.css` (loaded last)
- Open your config from the palette: **Open config file**. Inspect effective values and errors: **Show config health** (or the **Config** button).

Config is hot-reloaded on save; invalid files keep the last good config.

```toml
[editor]
fontSize = 14
wordWrap = false
autosaveDelayMs = 500
spellCheck = true

[preview]
position = "right" # hidden | right | left | bottom | top
syncScroll = true

[theme]
followSystem = true
light = "default-light"
dark = "default-dark"

[rollup]
tasks = true
words = false
fields = ["hours"]

[inherit]
keys = ["tags"]

[journal]
folder = "Journal"

[keymap]
"Ctrl+Alt+N" = "tree.add_node"
```

Theme files support inheritance and palettes:

```toml
[meta]
name = "nord-ish"
variant = "dark"
extends = "default-dark"

[palette]
north = "#2e3440"

[colors]
bg = "palette.north"
accent = "#88c0d0"
```

## Lua scripting

`init.lua` in the config directory is loaded at startup and can register commands, hooks, and keymaps. See `docs/lua-example-init.lua`.

```lua
mdtree.command{
  name = "Insert date",
  description = "Insert today's date",
  action = function() return os.date("%Y-%m-%d") end,
}

mdtree.on("save", function(path) mdtree.notify("saved " .. path) end)
mdtree.on("new_note", function(path) return "---\ntags: [inbox]\n---" end)

mdtree.keymap.set("global", "Ctrl+Alt+D", "Insert date")
```

Hooks: `startup`, `open`, `save`, `new_note`, `tree_change`. Command return values are inserted at the editor cursor; `mdtree.notify` shows a status message.

## Default keymap

| Shortcut                                    | Action                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| `Ctrl+P` / `Ctrl+O`                         | Quick open / Open folder                              |
| `Ctrl+Shift+P`                              | Command palette                                       |
| `Ctrl+S`, `Ctrl+,`-style config via palette | Save; open config                                     |
| `Ctrl+Shift+V`                              | Cycle preview position                                |
| `Ctrl+F`-style search                       | `Ctrl+Shift+F` searches the vault                     |
| `Ctrl+N` / `Ctrl+Shift+N`                   | Add node after selected / add child node (tree focus) |
| `Ctrl+Alt+N`                                | New folder (tree focus)                               |
| `F2` / `Delete`                             | Rename / move to trash (tree focus)                   |
| `Alt+↑` / `Alt+↓`                           | Reorder sibling (tree focus)                          |
| `Alt+drag` onto a folder                    | Add `also_under` mirror                               |
| Drag onto a folder                          | Set `parent`                                          |
| `Ctrl+Z` (tree focus)                       | Undo last file operation                              |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+E` / `Ctrl+K`   | Bold / italic / inline code / link (editor)           |
| `Ctrl+Shift+E`                              | Code block (detects the language and writes it in)    |
| `Ctrl+Shift+D`                              | Open today's journal                                  |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0`              | Zoom in / out / reset                                 |
| `Ctrl+W` / `Ctrl+Tab`                       | Close / cycle tabs                                    |

## Auto-updates

Updates are served from the latest GitHub Release (`latest.json` is generated and attached by the release workflow, and the endpoint is already set in `src-tauri/tauri.conf.json`). One-time setup:

1. `npx tauri signer generate -w ~/.tauri/liber.key` — keep the private key out of the repo.
2. Paste the printed public key into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
3. Add `TAURI_SIGNING_PRIVATE_KEY` (the contents of the key file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as repository secrets.
4. Add the repository variable `UPDATER_SIGNING` = `true`.

Each tagged release then also produces signed updater artifacts, and the workflow merges the per-OS manifests into one `latest.json`. Without step 4 the release still builds, just without updater artifacts.

Until the public key is set, **Help → Check for Updates** reports that updates are not configured.

## Development

```sh
npm install
npm run tauri dev     # run app
npm run check         # tsc + eslint + prettier + vitest
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npx tauri build --bundles nsis   # or appimage/deb/rpm/app/dmg
```

CI builds and tests on Windows, Linux, and macOS (`.github/workflows/ci.yml`).

Features are developed on `develop`; pull requests target `develop`. Releases are cut from `main` by pushing a `v*` tag, which builds installers for Windows, Linux, and macOS (`.github/workflows/release.yml`).

## Known limitations

- No auto-updater yet (installers are manual).
- Single-selection file operations (no multi-select batch ops).
- Directory copy/paste is not supported (files only).
- Search matches are streamed per invocation; very large vaults may take a moment.
- Linux builds target WebKitGTK (AppImage bundles it).

## License

MIT
