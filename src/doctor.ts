import * as api from "./api";
import type { DoctorChange, DoctorIssue, DoctorPlan } from "./api";
import { el } from "./app/dom";
import { promptText } from "./prompt";

const LABELS: Record<string, string> = {
  "metadata-unknown-key": "Unknown frontmatter keys",
  "metadata-type": "Bad value types",
  "link-dead": "Dead links",
  "link-ambiguous": "Ambiguous links",
  "link-case": "Link casing",
  "mirror-redundant": "Redundant mirrors",
  "mirror-missing": "Missing mirror folders",
  "order-conflict": "Duplicate sibling order",
  "orphan-note": "Orphan notes",
  "attachment-missing": "Missing attachments",
  "attachment-orphan": "Unreferenced attachments",
  "attachment-duplicate": "Duplicate attachments",
  "stale-tasks": "Stale open tasks",
};

const FIXES: { fix: string; label: string; payload?: Record<string, string> }[] = [
  { fix: "normalize", label: "Normalize whitespace and types" },
  { fix: "remove-mirrors", label: "Remove redundant also_under" },
  { fix: "link-case", label: "Match link casing to files" },
  { fix: "dedupe-assets", label: "Dedupe identical attachments" },
  { fix: "dead-links", label: "Create stubs for dead links", payload: { mode: "stub" } },
  { fix: "dead-links", label: "Downgrade dead links to text", payload: { mode: "plain" } },
];

let activeOverlay: HTMLElement | null = null;

export function openDoctorPanel(
  parent: HTMLElement,
  getRoot: () => string | null,
  onOpen: (relPath: string, line: number) => void,
  onNotice: (text: string) => void,
): void {
  activeOverlay?.remove();
  activeOverlay = null;

  const overlay = el("div", "palette");
  const panel = el("div", "palette-panel doctor-panel");
  const body = el("div", "doctor-body");
  panel.append(body);
  overlay.append(panel);

  const close = (): void => {
    overlay.remove();
    activeOverlay = null;
  };
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && activeOverlay === overlay) {
        close();
      }
    },
    { once: true },
  );
  parent.append(overlay);
  activeOverlay = overlay;

  const showPlan = (fix: string, payload: Record<string, string>, label: string): void => {
    const root = getRoot();
    if (!root) {
      return;
    }
    void api
      .doctorPlan(root, fix, payload)
      .then((plan) => renderPlan(plan, label, payload))
      .catch((error: unknown) => onNotice(`doctor: ${String(error)}`));
  };

  const renderPlan = (plan: DoctorPlan, label: string, payload: Record<string, string>): void => {
    body.replaceChildren();
    if (plan.count === 0) {
      const clean = el("div", "doctor-clean");
      clean.append(document.createTextNode("Nothing to fix."));
      body.append(
        clean,
        backButton(() => void scan()),
      );
      return;
    }
    body.append(heading(`${label} — ${plan.count} change(s)`, ""));
    const list = el("ul", "doctor-changes");
    for (const change of plan.changes) {
      list.append(changeRow(change));
    }
    body.append(list);

    const actions = el("div", "doctor-actions");
    const apply = el("button", "button");
    apply.textContent = `Apply ${plan.count} change(s)`;
    apply.addEventListener("click", () => {
      const root = getRoot();
      if (!root) {
        return;
      }
      void api
        .doctorApply(root, plan.fix, payload)
        .then((count) => {
          onNotice(`doctor: applied ${count} change(s)`);
          return scan();
        })
        .catch((error: unknown) => onNotice(`doctor: ${String(error)}`));
    });
    actions.append(
      apply,
      backButton(() => void scan()),
    );
    body.append(actions);
  };

  const changeRow = (change: DoctorChange): HTMLElement => {
    const item = document.createElement("li");
    const path = document.createElement("strong");
    path.textContent = `${change.relPath} · ${change.action} · ${change.summary}`;
    item.append(path);
    if (change.before || change.after) {
      item.append(diff(change.before, change.after));
    }
    return item;
  };

  const scan = async (): Promise<void> => {
    const root = getRoot();
    body.replaceChildren();
    if (!root) {
      const clean = el("div", "doctor-clean");
      clean.append(document.createTextNode("Open a vault first."));
      body.append(clean);
      return;
    }
    try {
      render(await api.doctorAudit(root));
    } catch (error: unknown) {
      onNotice(`doctor: ${String(error)}`);
    }
  };

  const render = (issues: DoctorIssue[]): void => {
    body.replaceChildren();
    const header = heading("Vault doctor", "Rescan");
    header.lastElementChild?.addEventListener("click", () => void scan());
    body.append(header);

    if (issues.length === 0) {
      const clean = el("div", "doctor-clean");
      clean.append(document.createTextNode("No issues found."));
      body.append(clean);
      return;
    }

    const counts = new Map<string, number>();
    for (const issue of issues) {
      counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
    }

    const list = el("ul", "doctor-issues");
    for (const [kind, count] of counts) {
      const section = document.createElement("li");
      section.className = "doctor-group";
      section.append(heading(LABELS[kind] ?? kind, `${count}`));
      for (const issue of issues.filter((item) => item.kind === kind).slice(0, 50)) {
        const item = document.createElement("div");
        item.className = `doctor-issue ${issue.severity}`;
        item.textContent = `${issue.relPath}${issue.line > 0 ? `:${issue.line}` : ""} — ${issue.message}`;
        item.addEventListener("click", () => {
          close();
          onOpen(issue.relPath, issue.line || 1);
        });
        section.append(item);
      }
      list.append(section);
    }
    body.append(list);

    const actions = el("div", "doctor-actions");
    for (const entry of FIXES) {
      const button = el("button", "button");
      button.textContent = entry.label;
      button.addEventListener("click", async () => {
        if (entry.fix === "rename-key") {
          return;
        }
        showPlan(entry.fix, entry.payload ?? {}, entry.label);
      });
      actions.append(button);
    }
    const rename = el("button", "button");
    rename.textContent = "Rename a frontmatter key…";
    rename.addEventListener("click", () => {
      void (async () => {
        const from = await promptText(overlay, { title: "Current key" });
        if (!from) {
          return;
        }
        const to = await promptText(overlay, { title: "New key" });
        if (!to) {
          return;
        }
        showPlan("rename-key", { from, to }, `Rename ${from} → ${to}`);
      })();
    });
    actions.append(rename);
    body.append(actions);
  };

  void scan();
}

function heading(title: string, action: string): HTMLElement {
  const row = el("div", "doctor-heading");
  const text = document.createElement("strong");
  text.textContent = title;
  row.append(text);
  if (action !== "") {
    const button = el("button", "button");
    button.textContent = action;
    row.append(button);
  }
  return row;
}

function backButton(onClick: () => void): HTMLElement {
  const button = el("button", "button");
  button.textContent = "Back";
  button.addEventListener("click", onClick);
  return button;
}

function diff(before: string, after: string): HTMLElement {
  const box = el("div", "doctor-diff");
  const old = document.createElement("div");
  old.className = "doctor-before";
  old.textContent = `- ${before}`;
  const next = document.createElement("div");
  next.className = "doctor-after";
  next.textContent = `+ ${after}`;
  box.append(old, next);
  return box;
}
