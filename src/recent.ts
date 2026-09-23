const RECENT_KEY = "liber.recent-vaults";
const MAX_RECENT = 8;

export function rememberVault(root: string): void {
  const list = recentVaults().filter((entry) => entry !== root);
  list.unshift(root);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

export function recentVaults(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (raw === null) {
      return [];
    }
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list)
      ? list.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export class RecentVaultsPanel {
  private readonly overlay: HTMLElement;
  private readonly list: HTMLElement;
  private readonly onOpen: (root: string) => void;

  constructor(parent: HTMLElement, onOpen: (root: string) => void) {
    this.onOpen = onOpen;
    this.overlay = document.createElement("div");
    this.overlay.className = "palette";
    this.overlay.hidden = true;

    const panel = document.createElement("div");
    panel.className = "palette-panel";
    const header = document.createElement("div");
    header.className = "search-header";
    const title = document.createElement("strong");
    title.textContent = "Recent vaults";
    header.append(title);

    this.list = document.createElement("ul");
    this.list.className = "palette-list";

    panel.append(header, this.list);
    this.overlay.append(panel);
    this.overlay.addEventListener("mousedown", (event) => {
      if (event.target === this.overlay) {
        this.close();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.overlay.hidden) {
        this.close();
      }
    });
    parent.append(this.overlay);
  }

  open(): void {
    const vaults = recentVaults();
    const items = vaults.map((root) => {
      const item = document.createElement("li");
      item.className = "palette-item";
      item.textContent = root;
      item.addEventListener("click", () => {
        this.close();
        this.onOpen(root);
      });
      return item;
    });
    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "palette-item";
      empty.textContent = "No recent vaults";
      items.push(empty);
    }
    this.list.replaceChildren(...items);
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }
}
