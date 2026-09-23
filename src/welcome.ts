import { el } from "./app/dom";
import type { VaultStore } from "./store";

const STEPS: [string, string][] = [
  ["Open a folder of Markdown files", "Ctrl+O — any folder works, even one you keep in your repo."],
  [
    "Build the tree with frontmatter",
    "Ctrl+N for a note, then add parent:, also_under: or tags: to shape it.",
  ],
  ["Drop in code", "Ctrl+Shift+E inserts a fenced block and writes the detected language into it."],
];

export function mountWelcome(app: HTMLElement, store: VaultStore): void {
  const overlay = el("div", "palette");
  const panel = el("div", "palette-panel welcome-panel");
  const body = el("div", "welcome-body");

  const title = document.createElement("h2");
  title.textContent = "Liber";
  const tagline = el("p", "welcome-tagline");
  tagline.textContent = "Hierarchical Markdown notes that stay plain files you own.";

  const quote = el("blockquote", "welcome-quote");
  quote.append(
    document.createTextNode("“In every walk with nature one receives far more than he seeks.”"),
  );
  const attribution = document.createElement("cite");
  attribution.textContent = "— John Muir";
  quote.append(attribution);

  const list = el("ol", "welcome-steps");
  for (const [head, detail] of STEPS) {
    const item = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = head;
    item.append(strong, document.createTextNode(` ${detail}`));
    list.append(item);
  }

  const sample = el("p", "welcome-sample");
  sample.textContent = "Running from source? docs/example-vault/ is a ready-made vault to open.";

  body.append(title, tagline, quote, list, sample);
  panel.append(body);
  overlay.append(panel);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      overlay.hidden = true;
    }
  });
  app.append(overlay);

  store.subscribe((state) => {
    overlay.hidden = state.root !== null;
  });
}
