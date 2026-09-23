import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";
import MarkdownIt from "markdown-it";
import type { FileMeta } from "./api";
import "./languages";
import { baseName, parentDir, resolveRelative } from "./paths";
import type { VaultStore } from "./store";

const PREVIEW_DELAY_MS = 80;

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return "";
      }
    }
    return "";
  },
});

export function renderMarkdown(contents: string): string {
  return DOMPurify.sanitize(md.render(contents));
}

export function createPreview(container: HTMLElement, store: VaultStore): void {
  let renderTimer: number | undefined;
  let lastPath: string | null | undefined;
  let lastContents = "";
  let lastEntries: FileMeta[] | undefined;

  store.subscribe((state) => {
    if (
      state.activePath === lastPath &&
      state.contents === lastContents &&
      state.entries === lastEntries
    ) {
      return;
    }
    lastPath = state.activePath;
    lastContents = state.contents;
    lastEntries = state.entries;
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      render(container, store, state.activePath, state.contents, state.entries);
    }, PREVIEW_DELAY_MS);
  });
}

function render(
  container: HTMLElement,
  store: VaultStore,
  activePath: string | null,
  contents: string,
  entries: FileMeta[],
): void {
  if (activePath === null) {
    container.textContent = "Open a note to see the preview";
    return;
  }

  if (activePath.toLowerCase().endsWith(".md")) {
    container.innerHTML = DOMPurify.sanitize(md.render(contents));
    decorateTaskLists(container);
    linkifyWikiLinks(container, entries, (target) => {
      void store.openFileAt(target, 1);
    });
    linkifyImages(container, activePath, store);
    renderBacklinks(container, store, activePath, entries);
    return;
  }

  const pre = document.createElement("pre");
  pre.className = "plain-text";
  pre.textContent = contents;
  container.replaceChildren(pre);
}

function decorateTaskLists(container: HTMLElement): void {
  for (const item of container.querySelectorAll("li")) {
    const text = item.textContent ?? "";
    const match = /^\[( |x|X)\]\s*/.exec(text);
    if (!match) {
      continue;
    }
    item.textContent = text.slice(match[0].length);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = match[1].toLowerCase() === "x";
    item.prepend(checkbox, document.createTextNode(" "));
  }
}

function linkifyImages(container: HTMLElement, activePath: string, store: VaultStore): void {
  const root = store.getState().root;
  if (!root) {
    return;
  }
  const baseDir = parentDir(activePath);
  for (const image of container.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (source === "" || /^(https?:|data:|blob:|asset:)/i.test(source)) {
      continue;
    }
    const resolved = resolveRelative(baseDir, decodeURIComponent(source));
    if (!resolved) {
      continue;
    }
    image.src = convertFileSrc(`${root.replace(/[\\/]+$/, "")}/${resolved}`);
    image.loading = "lazy";
    if (image.alt === "") {
      image.alt = resolved.split("/").pop() ?? "image";
    }
  }
}

export function resolveWikiTarget(entries: FileMeta[], target: string): string | null {
  const cleaned = target.trim().toLowerCase();
  if (cleaned === "") {
    return null;
  }
  const files = entries.filter((entry) => !entry.isDir);
  const exact = files.find((entry) => entry.relPath.toLowerCase() === cleaned);
  if (exact) {
    return exact.relPath;
  }
  const withExtension = files.find((entry) => entry.relPath.toLowerCase() === `${cleaned}.md`);
  if (withExtension) {
    return withExtension.relPath;
  }
  const byName = files.find((entry) => baseName(entry.relPath).toLowerCase() === cleaned);
  if (byName) {
    return byName.relPath;
  }
  return (
    files.find((entry) => baseName(entry.relPath).toLowerCase() === `${cleaned}.md`)?.relPath ??
    null
  );
}

function linkifyWikiLinks(
  container: HTMLElement,
  entries: FileMeta[],
  open: (relPath: string) => void,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("code, pre, a")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue?.includes("[[") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  const pattern = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;
  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(value)) !== null) {
      if (match.index > lastIndex) {
        fragment.append(value.slice(lastIndex, match.index));
      }
      const target = match[1].trim();
      const label = (match[2] ?? match[1]).trim();
      const resolved = resolveWikiTarget(entries, target);
      const anchor = document.createElement("a");
      anchor.textContent = label;
      if (resolved) {
        anchor.className = "wikilink";
        anchor.href = "#";
        anchor.title = `open ${resolved}`;
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          open(resolved);
        });
      } else {
        anchor.className = "wikilink missing";
        anchor.title = "unresolved link";
      }
      fragment.append(anchor);
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex === 0) {
      continue;
    }
    fragment.append(value.slice(lastIndex));
    textNode.replaceWith(fragment);
  }
}

function renderBacklinks(
  container: HTMLElement,
  store: VaultStore,
  activePath: string,
  entries: FileMeta[],
): void {
  const base = baseName(activePath);
  const baseWithoutExtension = base.replace(/\.md$/i, "");
  const matches = (link: string): boolean => {
    const cleaned = link.trim();
    return (
      cleaned === activePath ||
      cleaned === base ||
      cleaned === baseWithoutExtension ||
      cleaned.replace(/\.md$/i, "") === baseWithoutExtension
    );
  };

  const sources = entries.filter(
    (entry) => !entry.isDir && entry.relPath !== activePath && entry.metrics.links.some(matches),
  );
  if (sources.length === 0) {
    return;
  }

  const section = document.createElement("section");
  section.className = "backlinks";
  const heading = document.createElement("h4");
  heading.textContent = `Backlinks (${sources.length})`;
  section.append(heading);
  for (const source of sources) {
    const button = document.createElement("button");
    button.className = "backlink";
    button.textContent = source.relPath;
    button.addEventListener("click", () => {
      void store.openFile(source.relPath);
    });
    section.append(button);
  }
  container.append(section);
}
