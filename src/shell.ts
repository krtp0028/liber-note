import * as api from "./api";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { AttachmentsPanel } from "./attachments";
import { buildLayout, el } from "./app/dom";
import { mountMarkdownTools } from "./app/formatbar";
import { mountTabs } from "./app/tabs";
import { commands } from "./commands";
import { config } from "./config";
import { createEditor, createViewer } from "./editor";
import { exportNoteAsHtml, exportNoteAsPdf } from "./export";
import { openHealthPanel } from "./health";
import { openDoctorPanel } from "./doctor";
import { DEFAULT_KEYMAP, isMacPlatform, matchesEvent } from "./keymap";
import type { KeyBinding } from "./keymap";
import { isPreviewPosition, nextPreviewPosition } from "./layout";
import type { PreviewPosition } from "./layout";
import { LuaController } from "./lua";
import { installMenu } from "./menu";
import { CommandPalette, fuzzyMatch } from "./palette";
import { baseName, parentDir } from "./paths";
import { createPreview } from "./preview";
import { promptText } from "./prompt";
import { QuickOpen } from "./quickopen";
import { RecentVaultsPanel, rememberVault } from "./recent";
import { rewriteReferences } from "./refs";
import { effectiveTags, resolveVault } from "./resolver";
import type { TreeNode } from "./resolver";
import { SearchUi } from "./searchui";
import { computeRollups } from "./rollup";
import { VaultStore } from "./store";
import { TasksPanel } from "./tasks";
import { WELCOME_MD, WELCOME_PATH } from "./welcome";
import { upsertFrontmatter } from "./frontmatter";
import { ThemeController } from "./theme";
import { TreeView } from "./tree";
import { UndoStack } from "./undo";

