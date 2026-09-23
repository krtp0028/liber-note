import { commands } from "../commands";
import { baseName } from "../paths";
import type { VaultStore } from "../store";

export function mountTabs(store: VaultStore, tabBar: HTMLElement): { render: () => void } {
  const cycleTab = (delta: number): void => {
    const { tabs, activePath } = store.getState();
    if (tabs.length === 0 || !activePath) {
      return;
    }
    const index = tabs.indexOf(activePath);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) {
      void store.openFile(next);
    }
  };

  let lastClosedTab: string | null = null;
  const closeTab = (path: string): void => {
    lastClosedTab = path;
    store.closeTab(path);
  };

  const render = (): void => {
    const { tabs, activePath } = store.getState();
    tabBar.hidden = tabs.length === 0;
    const elements = tabs.map((path, index) => {
      const tab = document.createElement("div");
      tab.className = "tab";
      tab.draggable = true;
      if (path === activePath) {
        tab.classList.add("active");
      }
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = baseName(path);
      label.title = path;
      tab.append(label);
      if (store.isTabDirty(path)) {
        const dot = document.createElement("span");
        dot.className = "tab-dirty";
        dot.textContent = "●";
        tab.append(dot);
      }
      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(path);
      });
      tab.append(close);
      tab.addEventListener("click", () => {
        void store.openFile(path);
      });
      tab.addEventListener("auxclick", (event) => {
        if (event.button === 1) {
          event.preventDefault();
          closeTab(path);
        }
      });
      tab.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-liber-tab", String(index));
      });
      tab.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      tab.addEventListener("drop", (event) => {
        const raw = event.dataTransfer?.getData("application/x-liber-tab");
        if (raw === undefined || raw === "") {
          return;
        }
        event.preventDefault();
        store.moveTab(Number(raw), index);
      });
      return tab;
    });
    tabBar.replaceChildren(...elements);
  };

  commands.register({
    id: "tab.close",
    title: "Close tab",
    run: () => {
      const active = store.getState().activePath;
      if (active) {
        closeTab(active);
      }
    },
  });
  commands.register({ id: "tab.next", title: "Next tab", run: () => cycleTab(1) });
  commands.register({ id: "tab.prev", title: "Previous tab", run: () => cycleTab(-1) });
  commands.register({
    id: "tab.reopen_last",
    title: "Reopen last closed tab",
    run: async () => {
      if (lastClosedTab) {
        await store.openFile(lastClosedTab);
      }
    },
  });

  return { render };
}
