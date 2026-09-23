import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import * as api from "./api";
import { config } from "./config";
import type { AppConfig } from "./config";
import { codeLanguages, detectLanguage } from "./languages";
import { fenceAt } from "./markdown";
import type { VaultStore } from "./store";

const tokenTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--bg-surface)",
      color: "var(--fg)",
      fontSize: "14px",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      padding: "12px 0",
      caretColor: "var(--fg)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-surface)",
      color: "var(--fg-muted)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--bg-hover)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--fg)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection)",
    },
    ".cm-tooltip-autocomplete": {
      border: "1px solid var(--border)",
      backgroundColor: "var(--bg-surface)",
      color: "var(--fg)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-fg)",
    },
  },
  { dark: window.matchMedia("(prefers-color-scheme: dark)").matches },
);

function fontSizeTheme(fontSize: number): ReturnType<typeof EditorView.theme> {
  return EditorView.theme({
    "&": { fontSize: `${fontSize}px` },
  });
}

const isMarkdownPath = (path: string): boolean => path.toLowerCase().endsWith(".md");

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function insertImages(root: string, files: File[], view: EditorView): Promise<void> {
  const stamp = Date.now();
  const snippets: string[] = [];
  let index = 0;
  for (const file of files) {
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension) {
      continue;
    }
    const relPath = `assets/${stamp}${index > 0 ? `-${index}` : ""}.${extension}`;
    const data = await fileToBase64(file);
    await api.writeBinary(root, relPath, data);
    snippets.push(`![${file.name || "image"}](${relPath})`);
    index += 1;
  }
  if (snippets.length === 0) {
    return;
  }
  const text = snippets.join("\n");
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
  });
  view.focus();
}

function collectClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }
  const files: File[] = [];
  for (const item of data.items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  if (files.length === 0) {
    files.push(...data.files);
  }
  return files;
}

export interface CompletionSources {
  wiki: (context: CompletionContext) => CompletionResult | null;
  tag: (context: CompletionContext) => CompletionResult | null;
  code: (context: CompletionContext) => CompletionResult | null;
}

export function buildCoreExtensions(sources: CompletionSources): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [sources.wiki, sources.tag, sources.code] }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
    ]),
  ];
}

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
}

export interface EditorOptions {
  onCursor?: (info: CursorInfo) => void;
}

