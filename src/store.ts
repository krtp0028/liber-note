import * as api from "./api";
import type { FileMeta } from "./api";

export interface VaultState {
  root: string | null;
  entries: FileMeta[];
  tabs: string[];
  activePath: string | null;
  contents: string;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}

export type VaultListener = (state: VaultState) => void;

const INITIAL_STATE: VaultState = {
  root: null,
  entries: [],
  tabs: [],
  activePath: null,
  contents: "",
  dirty: false,
  loading: false,
  error: null,
};

export class VaultStore {
  private state: VaultState = INITIAL_STATE;
  private readonly listeners = new Set<VaultListener>();
  private readonly tabContents = new Map<string, string>();
  private readonly tabDirty = new Set<string>();
  private pendingReveal: { path: string; line: number } | null = null;

  getState(): VaultState {
    return this.state;
  }

  subscribe(listener: VaultListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async openVault(root: string): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const entries = await api.scanVault(root);
      this.tabContents.clear();
      this.tabDirty.clear();
      this.setState({
        root,
        entries,
        tabs: [],
        activePath: null,
        contents: "",
        dirty: false,
        loading: false,
      });
    } catch (error) {
      this.setState({ loading: false, error: describeError(error), root: null, entries: [] });
    }
  }

  async openFile(relPath: string): Promise<void> {
    const { root, tabs } = this.state;
    if (!root) {
      return;
    }
    const nextTabs = tabs.includes(relPath) ? tabs : [...tabs, relPath];
    const cached = this.tabContents.get(relPath);
    if (cached !== undefined) {
      this.setState({
        tabs: nextTabs,
        activePath: relPath,
        contents: cached,
        dirty: this.tabDirty.has(relPath),
      });
      return;
    }

    this.setState({
      loading: true,
      error: null,
      tabs: nextTabs,
      activePath: relPath,
      contents: "",
      dirty: false,
    });
    try {
      const contents = await api.readFile(root, relPath);
      this.tabContents.set(relPath, contents);
      if (this.state.activePath === relPath) {
        this.setState({ contents, loading: false });
      }
    } catch (error) {
      this.setState({ loading: false, error: describeError(error) });
    }
  }

  async openFileAt(relPath: string, line: number): Promise<void> {
    this.pendingReveal = { path: relPath, line };
    await this.openFile(relPath);
  }

  consumeReveal(): { path: string; line: number } | null {
    const reveal = this.pendingReveal;
    this.pendingReveal = null;
    return reveal;
  }

  setContents(contents: string): void {
    const active = this.state.activePath;
    if (!active) {
      return;
    }
    this.tabContents.set(active, contents);
    this.tabDirty.add(active);
    this.setState({ contents, dirty: true });
  }

  openWelcome(path: string, contents: string): void {
    this.tabContents.set(path, contents);
    this.setState({
      activePath: path,
      tabs: [path],
      contents,
      dirty: false,
      loading: false,
    });
  }

  async saveActive(): Promise<void> {
    const { root, activePath, contents } = this.state;
    if (!root || !activePath) {
      return;
    }
    try {
      await api.writeFile(root, activePath, contents);
      this.tabDirty.delete(activePath);
      this.setState({ dirty: false });
    } catch (error) {
      this.setState({ error: describeError(error) });
    }
  }

  async refresh(): Promise<void> {
    const { root } = this.state;
    if (!root) {
      return;
    }
    try {
      const entries = await api.scanVault(root);
      this.setState({ entries });
    } catch (error) {
      this.setState({ error: describeError(error) });
    }
  }

  closeTab(relPath?: string): void {
    const target = relPath ?? this.state.activePath;
    if (!target) {
      return;
    }
    const tabs = this.state.tabs.filter((tab) => tab !== target);
    this.tabContents.delete(target);
    this.tabDirty.delete(target);

    if (this.state.activePath !== target) {
      this.setState({ tabs });
      return;
    }
    const next = tabs.at(-1) ?? null;
    if (next === null) {
      this.setState({ tabs, activePath: null, contents: "", dirty: false });
      return;
    }
    this.setState({
      tabs,
      activePath: next,
      contents: this.tabContents.get(next) ?? "",
      dirty: this.tabDirty.has(next),
    });
  }

  clearActive(): void {
    this.closeTab();
  }

  isTabDirty(relPath: string): boolean {
    return this.tabDirty.has(relPath);
  }

  moveTab(from: number, to: number): void {
    const tabs = [...this.state.tabs];
    if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length || from === to) {
      return;
    }
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    this.setState({ tabs });
  }

  setTabContents(relPath: string, contents: string): void {
    if (this.tabDirty.has(relPath)) {
      return;
    }
    this.tabContents.set(relPath, contents);
    if (this.state.activePath === relPath && this.state.contents !== contents) {
      this.setState({ contents });
    }
  }

  clearError(): void {
    this.setState({ error: null });
  }

  reportError(error: unknown): void {
    this.setState({ error: describeError(error) });
  }

  private setState(partial: Partial<VaultState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
