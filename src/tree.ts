import { icon } from "./icons";
import type { TreeNode } from "./resolver";
import type { RollupAggregate, RollupConfig } from "./rollup";

export function visibleNodes(roots: TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const visible: TreeNode[] = [];
  const visit = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      visible.push(node);
      if ((node.isDir || node.children.length > 0) && expanded.has(node.relPath)) {
        visit(node.children);
      }
    }
  };
  visit(roots);
  return visible;
}

export function filterTree(nodes: TreeNode[], match: (node: TreeNode) => boolean): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.mirror) {
      continue;
    }
    if (match(node)) {
      result.push(node);
      continue;
    }
    const children = filterTree(node.children, match);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

export interface TreeMoveRequest {
  openPaths: string[];
  target: string;
  position: "into" | "before" | "after";
  mirror: boolean;
}

export interface TreeViewOptions {
  container: HTMLElement;
  onOpenFile: (relPath: string) => void;
  onMove?: (request: TreeMoveRequest) => void;
  onReorder?: (openPath: string, direction: -1 | 1) => void;
  onFilterBadge?: (node: TreeNode) => void;
}

export class TreeView {
  private readonly container: HTMLElement;
  private readonly options: TreeViewOptions;
  private roots: TreeNode[] = [];
  private readonly expanded = new Set<string>();
  private selection = new Set<string>();
  private primaryPath: string | null = null;
  private dragPaths: string[] = [];
  private rollups: Map<string, RollupAggregate> | null = null;
  private rollupConfig: RollupConfig | null = null;
  private filter: ((node: TreeNode) => boolean) | null = null;

  constructor(options: TreeViewOptions) {
    this.container = options.container;
    this.options = options;
    this.container.classList.add("tree");
    this.container.tabIndex = 0;
    this.container.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.container.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    this.container.addEventListener("drop", (event) => {
      const raw = event.dataTransfer?.getData("application/x-liber-paths");
      if (raw && this.options.onMove && event.target === this.container) {
        event.preventDefault();
        try {
          const paths = JSON.parse(raw) as string[];
          this.options.onMove({
            openPaths: paths,
            target: "",
            position: "into",
            mirror: event.altKey,
          });
        } catch {
          // ignore malformed drag payloads
        }
      }
    });
  }