export function mountShell(root: HTMLElement): void {
  const store = new VaultStore();
  const isMac = isMacPlatform();
  const themeController = new ThemeController();

  const {
    app,
    openButton,
    addNodeButton,
    addChildButton,
    newFolderButton,
    saveButton,
    undoButton,
    deleteButton,
    searchButton,
    quickOpenButton,
    tasksButton,
    previewButton,
    configButton,
    divider,
    notice,
    dirty,
    errorBanner,
    conflictBanner,
    tabBar,
    sidebar,
    treeSearch,
    treeContainer,
    tagPanel,
    tagList,
    docArea,
    formatBar,
    editorHost,
    secondaryPane,
    splitter,
    previewPane,
    statusVault,
    statusFile,
    statusType,
    tagChips,
    filterBadge,
    statusWords,
    statusCursor,
  } = buildLayout(root);

  let previewPosition: PreviewPosition = "right";
  const applyPreviewPosition = (position: PreviewPosition): void => {
    previewPosition = position;
    docArea.dataset.preview = position;
    docArea.style.removeProperty("--preview-size");
    previewButton.title = `Preview: ${position} (Ctrl+Shift+V cycles)`;
  };
  const cyclePreview = (): void => {
    applyPreviewPosition(nextPreviewPosition(previewPosition));
  };
  applyPreviewPosition(previewPosition);

  const editorView = createEditor(editorHost, store, {
    onCursor: (info) => {
      statusCursor.textContent =
        info.selected > 0
          ? `Ln ${info.line}, Col ${info.column} (${info.selected} sel)`
          : `Ln ${info.line}, Col ${info.column}`;
    },
  });
  createPreview(previewPane, store);
  const secondaryViewer = createViewer(secondaryPane);
  store.openWelcome(WELCOME_PATH, WELCOME_MD);

  let noticeTimer: number | undefined;
  const showNotice = (text: string): void => {
    notice.textContent = text;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
    }, 5000);
  };
  const insertAtCursor = (text: string): void => {
    const range = editorView.state.selection.main;
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
    });
    editorView.focus();
  };
  const lua = new LuaController(insertAtCursor, showNotice);

  const importDroppedFiles = async (paths: string[]): Promise<void> => {
    const { root } = store.getState();
    if (!root || paths.length === 0) {
      return;
    }
    const stamp = Date.now();
    const snippets: string[] = [];
    for (const [index, path] of paths.entries()) {
      const name = path.split(/[\\/]/).pop() ?? `file-${index}`;
      const safe = name.replace(/[^\w.-]+/g, "-");
      const relPath = `assets/${stamp}-${index}-${safe}`;
      try {
        await api.importExternal(root, path, relPath);
        const isImage = /\.(png|jpe?g|gif|webp)$/i.test(name);
        snippets.push(isImage ? `![${name}](${relPath})` : `[${name}](${relPath})`);
      } catch (error) {
        showNotice(`import failed: ${String(error)}`);
      }
    }
    if (snippets.length > 0) {
      insertAtCursor(snippets.join("\n"));
      await store.refresh();
    }
  };
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        void importDroppedFiles(event.payload.paths);
      }
    })
    .catch(() => undefined);

  const tree = new TreeView({
    container: treeContainer,
    onOpenFile: (relPath) => {
      void store.openFile(relPath);
    },
    onMove: (request) => {
      void applyMove(request.openPaths, request.target, request.position, request.mirror);
    },
    onReorder: (openPath, direction) => {
      void applyReorder(openPath, direction);
    },
    onFilterBadge: () => {
      setFilter("open tasks", tasksFilter);
    },
  });

  const moveInto = async (
    root: string,
    openPath: string,
    target: string,
    mirror: boolean,
  ): Promise<void> => {
    const { entries } = store.getState();
    const entry = entries.find((candidate) => candidate.relPath === openPath);
    if (!entry) {
      return;
    }
    const targetIsDir = entries.some(
      (candidate) => candidate.relPath === target && candidate.isDir,
    );
    const contents = await api.readFile(root, openPath);
    if (mirror) {
      if (entry.frontmatter.alsoUnder.includes(target)) {
        return;
      }
      await api.writeFile(
        root,
        openPath,
        upsertFrontmatter(contents, { also_under: [...entry.frontmatter.alsoUnder, target] }),
      );
      return;
    }
    const physicalParent = parentDir(openPath);
    let value: string | null;
    if (targetIsDir) {
      value = target === physicalParent ? null : target;
    } else {
      value = target.replace(/\.md$/i, "");
    }
    await api.writeFile(root, openPath, upsertFrontmatter(contents, { parent: value }));
  };

  const applyMove = async (
    openPaths: string[],
    target: string,
    position: "into" | "before" | "after",
    mirror: boolean,
  ): Promise<void> => {
    const { root, entries } = store.getState();
    if (!root || openPaths.length === 0) {
      return;
    }

    if (position === "into") {
      for (const openPath of openPaths) {
        const entry = store.getState().entries.find((candidate) => candidate.relPath === openPath);
        if (entry?.isDir) {
          const targetIsDir = entries.some(
            (candidate) => candidate.relPath === target && candidate.isDir,
          );
          const destinationDir = targetIsDir ? target : parentDir(target);
          const to = joinPath(destinationDir, baseName(openPath));
          if (to !== openPath && !to.startsWith(`${openPath}/`)) {
            await api.renamePath(root, openPath, to);
            await rewriteReferences(root, store.getState().entries, openPath, to);
            undo.push({
              label: `move ${openPath}`,
              run: async () => {
                await api.renamePath(root, to, openPath);
                await rewriteReferences(root, store.getState().entries, to, openPath);
                await store.refresh();
              },
            });
          }
          continue;
        }
        await moveInto(root, openPath, target, mirror);
      }
      await store.refresh();
      return;
    }

    const dir = parentDir(target);
    const siblings = entries
      .filter((entry) => !entry.isDir && parentDir(entry.relPath) === dir)
      .sort((a, b) => {
        const orderA = a.frontmatter.order ?? Number.POSITIVE_INFINITY;
        const orderB = b.frontmatter.order ?? Number.POSITIVE_INFINITY;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.relPath.localeCompare(b.relPath);
      })
      .map((entry) => entry.relPath)
      .filter((path) => !openPaths.includes(path));
    const index = siblings.indexOf(target);
    if (index === -1) {
      for (const openPath of openPaths) {
        await moveInto(root, openPath, dir ?? "", mirror);
      }
      await store.refresh();
      return;
    }
    const ordered = [...siblings];
    ordered.splice(position === "before" ? index : index + 1, 0, ...openPaths);
    await assignOrders(ordered);
    await store.refresh();
  };

  const assignOrders = async (orderedPaths: string[]): Promise<void> => {
    const { root, entries } = store.getState();
    if (!root) {
      return;
    }
    const byPath = new Map(entries.map((entry) => [entry.relPath, entry]));
    for (const [index, path] of orderedPaths.entries()) {
      const desired = (index + 1) * 10;
      const entry = byPath.get(path);
      if (entry && entry.frontmatter.order === desired) {
        continue;
      }
      const contents = await api.readFile(root, path);
      await api.writeFile(root, path, upsertFrontmatter(contents, { order: desired }));
    }
  };

  const applyReorder = async (openPath: string, direction: -1 | 1): Promise<void> => {
    const { root, entries } = store.getState();
    if (!root) {
      return;
    }
    const dir = parentDir(openPath);
    const siblings = entries
      .filter((entry) => !entry.isDir && parentDir(entry.relPath) === dir)
      .sort((a, b) => {
        const orderA = a.frontmatter.order ?? Number.POSITIVE_INFINITY;
        const orderB = b.frontmatter.order ?? Number.POSITIVE_INFINITY;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.relPath.localeCompare(b.relPath);
      });
    const index = siblings.findIndex((entry) => entry.relPath === openPath);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) {
      return;
    }
    const reordered = [...siblings];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
    for (const [position, entry] of reordered.entries()) {
      const nextOrder = (position + 1) * 10;
      if (entry.frontmatter.order !== nextOrder) {
        const contents = await api.readFile(root, entry.relPath);
        await api.writeFile(root, entry.relPath, upsertFrontmatter(contents, { order: nextOrder }));
      }
    }
    await store.refresh();
  };

  const undo = new UndoStack();
  let clipboard: { paths: string[]; mode: "copy" | "cut" } | null = null;
  let currentByPath = new Map<string, api.FileMeta>();
  let currentParentOf = new Map<string, string | null>();
  let filterActive = false;

  const updateTagChips = (): void => {
    tagChips.replaceChildren();
    const { activePath } = store.getState();
    if (!activePath || currentByPath.size === 0) {
      return;
    }
    const { tags, sources } = effectiveTags(activePath, currentByPath, currentParentOf);
    const own = new Set(
      (currentByPath.get(activePath)?.frontmatter.tags ?? []).map((tag) => tag.trim()),
    );
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = own.has(tag) ? "tag" : "tag inherited";
      chip.textContent = tag;
      const source = sources.get(tag);
      if (source && !own.has(tag)) {
        chip.title = `inherited from ${source}`;
      }
      tagChips.append(chip);
    }
  };

  const renderTagPanel = (): void => {
    const counts = new Map<string, number>();
    for (const entry of store.getState().entries) {
      if (entry.isDir) {
        continue;
      }
      for (const tag of effectiveTags(entry.relPath, currentByPath, currentParentOf).tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    tagPanel.hidden = sorted.length === 0;
    tagList.replaceChildren(
      ...sorted.map(([tag, count]) => {
        const row = document.createElement("button");
        row.className = "tag-row";
        const label = document.createElement("span");
        label.textContent = `#${tag}`;
        const badge = document.createElement("span");
        badge.className = "tag-count";
        badge.textContent = String(count);
        row.append(label, badge);
        row.addEventListener("click", () => {
          const matching = new Set<string>();
          for (const entry of store.getState().entries) {
            if (entry.isDir) {
              continue;
            }
            if (effectiveTags(entry.relPath, currentByPath, currentParentOf).tags.includes(tag)) {
              matching.add(entry.relPath);
            }
          }
          setFilter(`#${tag}`, (node) => node.openPath !== "" && matching.has(node.openPath));
        });
        return row;
      }),
    );
  };

  const refreshTreeData = (entries: api.FileMeta[]): void => {
    const resolved = resolveVault(entries);
    currentByPath = new Map(entries.map((entry) => [entry.relPath, entry]));
    currentParentOf = resolved.parentOf;
    tree.setRoots(resolved.roots);
    const rollupConfig = config.getState().config.rollup;
    tree.setRollups(
      computeRollups(resolved.roots, currentByPath, rollupConfig.fields),
      rollupConfig,
    );
    updateTagChips();
    renderTagPanel();
  };

  const setFilter = (label: string, match: ((node: TreeNode) => boolean) | null): void => {
    filterActive = match !== null;
    tree.setFilter(match);
    filterBadge.hidden = !filterActive;
    filterBadge.textContent = filterActive ? `Filter: ${label} (Esc clears)` : "";
  };

  const tasksFilter = (node: TreeNode): boolean =>
    node.openPath !== "" && (currentByPath.get(node.openPath)?.metrics.tasksOpen ?? 0) > 0;

  treeSearch.addEventListener("input", () => {
    const query = treeSearch.value.trim();
    if (query === "") {
      setFilter("", null);
      return;
    }
    setFilter(`"${query}"`, (node) => fuzzyMatch(query, node.name));
  });
  treeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      treeSearch.value = "";
      setFilter("", null);
      treeSearch.blur();
    }
  });

  const selectedTarget = (): string | null => {
    const selected = tree.getSelected();
    if (!selected) {
      return null;
    }
    if (selected.isDir && selected.openPath === "") {
      return selected.relPath;
    }
    return selected.openPath === "" ? null : selected.openPath;
  };

  const selectedDir = (): string | null => {
    const target = selectedTarget();
    if (!target) {
      return null;
    }
    const selected = tree.getSelected();
    if (selected && selected.isDir && selected.openPath === "") {
      return target;
    }
    return parentDir(target);
  };

  const joinPath = (dir: string | null, name: string): string => (dir ? `${dir}/${name}` : name);

  const uniqueNodeName = (dir: string | null): string => {
    const existing = new Set(
      store
        .getState()
        .entries.filter((entry) => !entry.isDir && parentDir(entry.relPath) === dir)
        .map((entry) => baseName(entry.relPath)),
    );
    let candidate = "New Node.md";
    let counter = 2;
    while (existing.has(candidate)) {
      candidate = `New Node ${counter}.md`;
      counter += 1;
    }
    return candidate;
  };

  const addNode = async (mode: "sibling" | "child"): Promise<void> => {
    const { root } = store.getState();
    if (!root) {
      return;
    }
    const selected = tree.getSelected();
    const selectedFile =
      selected && !selected.isDir && selected.openPath !== "" ? selected.openPath : null;
    const selectedDir =
      selected && selected.isDir && selected.openPath === "" && selected.relPath !== "__dangling__"
        ? selected.relPath
        : null;

    let physicalDir: string | null = null;
    let parentValue: string | null = null;

    if (mode === "sibling") {
      if (selectedFile) {
        physicalDir = parentDir(selectedFile);
      } else if (selectedDir) {
        physicalDir = parentDir(selectedDir);
      }
    } else if (selectedDir) {
      physicalDir = selectedDir;
    } else if (selectedFile) {
      physicalDir = parentDir(selectedFile);
      parentValue = selectedFile.replace(/\.md$/i, "");
    }

    const fileName = uniqueNodeName(physicalDir);
    const relPath = joinPath(physicalDir, fileName);
    const title = fileName.replace(/\.md$/i, "");
    const hookFrontmatter = await lua.hook("new_note", relPath);

    let contents = `# ${title}\n`;
    if (hookFrontmatter) {
      contents = `${hookFrontmatter}\n${contents}`;
    }
    if (parentValue) {
      contents = upsertFrontmatter(contents, { parent: parentValue });
    }
    await api.writeFile(root, relPath, contents);
    undo.push({
      label: `add node ${relPath}`,
      run: async () => {
        await api.trashPath(root, relPath);
        await store.refresh();
      },
    });
    await store.refresh();

    if (mode === "sibling" && selectedFile) {
      const siblings = store
        .getState()
        .entries.filter((entry) => !entry.isDir && parentDir(entry.relPath) === physicalDir)
        .sort((a, b) => {
          const orderA = a.frontmatter.order ?? Number.POSITIVE_INFINITY;
          const orderB = b.frontmatter.order ?? Number.POSITIVE_INFINITY;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return a.relPath.localeCompare(b.relPath);
        })
        .map((entry) => entry.relPath)
        .filter((path) => path !== relPath);
      const index = siblings.indexOf(selectedFile);
      if (index !== -1) {
        const ordered = [...siblings];
        ordered.splice(index + 1, 0, relPath);
        await assignOrders(ordered);
        await store.refresh();
      }
    }

    await store.openFile(relPath);
  };

  commands.register({
    id: "tree.add_node",
    title: "Add node (after selected)",
    run: () => addNode("sibling"),
  });

  commands.register({
    id: "tree.add_child_node",
    title: "Add child node",
    run: () => addNode("child"),
  });

  commands.register({
    id: "tree.new_folder",
    title: "New folder",
    run: async () => {
      const { root } = store.getState();
      if (!root) {
        return;
      }
      const name = await promptText(app, {
        title: "New folder name",
        initial: "folder",
        confirmLabel: "Create",
      });
      if (!name) {
        return;
      }
      const relPath = joinPath(selectedDir(), name);
      await api.createDir(root, relPath);
      undo.push({
        label: `new folder ${relPath}`,
        run: async () => {
          await api.trashPath(root, relPath);
          await store.refresh();
        },
      });
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.rename",
    title: "Rename",
    run: async () => {
      const { root } = store.getState();
      const target = selectedTarget();
      if (!root || !target) {
        return;
      }
      const currentName = baseName(target);
      const name = await promptText(app, {
        title: `Rename ${currentName}`,
        initial: currentName,
        confirmLabel: "Rename",
      });
      if (!name || name === currentName) {
        return;
      }
      const to = joinPath(parentDir(target), name);
      const entries = store.getState().entries;
      await api.renamePath(root, target, to);
      await rewriteReferences(root, entries, target, to);
      undo.push({
        label: `rename ${target}`,
        run: async () => {
          await api.renamePath(root, to, target);
          await rewriteReferences(root, store.getState().entries, to, target);
          await store.refresh();
        },
      });
      const active = store.getState().activePath;
      if (active === target) {
        await store.openFile(to);
      } else if (active !== null && active.startsWith(`${target}/`)) {
        store.clearActive();
      }
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.duplicate",
    title: "Duplicate note",
    run: async () => {
      const { root } = store.getState();
      const selected = tree.getSelected();
      if (!root || !selected || selected.isDir || selected.openPath === "") {
        return;
      }
      const from = selected.openPath;
      const name = baseName(from);
      const dot = name.lastIndexOf(".");
      const duplicateName =
        dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
      const to = joinPath(parentDir(from), duplicateName);
      await api.duplicatePath(root, from, to);
      undo.push({
        label: `duplicate ${from}`,
        run: async () => {
          await api.trashPath(root, to);
          await store.refresh();
        },
      });
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.delete",
    title: "Move to trash",
    run: async () => {
      const { root } = store.getState();
      const targets = tree.getSelection();
      if (!root || targets.length === 0) {
        return;
      }
      const trashIds: Array<[string, string]> = [];
      const removed: string[] = [];
      for (const target of [...targets].sort((a, b) => b.length - a.length)) {
        if (removed.some((parent) => target.startsWith(`${parent}/`))) {
          continue;
        }
        const trashId = await api.trashPath(root, target);
        trashIds.push([trashId, target]);
        removed.push(target);
      }
      undo.push({
        label: `delete ${removed.length} node(s)`,
        run: async () => {
          for (const [trashId] of [...trashIds].reverse()) {
            await api.restoreTrash(root, trashId);
          }
          await store.refresh();
        },
      });
      const active = store.getState().activePath;
      if (
        active !== null &&
        removed.some((target) => active === target || active.startsWith(`${target}/`))
      ) {
        store.clearActive();
      }
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.copy",
    title: "Copy",
    run: () => {
      const targets = tree.getSelection();
      if (targets.length > 0) {
        clipboard = { paths: targets, mode: "copy" };
      }
    },
  });

  commands.register({
    id: "tree.cut",
    title: "Cut",
    run: () => {
      const targets = tree.getSelection();
      if (targets.length > 0) {
        clipboard = { paths: targets, mode: "cut" };
      }
    },
  });

  commands.register({
    id: "tree.paste",
    title: "Paste",
    run: async () => {
      const { root } = store.getState();
      const source = clipboard;
      if (!root || !source) {
        return;
      }
      const dir = selectedDir();
      const entries = store.getState().entries;
      for (const path of source.paths) {
        const to = joinPath(dir, baseName(path));
        if (to === path) {
          continue;
        }
        const entry = entries.find((candidate) => candidate.relPath === path);
        if (source.mode === "copy" && entry?.isDir) {
          showNotice("folder copy is not supported yet");
          continue;
        }
        if (source.mode === "copy") {
          await api.duplicatePath(root, path, to);
          undo.push({
            label: `paste ${to}`,
            run: async () => {
              await api.trashPath(root, to);
              await store.refresh();
            },
          });
        } else {
          await api.renamePath(root, path, to);
          await rewriteReferences(root, entries, path, to);
          undo.push({
            label: `move ${path}`,
            run: async () => {
              await api.renamePath(root, to, path);
              await rewriteReferences(root, store.getState().entries, to, path);
              await store.refresh();
            },
          });
        }
      }
      if (source.mode === "cut") {
        clipboard = null;
      }
      await store.refresh();
    },
  });

  commands.register({
    id: "edit.undo",
    title: "Undo last file operation",
    run: async () => {
      await undo.undoLast();
    },
  });

  commands.register({
    id: "file.reveal",
    title: "Reveal in file manager",
    run: async () => {
      const { root } = store.getState();
      const target = tree.getSelected()?.openPath;
      if (!root || !target) {
        return;
      }
      const separator = root.includes("\\") ? "\\" : "/";
      const absolute = `${root.replace(/[\\/]+$/, "")}${separator}${target.split("/").join(separator)}`;
      await api.revealPath(absolute);
    },
  });

  commands.register({
    id: "node.set_color",
    title: "Set node color",
    run: async () => {
      const { root } = store.getState();
      const target = tree.getSelected()?.openPath;
      if (!root || !target) {
        return;
      }
      const value = await promptText(app, {
        title: "Node color (hex, empty to clear)",
        initial: currentByPath.get(target)?.frontmatter.color ?? "#c0392b",
        confirmLabel: "Apply",
      });
      if (value === null) {
        return;
      }
      const contents = await api.readFile(root, target);
      await api.writeFile(
        root,
        target,
        upsertFrontmatter(contents, { color: value === "" ? null : value }),
      );
      await store.refresh();
    },
  });

  commands.register({
    id: "node.set_icon",
    title: "Set node icon",
    run: async () => {
      const { root } = store.getState();
      const target = tree.getSelected()?.openPath;
      if (!root || !target) {
        return;
      }
      const value = await promptText(app, {
        title: "Node icon (single symbol, empty to clear)",
        initial: currentByPath.get(target)?.frontmatter.icon ?? "",
        confirmLabel: "Apply",
      });
      if (value === null) {
        return;
      }
      const contents = await api.readFile(root, target);
      await api.writeFile(
        root,
        target,
        upsertFrontmatter(contents, { icon: value === "" ? null : value }),
      );
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.sort_children",
    title: "Sort children by name",
    run: async () => {
      const { root, entries } = store.getState();
      const selected = tree.getSelected();
      if (!root || !selected) {
        return;
      }
      const dir =
        selected.isDir && selected.openPath === ""
          ? selected.relPath
          : parentDir(selected.openPath);
      const children = entries
        .filter((entry) => !entry.isDir && parentDir(entry.relPath) === dir)
        .map((entry) => entry.relPath)
        .sort((a, b) => baseName(a).localeCompare(baseName(b)));
      await assignOrders(children);
      await store.refresh();
    },
  });

  commands.register({
    id: "tree.expand_all",
    title: "Expand all nodes",
    run: () => tree.expandAll(),
  });

  commands.register({
    id: "tree.collapse_all",
    title: "Collapse all nodes",
    run: () => tree.collapseAll(),
  });

  const applyZoom = (value: number, announce = true): void => {
    const clamped = Math.min(1.6, Math.max(0.7, Math.round(value * 100) / 100));
    document.body.style.zoom = String(clamped);
    window.localStorage.setItem("liber.zoom", String(clamped));
    if (announce) {
      showNotice(`zoom ${Math.round(clamped * 100)}%`);
    }
  };
  const currentZoom = (): number => Number(window.localStorage.getItem("liber.zoom") ?? "1");
  applyZoom(currentZoom(), false);

  commands.register({
    id: "view.zoom_in",
    title: "Zoom in",
    run: () => applyZoom(currentZoom() + 0.1),
  });
  commands.register({
    id: "view.zoom_out",
    title: "Zoom out",
    run: () => applyZoom(currentZoom() - 0.1),
  });
  commands.register({
    id: "view.zoom_reset",
    title: "Reset zoom",
    run: () => applyZoom(1),
  });

  commands.register({
    id: "journal.open_today",
    title: "Open today's journal",
    run: async () => {
      const { root, entries } = store.getState();
      if (!root) {
        return;
      }
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const folder = config.getState().config.journal.folder.replace(/^\/+|\/+$/g, "");
      const relPath = folder === "" ? `${date}.md` : `${folder}/${date}.md`;
      if (!entries.some((entry) => entry.relPath === relPath)) {
        const frontmatter = await lua.hook("new_note", relPath);
        let contents = `# ${date}\n`;
        if (frontmatter) {
          contents = `${frontmatter}\n${contents}`;
        }
        await api.writeFile(root, relPath, contents);
        await store.refresh();
      }
      await store.openFile(relPath);
    },
  });

  commands.register({
    id: "export.note_html",
    title: "Export note as HTML",
    run: async () => {
      const { activePath, contents } = store.getState();
      if (!activePath) {
        return;
      }
      const target = await exportNoteAsHtml(activePath, contents);
      if (target) {
        showNotice(`exported ${target}`);
      }
    },
  });

  commands.register({
    id: "export.note_pdf",
    title: "Print / export note as PDF",
    run: async () => {
      const { activePath, contents } = store.getState();
      if (!activePath) {
        return;
      }
      await exportNoteAsPdf(activePath, contents);
      showNotice("opened in your browser — use Print to save as PDF");
    },
  });

  const attachmentsPanel = new AttachmentsPanel(app, {
    store,
    onNotice: showNotice,
    onChanged: () => store.refresh(),
  });
  commands.register({
    id: "attachments.manage",
    title: "Attachments & trash",
    run: () => attachmentsPanel.open(),
  });

  commands.register({
    id: "update.check",
    title: "Check for updates",
    run: async () => {
      try {
        const update = await checkUpdate();
        if (!update) {
          showNotice("up to date");
          return;
        }
        showNotice(`downloading v${update.version}...`);
        await update.downloadAndInstall();
        await relaunch();
      } catch {
        showNotice("updates are not configured for this build");
      }
    },
  });

  commands.register({
    id: "pane.open_secondary",
    title: "Open selected note in split view",
    run: async () => {
      const { root } = store.getState();
      const target = tree.getSelected()?.openPath;
      if (!root || !target) {
        return;
      }
      const contents = await api.readFile(root, target);
      secondaryPane.hidden = false;
      secondaryViewer.load(target, contents);
    },
  });

  commands.register({
    id: "pane.close_secondary",
    title: "Close split view",
    run: () => {
      secondaryPane.hidden = true;
      secondaryViewer.clear();
    },
  });

  commands.register({
    id: "tree.filter_tasks",
    title: "Filter tree: open tasks",
    run: () => {
      setFilter("open tasks", tasksFilter);
    },
  });

  commands.register({
    id: "tree.filter_by_tag",
    title: "Filter tree by tag",
    run: async () => {
      const tag = await promptText(app, {
        title: "Filter by tag (inherited tags included)",
        initial: "",
        confirmLabel: "Filter",
      });
      if (!tag) {
        return;
      }
      const clean = tag.replace(/^#/, "").trim();
      const matching = new Set<string>();
      for (const entry of store.getState().entries) {
        if (entry.isDir) {
          continue;
        }
        const result = effectiveTags(entry.relPath, currentByPath, currentParentOf);
        if (result.tags.includes(clean)) {
          matching.add(entry.relPath);
        }
      }
      setFilter(`#${clean}`, (node) => node.openPath !== "" && matching.has(node.openPath));
    },
  });

  commands.register({
    id: "tree.clear_filter",
    title: "Clear tree filter",
    run: () => {
      setFilter("", null);
    },
  });

  const { render: renderTabBar } = mountTabs(store, tabBar);

  let conflictPath: string | null = null;
  const hideConflict = (): void => {
    conflictPath = null;
    conflictBanner.hidden = true;
  };
  const showConflict = (path: string): void => {
    if (conflictPath === path) {
      return;
    }
    conflictPath = path;
    conflictBanner.replaceChildren();
    const message = document.createElement("span");
    message.textContent = `${path} changed on disk.`;
    const reload = document.createElement("button");
    reload.className = "button";
    reload.textContent = "Reload from disk";
    reload.addEventListener("click", () => {
      void store.openFile(path).then(hideConflict);
    });
    const keep = document.createElement("button");
    keep.className = "button";
    keep.textContent = "Keep mine";
    keep.addEventListener("click", () => {
      void store.saveActive().then(hideConflict);
    });
    conflictBanner.append(message, reload, keep);
    conflictBanner.hidden = false;
  };

  const handleExternalChange = async (): Promise<void> => {
    await store.refresh();
    const snapshot = store.getState();
    if (snapshot.root) {
      for (const tab of snapshot.tabs) {
        try {
          const disk = await api.readFile(snapshot.root, tab);
          store.setTabContents(tab, disk);
        } catch {
          // the tab file may have been removed; leave it as-is
        }
      }
    }
    const state = store.getState();
    if (!state.root || !state.activePath) {
      return;
    }
    try {
      const disk = await api.readFile(state.root, state.activePath);
      const current = store.getState();
      if (current.activePath !== state.activePath) {
        return;
      }
      if (disk === current.contents) {
        hideConflict();
        return;
      }
      if (current.dirty) {
        showConflict(state.activePath);
        return;
      }
      hideConflict();
      await store.openFile(state.activePath);
    } catch {
      hideConflict();
    }
  };

  let externalTimer: number | undefined;
  void listen("vault-changed", () => {
    window.clearTimeout(externalTimer);
    externalTimer = window.setTimeout(() => {
      void handleExternalChange();
    }, 350);
  });

  const effectiveKeymap = (): KeyBinding[] => {
    const bindings = [...DEFAULT_KEYMAP];
    for (const [chord, command] of Object.entries(config.getState().config.keymap)) {
      const existing = bindings.findIndex(
        (binding) => binding.chord.toLowerCase() === chord.toLowerCase(),
      );
      const binding: KeyBinding = { chord, command, context: "global" };
      if (existing >= 0) {
        bindings[existing] = binding;
      } else {
        bindings.push(binding);
      }
    }
    for (const keymap of lua.getKeymaps()) {
      const exists = bindings.some(
        (binding) => binding.chord.toLowerCase() === keymap.chord.toLowerCase(),
      );
      if (!exists) {
        bindings.push({ chord: keymap.chord, command: keymap.command, context: "global" });
      }
    }
    return bindings;
  };

  commands.register({
    id: "vault.open",
    title: "Open folder",
    run: async () => {
      const selected = await open({ directory: true, title: "Open vault folder" });
      if (typeof selected === "string") {
        await store.openVault(selected);
      }
    },
  });
  commands.register({
    id: "file.save",
    title: "Save note",
    run: () => store.saveActive(),
  });
  commands.register({
    id: "preview.cycle_position",
    title: "Cycle preview position",
    run: () => {
      cyclePreview();
    },
  });
  commands.register({
    id: "palette.open",
    title: "Show command palette",
    run: () => {
      palette.open();
    },
  });
  commands.register({
    id: "config.health",
    title: "Show config health",
    run: () => {
      openHealthPanel(app, config, () => themeController.getErrors());
    },
  });
  commands.register({
    id: "doctor.open",
    title: "Run vault doctor",
    run: () => {
      openDoctorPanel(
        app,
        () => store.getState().root,
        (relPath, line) => {
          void store.openFileAt(relPath, line);
        },
        showNotice,
      );
    },
  });
  commands.register({
    id: "settings.open",
    title: "Open config file",
    run: async () => {
      await config.ensureStarterConfig();
      const paths = config.getPaths();
      if (paths) {
        await api.openExternal(paths.configFile);
      }
    },
  });

  const palette = new CommandPalette(app, {
    commands: () => commands.list(),
    onRun: (id) => {
      commands.run(id).catch((error: unknown) => {
        store.reportError(error);
      });
    },
  });

  const quickOpen = new QuickOpen(app, {
    getEntries: () => store.getState().entries,
    onOpen: (relPath) => {
      void store.openFile(relPath);
    },
  });

  const searchUi = new SearchUi(app, {
    getContext: () => {
      const { root, entries } = store.getState();
      if (!root) {
        return null;
      }
      return { root, entries, parentOf: currentParentOf };
    },
    onOpen: (relPath, line) => {
      void store.openFileAt(relPath, line);
    },
  });

  commands.register({
    id: "file.quick_open",
    title: "Quick open note",
    run: () => {
      quickOpen.open();
    },
  });
  commands.register({
    id: "search.open",
    title: "Search vault",
    run: () => {
      searchUi.open();
    },
  });

  const runCommand = (id: string): void => {
    commands.run(id).catch((error: unknown) => store.reportError(error));
  };

  mountMarkdownTools({ bar: formatBar, store, view: editorView, run: runCommand, divider });

  const tasksPanel = new TasksPanel(app, {
    getContext: () => {
      const { root, entries } = store.getState();
      return root ? { root, entries } : null;
    },
    onOpen: (relPath, line) => {
      void store.openFileAt(relPath, line);
    },
  });
  commands.register({
    id: "tasks.open",
    title: "Open tasks",
    run: () => tasksPanel.open(),
  });

  const recentPanel = new RecentVaultsPanel(app, (root) => {
    void store.openVault(root);
  });
  commands.register({
    id: "vault.open_recent",
    title: "Open recent vault",
    run: () => recentPanel.open(),
  });

  const rootHint = el("div", "tree-empty");
  const hintText = document.createElement("span");
  hintText.textContent = "Choose a root folder.";
  const chooseRoot = el("button", "button");
  chooseRoot.textContent = "Browse…";
  chooseRoot.addEventListener("click", () => runCommand("vault.open"));
  rootHint.append(hintText, chooseRoot);
  sidebar.append(rootHint);

  void installMenu(runCommand, showNotice);

  openButton.addEventListener("click", () => runCommand("vault.open"));
  addNodeButton.addEventListener("click", () => runCommand("tree.add_node"));
  addChildButton.addEventListener("click", () => runCommand("tree.add_child_node"));
  newFolderButton.addEventListener("click", () => runCommand("tree.new_folder"));
  saveButton.addEventListener("click", () => runCommand("file.save"));
  undoButton.addEventListener("click", () => runCommand("edit.undo"));
  deleteButton.addEventListener("click", () => runCommand("tree.delete"));
  searchButton.addEventListener("click", () => runCommand("search.open"));
  quickOpenButton.addEventListener("click", () => runCommand("file.quick_open"));
  tasksButton.addEventListener("click", () => runCommand("tasks.open"));
  previewButton.addEventListener("click", () => runCommand("preview.cycle_position"));
  configButton.addEventListener("click", () => runCommand("config.health"));

  splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const rect = docArea.getBoundingClientRect();
      let size: number;
      if (previewPosition === "right") {
        size = rect.right - moveEvent.clientX;
      } else if (previewPosition === "left") {
        size = moveEvent.clientX - rect.left;
      } else if (previewPosition === "bottom") {
        size = rect.bottom - moveEvent.clientY;
      } else {
        size = moveEvent.clientY - rect.top;
      }
      const total =
        previewPosition === "left" || previewPosition === "right" ? rect.width : rect.height;
      const clamped = Math.max(total * 0.15, Math.min(total * 0.7, size));
      docArea.style.setProperty("--preview-size", `${Math.round(clamped)}px`);
    };
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
  });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape" && filterActive) {
      event.preventDefault();
      setFilter("", null);
      return;
    }
    const inTree = document.activeElement === treeContainer;
    if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      runCommand(event.shiftKey ? "tab.prev" : "tab.next");
      return;
    }
    if (inTree) {
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === "F2") {
        event.preventDefault();
        runCommand("tree.rename");
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        runCommand("tree.delete");
        return;
      }
      if (modifier && event.altKey && key === "n") {
        event.preventDefault();
        runCommand("tree.new_folder");
        return;
      }
      if (modifier && event.shiftKey && key === "n") {
        event.preventDefault();
        runCommand("tree.add_child_node");
        return;
      }
      if (modifier && !event.shiftKey && !event.altKey) {
        if (key === "n") {
          event.preventDefault();
          runCommand("tree.add_node");
          return;
        }
        if (key === "c") {
          event.preventDefault();
          runCommand("tree.copy");
          return;
        }
        if (key === "x") {
          event.preventDefault();
          runCommand("tree.cut");
          return;
        }
        if (key === "v") {
          event.preventDefault();
          runCommand("tree.paste");
          return;
        }
      }
      if (modifier && key === "z") {
        event.preventDefault();
        runCommand("edit.undo");
        return;
      }
    }
    for (const binding of effectiveKeymap()) {
      if (binding.context === "global" && matchesEvent(event, binding.chord, isMac)) {
        event.preventDefault();
        runCommand(binding.command);
        return;
      }
    }
  });

  config.subscribe((state) => {
    themeController.updateConfig(state.config);
    const position = state.config.preview.position;
    if (isPreviewPosition(position) && position !== previewPosition) {
      applyPreviewPosition(position);
    }
    if (store.getState().entries.length > 0) {
      refreshTreeData(store.getState().entries);
    }
  });

  void (async () => {
    await config.start();
    const paths = config.getPaths();
    if (paths) {
      await themeController.setPaths(paths);
      await lua.start(dirOf(paths.configFile));
    }
    themeController.updateConfig(config.getState().config);
    await lua.hook("startup", store.getState().root ?? "");
  })();

  const SESSION_KEY = "liber.session";
  const saveSession = (): void => {
    const { root, tabs, activePath } = store.getState();
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ root, tabs, activePath }));
  };

  const restoreSession = async (): Promise<void> => {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return;
    }
    try {
      const session = JSON.parse(raw) as {
        root?: string | null;
        tabs?: string[];
        activePath?: string | null;
      };
      if (!session.root) {
        return;
      }
      await store.openVault(session.root);
      const valid = new Set(store.getState().entries.map((entry) => entry.relPath));
      for (const tab of session.tabs ?? []) {
        if (valid.has(tab)) {
          await store.openFile(tab);
        }
      }
      if (session.activePath && valid.has(session.activePath)) {
        await store.openFile(session.activePath);
      }
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
    }
  };

  let sessionTimer: number | undefined;
  const scheduleSessionSave = (): void => {
    window.clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(saveSession, 600);
  };

  void restoreSession();

  let syncingScroll = false;
  const scrollRatio = (element: HTMLElement): number =>
    element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight);
  const applyScrollRatio = (element: HTMLElement, ratio: number): void => {
    element.scrollTop = ratio * Math.max(0, element.scrollHeight - element.clientHeight);
  };
  editorView.scrollDOM.addEventListener("scroll", () => {
    if (
      syncingScroll ||
      previewPosition === "hidden" ||
      !config.getState().config.preview.syncScroll
    ) {
      return;
    }
    syncingScroll = true;
    applyScrollRatio(previewPane, scrollRatio(editorView.scrollDOM));
    window.requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
  previewPane.addEventListener("scroll", () => {
    if (
      syncingScroll ||
      previewPosition === "hidden" ||
      !config.getState().config.preview.syncScroll
    ) {
      return;
    }
    syncingScroll = true;
    applyScrollRatio(editorView.scrollDOM, scrollRatio(previewPane));
    window.requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });

  let lastRoot: string | null | undefined;
  let lastEntries: unknown;
  let lastActivePath: string | null | undefined;
  let lastDirty: boolean | undefined;
  let lastTitle = "";
  store.subscribe((state) => {
    rootHint.hidden = state.root !== null;
    statusVault.textContent = state.root ?? "no vault open";
    statusFile.textContent = state.activePath ?? "";
    statusType.textContent = state.activePath
      ? state.activePath.toLowerCase().endsWith(".md")
        ? "Markdown"
        : "Plain text"
      : "";
    dirty.hidden = !(state.dirty && state.activePath !== null);
    errorBanner.hidden = state.error === null;
    errorBanner.textContent = state.error ?? "";

    if (lastDirty && !state.dirty && state.activePath) {
      void lua.hook("save", state.activePath);
    }
    lastDirty = state.dirty;

    if (state.root !== lastRoot) {
      lastRoot = state.root;
      void config.setVault(state.root);
      if (state.root) {
        rememberVault(state.root);
        void api.watchVault(state.root).catch(() => undefined);
      }
    }
    if (state.entries !== lastEntries) {
      lastEntries = state.entries;
      refreshTreeData(state.entries);
      tasksPanel.refresh();
      void lua.hook("tree_change", String(state.entries.length));
    }
    if (state.activePath !== lastActivePath) {
      lastActivePath = state.activePath;
      tree.setActive(state.activePath);
      updateTagChips();
      if (state.activePath) {
        void lua.hook("open", state.activePath);
      }
    }
    renderTabBar();
    scheduleSessionSave();

    const title = `${state.activePath ? `${baseName(state.activePath)} — ` : ""}${
      state.root ? baseName(state.root) : "Liber"
    }`;
    if (title !== lastTitle) {
      lastTitle = title;
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => undefined);
    }

    const activeEntry = state.activePath ? currentByPath.get(state.activePath) : undefined;
    statusWords.textContent = activeEntry ? `${activeEntry.metrics.words} words` : "";
  });
}

function dirOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index === -1 ? path : path.slice(0, index);
}
