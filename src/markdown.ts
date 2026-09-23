import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { detectLanguage } from "./languages";

export interface Fence {
  infoFrom: number;
  infoTo: number;
  language: string;
  contentFrom: number;
  contentTo: number;
}

export function insertCodeBlock(view: EditorView): void {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const language = detectLanguage(selected) ?? "";
  const body = selected === "" ? "" : `\n${selected}\n`;
  const insert = `\`\`\`${language}\n${body}\`\`\`\n`;
  const cursor = range.from + 3 + language.length + 1 + (selected === "" ? 0 : 1);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: cursor },
  });
  view.focus();
}

const FENCE_OPEN = /^\s*(?:`{3,}|~{3,})[ \t]*(\S*)/;
const FENCE_CLOSE = /^\s*(?:`{3,}|~{3,})[ \t]*$/;

export function fenceAt(doc: Text, pos: number): Fence | null {
  let opener = 0;
  for (let number = doc.lineAt(pos).number; number >= 1; number -= 1) {
    if (FENCE_OPEN.test(doc.line(number).text)) {
      opener = number;
      break;
    }
  }
  if (opener === 0) {
    return null;
  }

  const line = doc.line(opener);
  const language = FENCE_OPEN.exec(line.text)?.[1] ?? "";
  if (language !== "") {
    return null;
  }

  for (let number = opener + 1; number <= doc.lines; number += 1) {
    const next = doc.line(number);
    if (!FENCE_CLOSE.test(next.text)) {
      continue;
    }
    if (next.to <= pos) {
      return null;
    }
    return {
      infoFrom: line.to,
      infoTo: line.to,
      language,
      contentFrom: line.to + 1,
      contentTo: next.from,
    };
  }

  return {
    infoFrom: line.to,
    infoTo: line.to,
    language,
    contentFrom: line.to + 1,
    contentTo: doc.length,
  };
}

export function wrapSelection(view: EditorView, before: string, after: string): void {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const insert = `${before}${selected}${after}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: {
      anchor: range.from + before.length,
      head: range.from + before.length + selected.length,
    },
  });
  view.focus();
}

export function prefixLines(view: EditorView, prefix: string): void {
  const range = view.state.selection.main;
  const startLine = view.state.doc.lineAt(range.from);
  const endLine = view.state.doc.lineAt(range.to);
  const changes: { from: number; to?: number; insert: string }[] = [];

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    if (line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      changes.push({ from: line.from, insert: prefix });
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

export function toggleHeading(view: EditorView, level: number): void {
  const prefix = `${"#".repeat(level)} `;
  const range = view.state.selection.main;
  const startLine = view.state.doc.lineAt(range.from);
  const endLine = view.state.doc.lineAt(range.to);
  const changes: { from: number; to?: number; insert: string }[] = [];

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const existing = /^(#{1,6})\s+/.exec(line.text);
    if (existing && existing[1].length === level) {
      changes.push({ from: line.from, to: line.from + existing[0].length, insert: "" });
    } else if (existing) {
      changes.push({ from: line.from, to: line.from + existing[0].length, insert: prefix });
    } else {
      changes.push({ from: line.from, insert: prefix });
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

export function insertLink(view: EditorView): void {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const label = selected === "" ? "text" : selected;
  const insert = `[${label}](url)`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: {
      anchor: range.from + label.length + 3,
      head: range.from + label.length + 6,
    },
  });
  view.focus();
}