  setRoots(roots: TreeNode[]): void {
    this.roots = roots;

    const validPaths = new Set<string>();
    const collect = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        validPaths.add(node.relPath);
        collect(node.children);
      }
    };
    collect(roots);
    for (const path of [...this.expanded]) {
      if (!validPaths.has(path)) {
        this.expanded.delete(path);
      }
    }
    this.render();
  }

  setActive(relPath: string | null): void {
    this.primaryPath = relPath;
    this.selection = relPath === null ? new Set() : new Set([relPath]);
    this.render();
  }

  getSelected(): TreeNode | null {
    if (this.primaryPath === null) {
      return null;
    }
    return (
      visibleNodes(this.roots, this.expanded).find((node) => node.relPath === this.primaryPath) ??
      visibleNodes(this.roots, this.expanded).find((node) => node.openPath === this.primaryPath) ??
      null
    );
  }

  getSelection(): string[] {
    const paths: string[] = [];
    const collect = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (this.selection.has(node.relPath) && node.relPath !== "__dangling__") {
          const value = node.openPath !== "" ? node.openPath : node.relPath;
          if (!paths.includes(value)) {
            paths.push(value);
          }
        }
        collect(node.children);
      }
    };
    collect(this.roots);
    if (paths.length === 0 && this.primaryPath !== null) {
      paths.push(this.primaryPath);
    }
    return paths;
  }

  expandAll(): void {
    const visit = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (node.isDir || node.children.length > 0) {
          this.expanded.add(node.relPath);
        }
        visit(node.children);
      }
    };
    visit(this.roots);
    this.render();
  }

  collapseAll(): void {
    this.expanded.clear();
    this.render();
  }

  setRollups(rollups: Map<string, RollupAggregate>, config: RollupConfig): void {
    this.rollups = rollups;
    this.rollupConfig = config;
    this.render();
  }

  setFilter(match: ((node: TreeNode) => boolean) | null): void {
    this.filter = match;
    this.render();
  }

  get activeFilter(): boolean {
    return this.filter !== null;
  }

  private render(): void {
    const sourceRoots = this.filter ? filterTree(this.roots, this.filter) : this.roots;
    const visible = visibleNodes(sourceRoots, this.expanded);
    const list = document.createElement("ul");
    list.className = "tree-list";

    for (const node of visible) {
      const item = document.createElement("li");
      item.className = "tree-item";
      if (node.isDir) {
        item.classList.add("dir");
      }
      if (node.mirror) {
        item.classList.add("mirror");
      }
      if (this.selection.has(node.relPath)) {
        item.classList.add("selected");
      }
      if (node.openPath === this.primaryPath && !node.mirror) {
        item.classList.add("active");
      }
      item.style.paddingLeft = `${8 + this.depth(node.relPath) * 14}px`;

      const twisty = document.createElement("span");
      twisty.className = "twisty";
      const expandable = node.isDir || node.children.length > 0;
      twisty.textContent = expandable ? (this.expanded.has(node.relPath) ? "v" : ">") : "";
      if (expandable) {
        twisty.classList.add("clickable");
        twisty.addEventListener("click", (event) => {
          event.stopPropagation();
          this.container.focus();
          this.toggleExpanded(node.relPath);
        });
      }

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = node.name;

      const nodeIcon = document.createElement("span");
      nodeIcon.className = "node-icon";
      if (node.icon) {
        nodeIcon.textContent = node.icon;
        nodeIcon.classList.add("emoji");
      } else {
        nodeIcon.append(
          icon(node.isDir || node.relPath === "__dangling__" ? "folder" : "file", 13),
        );
      }
      if (node.color) {
        label.style.setProperty("--node-color", node.color);
        nodeIcon.style.setProperty("--node-color", node.color);
      }

      item.append(nodeIcon, twisty, label);

      if (node.mirror) {
        item.append(this.badge("◇", `also in: ${node.placements.join(", ")}`, "badge-mirror"));
      }
      if (node.cycle) {
        item.append(this.badge("!", "circular parent chain detected", "badge-error"));
      }
      if (node.dangling) {
        item.append(this.badge("?", "parent target does not exist", "badge-warning"));
      }

      if (!node.mirror && this.rollups && this.rollupConfig) {
        const aggregate = this.rollups.get(node.relPath);
        if (aggregate) {
          const total = aggregate.open + aggregate.done;
          if (this.rollupConfig.tasks && total > 0) {
            const tasks = this.badge(
              `${aggregate.done}/${total} ✓`,
              `${aggregate.open} open, ${aggregate.done} done in this subtree — click to filter`,
              "badge-rollup",
            );
            tasks.addEventListener("click", (event) => {
              event.stopPropagation();
              this.options.onFilterBadge?.(node);
            });
            item.append(tasks);
          }
          if (this.rollupConfig.words && aggregate.words > 0) {
            item.append(this.badge(`${aggregate.words}w`, "words in this subtree", "badge-rollup"));
          }
          for (const field of this.rollupConfig.fields) {
            const sum = aggregate.sums[field];
            if (typeof sum === "number" && sum !== 0) {
              item.append(this.badge(`${field}:${sum}`, `sum of ${field}`, "badge-rollup"));
            }
          }
        }
      }

      const isRealDir = node.isDir && node.openPath === "" && node.relPath !== "__dangling__";
      const isFileNode = !node.isDir && node.openPath !== "" && !node.mirror;

      if (node.openPath !== "" || isRealDir) {
        item.draggable = true;
        item.addEventListener("dragstart", (event) => {
          this.dragPaths =
            this.selection.has(node.relPath) && this.getSelection().length > 0
              ? this.getSelection()
              : [node.openPath !== "" ? node.openPath : node.relPath];
          event.dataTransfer?.setData("application/x-liber-paths", JSON.stringify(this.dragPaths));
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
        });
        item.addEventListener("dragend", () => {
          this.dragPaths = [];
        });
      }

      if (isRealDir || isFileNode) {
        const dropTarget = isRealDir ? node.relPath : node.openPath;

        const clearDropClasses = (): void => {
          item.classList.remove("drop-into", "drop-before", "drop-after");
        };

        item.addEventListener("dragover", (event) => {
          if (this.dragPaths.length === 0 || this.dragPaths.includes(dropTarget)) {
            return;
          }
          if (this.dragPaths.some((path) => dropTarget.startsWith(`${path}/`))) {
            return;
          }
          event.preventDefault();
          const rect = item.getBoundingClientRect();
          const ratio = (event.clientY - rect.top) / rect.height;
          clearDropClasses();
          if (ratio < 0.25) {
            item.classList.add("drop-before");
          } else if (ratio > 0.75) {
            item.classList.add("drop-after");
          } else {
            item.classList.add("drop-into");
          }
        });
        item.addEventListener("dragleave", clearDropClasses);
        item.addEventListener("drop", (event) => {
          const position = item.classList.contains("drop-before")
            ? "before"
            : item.classList.contains("drop-after")
              ? "after"
              : "into";
          clearDropClasses();
          const raw = event.dataTransfer?.getData("application/x-liber-paths");
          if (raw && this.options.onMove) {
            event.preventDefault();
            event.stopPropagation();
            try {
              const paths = JSON.parse(raw) as string[];
              this.options.onMove({
                openPaths: paths,
                target: dropTarget,
                position,
                mirror: event.altKey,
              });
            } catch {
              // ignore malformed drag payloads
            }
          }
        });
      }

      item.addEventListener("click", (event) => {
        this.container.focus();
        const visible = visibleNodes(this.roots, this.expanded);
        if (event.shiftKey && this.primaryPath !== null) {
          const from = visible.findIndex((candidate) => candidate.relPath === this.primaryPath);
          const to = visible.findIndex((candidate) => candidate.relPath === node.relPath);
          if (from !== -1 && to !== -1) {
            this.selection = new Set(
              visible
                .slice(Math.min(from, to), Math.max(from, to) + 1)
                .map((entry) => entry.relPath),
            );
          }
          this.render();
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          if (this.selection.has(node.relPath)) {
            this.selection.delete(node.relPath);
          } else {
            this.selection.add(node.relPath);
          }
          this.primaryPath = node.relPath;
          this.render();
          return;
        }
        this.selection = new Set([node.relPath]);
        this.primaryPath = node.relPath;
        if (node.isDir) {
          this.toggleExpanded(node.relPath);
        } else if (node.openPath !== "") {
          this.options.onOpenFile(node.openPath);
          this.render();
        }
      });

      list.append(item);
    }

    this.container.replaceChildren(list);
  }

  private badge(symbol: string, title: string, className: string): HTMLElement {
    const badge = document.createElement("span");
    badge.className = `badge ${className}`;
    badge.textContent = symbol;
    badge.title = title;
    return badge;
  }

  private toggleExpanded(relPath: string): void {
    if (this.expanded.has(relPath)) {
      this.expanded.delete(relPath);
    } else {
      this.expanded.add(relPath);
    }
    this.render();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const node = this.getSelected();
      if (node && this.options.onReorder) {
        event.preventDefault();
        this.options.onReorder(node.openPath, event.key === "ArrowUp" ? -1 : 1);
      }
      return;
    }

    const visible = visibleNodes(this.roots, this.expanded);
    if (visible.length === 0) {
      return;
    }
    const currentIndex = this.primaryPath
      ? visible.findIndex((node) => node.relPath === this.primaryPath)
      : -1;
    let nextIndex = currentIndex;
    let handled = true;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(currentIndex + 1, visible.length - 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case "ArrowRight": {
        const node = visible[currentIndex];
        if (node && (node.isDir || node.children.length > 0) && !this.expanded.has(node.relPath)) {
          this.toggleExpanded(node.relPath);
        } else {
          nextIndex = Math.min(currentIndex + 1, visible.length - 1);
        }
        break;
      }
      case "ArrowLeft": {
        const node = visible[currentIndex];
        if (node && (node.isDir || node.children.length > 0) && this.expanded.has(node.relPath)) {
          this.toggleExpanded(node.relPath);
        } else if (node) {
          const parent = visible.find(
            (candidate) => candidate.relPath === this.parentPath(node.relPath),
          );
          if (parent) {
            nextIndex = visible.indexOf(parent);
          }
        }
        break;
      }
      case "Enter": {
        const node = visible[currentIndex];
        if (node?.isDir) {
          this.toggleExpanded(node.relPath);
        } else if (node && node.openPath !== "") {
          this.selection = new Set([node.relPath]);
          this.primaryPath = node.relPath;
          this.options.onOpenFile(node.openPath);
          this.render();
        }
        break;
      }
      default:
        handled = false;
    }

    if (!handled) {
      return;
    }
    event.preventDefault();
    if (nextIndex !== currentIndex && nextIndex >= 0) {
      this.primaryPath = visible[nextIndex].relPath;
      this.selection = new Set([this.primaryPath]);
      this.render();
      this.container.querySelector(".tree-item.selected")?.scrollIntoView({ block: "nearest" });
    }
  }

  private parentPath(relPath: string): string {
    const clean = relPath.split("::")[0];
    const slash = clean.lastIndexOf("/");
    return slash === -1 ? "" : clean.slice(0, slash);
  }

  private depth(relPath: string): number {
    return relPath.split("::")[0].split("/").length - 1;
  }
}