export function createEditor(
  parent: HTMLElement,
  store: VaultStore,
  options: EditorOptions = {},
): EditorView {
  const language = new Compartment();
  const font = new Compartment();
  const wrap = new Compartment();
  const spellcheck = new Compartment();
  let applyingExternal = false;
  let saveTimer: number | undefined;
  let detectTimer: number | undefined;
  let currentPath: string | null = null;
  let knownTags: string[] = [];
  let detectLanguageLater = (): void => {};

  const collectTags = (): string[] => {
    const tags = new Set<string>();
    for (const entry of store.getState().entries) {
      if (entry.isDir) {
        continue;
      }
      for (const tag of entry.frontmatter.tags) {
        const clean = tag.trim();
        if (clean !== "") {
          tags.add(clean);
        }
      }
    }
    return [...tags];
  };

  const sources: CompletionSources = {
    wiki: (context) => {
      const before = context.matchBefore(/\[\[([^[\]\n]*)$/);
      if (!before) {
        return null;
      }
      const query = before.text.slice(2).toLowerCase();
      const options = store
        .getState()
        .entries.filter((entry) => !entry.isDir)
        .map((entry) => entry.relPath.replace(/\.md$/i, ""))
        .filter((path) => query === "" || path.toLowerCase().includes(query))
        .slice(0, 100)
        .map((path) => ({ label: path, apply: `${path}]]` }));
      return { from: before.from + 2, options, validFor: /^[^[\]\n]*$/ };
    },
    tag: (context) => {
      const before = context.matchBefore(/(?:^|\s)#([\w-]*)$/);
      if (!before) {
        return null;
      }
      const hash = before.text.lastIndexOf("#");
      const query = before.text.slice(hash + 1).toLowerCase();
      const options = knownTags
        .filter((tag) => query === "" || tag.toLowerCase().includes(query))
        .slice(0, 60)
        .map((tag) => ({ label: tag }));
      return { from: before.from + hash + 1, options, validFor: /^[\w-]*$/ };
    },
    code: (context) => {
      const before = context.matchBefore(/^```([\w-]*)$/);
      if (!before) {
        return null;
      }
      const query = before.text.slice(3).toLowerCase();
      const options = codeLanguages()
        .filter((language) => query === "" || language.startsWith(query))
        .map((language) => ({ label: language }));
      return { from: before.from + 3, options, validFor: /^[\w-]*$/ };
    },
  };

  const buildExtensions = () => [
    ...buildCoreExtensions(sources),
    tokenTheme,
    font.of(fontSizeTheme(config.getState().config.editor.fontSize)),
    wrap.of(config.getState().config.editor.wordWrap ? EditorView.lineWrapping : []),
    language.of([]),
    spellcheck.of(
      EditorView.contentAttributes.of({
        spellcheck: config.getState().config.editor.spellCheck ? "true" : "false",
      }),
    ),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const files = collectClipboardFiles(event.clipboardData);
        const root = store.getState().root;
        if (files.length === 0 || !root) {
          return false;
        }
        event.preventDefault();
        void insertImages(root, files, view);
        return true;
      },
      drop: (event, view) => {
        const files = collectClipboardFiles(event.dataTransfer);
        const root = store.getState().root;
        if (files.length === 0 || !root) {
          return false;
        }
        event.preventDefault();
        void insertImages(root, files, view);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal) {
        detectLanguageLater();
        store.setContents(update.state.doc.toString());
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void store.saveActive();
        }, config.getState().config.editor.autosaveDelayMs);
      }
      if (update.selectionSet || update.docChanged) {
        const range = update.state.selection.main;
        const line = update.state.doc.lineAt(range.head);
        options.onCursor?.({
          line: line.number,
          column: range.head - line.from + 1,
          selected: range.to - range.from,
        });
      }
    }),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          void store.saveActive();
          return true;
        },
      },
    ]),
  ];

  const states = new Map<string, EditorState>();
  let lastEntriesRef: unknown;
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: buildExtensions() }),
  });

  detectLanguageLater = () => {
    window.clearTimeout(detectTimer);
    detectTimer = window.setTimeout(() => {
      if (currentPath === null || !isMarkdownPath(currentPath)) {
        return;
      }
      const fence = fenceAt(view.state.doc, view.state.selection.main.head);
      if (!fence) {
        return;
      }
      const language = detectLanguage(view.state.sliceDoc(fence.contentFrom, fence.contentTo));
      if (language) {
        view.dispatch({ changes: { from: fence.infoFrom, to: fence.infoTo, insert: language } });
      }
    }, 500);
  };

  store.subscribe((state) => {
    if (state.entries !== lastEntriesRef) {
      lastEntriesRef = state.entries;
      knownTags = collectTags();
    }

    if (state.activePath === null) {
      currentPath = null;
      return;
    }

    if (state.activePath !== currentPath) {
      if (currentPath) {
        states.set(currentPath, view.state);
      }
      const cached = states.get(state.activePath);
      applyingExternal = true;
      if (cached) {
        view.setState(cached);
      } else {
        view.setState(EditorState.create({ doc: state.contents, extensions: buildExtensions() }));
      }
      view.dispatch({
        effects: language.reconfigure(isMarkdownPath(state.activePath) ? markdown() : []),
      });
      applyingExternal = false;
      currentPath = state.activePath;
    } else {
      const current = view.state.doc.toString();
      if (state.contents !== current) {
        applyingExternal = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: state.contents },
        });
        applyingExternal = false;
      }
    }

    const reveal = store.consumeReveal();
    if (reveal && reveal.path === state.activePath) {
      const lineNumber = Math.max(1, Math.min(reveal.line, view.state.doc.lines));
      const line = view.state.doc.line(lineNumber);
      view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
      view.focus();
    }
  });

  const applyEditorConfig = (value: AppConfig): void => {
    view.dispatch({
      effects: [
        font.reconfigure(fontSizeTheme(value.editor.fontSize)),
        wrap.reconfigure(value.editor.wordWrap ? EditorView.lineWrapping : []),
        spellcheck.reconfigure(
          EditorView.contentAttributes.of({
            spellcheck: value.editor.spellCheck ? "true" : "false",
          }),
        ),
      ],
    });
  };
  config.subscribe((state) => applyEditorConfig(state.config));

  return view;
}

export interface Viewer {
  load(path: string, contents: string): void;
  clear(): void;
}

export function createViewer(parent: HTMLElement): Viewer {
  const language = new Compartment();
  const emptySources: CompletionSources = { wiki: () => null, tag: () => null, code: () => null };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        ...buildCoreExtensions(emptySources),
        tokenTheme,
        EditorView.editable.of(false),
        language.of([]),
      ],
    }),
  });

  return {
    load(path: string, contents: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: contents },
        effects: language.reconfigure(isMarkdownPath(path) ? markdown() : []),
      });
    },
    clear(): void {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    },
  };
}
