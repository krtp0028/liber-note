import type { EditorView } from "@codemirror/view";
import { commands } from "../commands";
import {
  insertCodeBlock,
  insertLink,
  prefixLines,
  toggleHeading,
  wrapSelection,
} from "../markdown";
import type { VaultStore } from "../store";

export function mountMarkdownTools(options: {
  bar: HTMLElement;
  store: VaultStore;
  view: EditorView;
  run: (id: string) => void;
  divider: () => HTMLElement;
}): void {
  const { bar, store, view, run, divider } = options;

  const make = (label: string, title: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "format-button";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", action);
    return button;
  };

  bar.append(
    make("B", "Bold (Ctrl+B)", () => run("markdown.bold")),
    make("I", "Italic (Ctrl+I)", () => run("markdown.italic")),
    make("S", "Strikethrough", () => run("markdown.strike")),
    make("</>", "Inline code (Ctrl+E)", () => run("markdown.code")),
    make("```", "Code block (Ctrl+Shift+E)", () => run("markdown.codeBlock")),
    make("Link", "Insert link (Ctrl+K)", () => run("markdown.link")),
    divider(),
    make("H1", "Heading 1", () => run("markdown.h1")),
    make("H2", "Heading 2", () => run("markdown.h2")),
    make("H3", "Heading 3", () => run("markdown.h3")),
    divider(),
    make("•", "Bullet list", () => run("markdown.list")),
    make("☐", "Task item", () => run("markdown.task")),
    make("❝", "Quote", () => run("markdown.quote")),
  );

  const withEditor =
    (action: () => void): (() => void) =>
    () => {
      if (store.getState().activePath) {
        action();
      }
    };

  commands.register({
    id: "markdown.bold",
    title: "Bold",
    run: withEditor(() => wrapSelection(view, "**", "**")),
  });
  commands.register({
    id: "markdown.italic",
    title: "Italic",
    run: withEditor(() => wrapSelection(view, "*", "*")),
  });
  commands.register({
    id: "markdown.strike",
    title: "Strikethrough",
    run: withEditor(() => wrapSelection(view, "~~", "~~")),
  });
  commands.register({
    id: "markdown.code",
    title: "Inline code",
    run: withEditor(() => wrapSelection(view, "`", "`")),
  });
  commands.register({
    id: "markdown.codeBlock",
    title: "Code block",
    run: withEditor(() => insertCodeBlock(view)),
  });
  commands.register({
    id: "markdown.link",
    title: "Insert link",
    run: withEditor(() => insertLink(view)),
  });
  commands.register({
    id: "markdown.h1",
    title: "Heading 1",
    run: withEditor(() => toggleHeading(view, 1)),
  });
  commands.register({
    id: "markdown.h2",
    title: "Heading 2",
    run: withEditor(() => toggleHeading(view, 2)),
  });
  commands.register({
    id: "markdown.h3",
    title: "Heading 3",
    run: withEditor(() => toggleHeading(view, 3)),
  });
  commands.register({
    id: "markdown.list",
    title: "Bullet list",
    run: withEditor(() => prefixLines(view, "- ")),
  });
  commands.register({
    id: "markdown.task",
    title: "Task item",
    run: withEditor(() => prefixLines(view, "- [ ] ")),
  });
  commands.register({
    id: "markdown.quote",
    title: "Quote",
    run: withEditor(() => prefixLines(view, "> ")),
  });
}
