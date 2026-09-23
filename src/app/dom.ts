import { icon } from "../icons";

export function el(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

export interface Layout {
  app: HTMLElement;
  openButton: HTMLButtonElement;
  addNodeButton: HTMLButtonElement;
  addChildButton: HTMLButtonElement;
  newFolderButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  searchButton: HTMLButtonElement;
  quickOpenButton: HTMLButtonElement;
  tasksButton: HTMLButtonElement;
  previewButton: HTMLButtonElement;
  configButton: HTMLButtonElement;
  divider: () => HTMLElement;
  notice: HTMLElement;
  dirty: HTMLElement;
  errorBanner: HTMLElement;
  conflictBanner: HTMLElement;
  tabBar: HTMLElement;
  sidebar: HTMLElement;
  treeSearch: HTMLInputElement;
  treeContainer: HTMLElement;
  tagPanel: HTMLElement;
  tagHeader: HTMLButtonElement;
  tagList: HTMLElement;
  docArea: HTMLElement;
  formatBar: HTMLElement;
  editorHost: HTMLElement;
  secondaryPane: HTMLElement;
  splitter: HTMLElement;
  previewPane: HTMLElement;
  statusVault: HTMLElement;
  statusFile: HTMLElement;
  statusType: HTMLElement;
  tagChips: HTMLElement;
  filterBadge: HTMLElement;
  statusWords: HTMLElement;
  statusCursor: HTMLElement;
}

export function buildLayout(root: HTMLElement): Layout {
  const app = el("div", "app");
  const topbar = el("header", "topbar");
  const brand = el("span", "brand");
  brand.textContent = "Liber";

  const iconButton = (name: Parameters<typeof icon>[0], title: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = "toolbar-button";
    button.title = title;
    button.append(icon(name, 15));
    return button;
  };

  const openButton = iconButton("folder", "Open folder (Ctrl+O)");
  const addNodeButton = iconButton("add-node", "Add node after selected (Ctrl+N)");
  const addChildButton = iconButton("add-child", "Add child node (Ctrl+Shift+N)");
  const newFolderButton = iconButton("new-folder", "New folder (Ctrl+Alt+N)");
  const saveButton = iconButton("save", "Save (Ctrl+S)");
  const undoButton = iconButton("undo", "Undo last file operation");
  const deleteButton = iconButton("trash", "Delete node (Delete)");
  const searchButton = iconButton("search", "Search vault (Ctrl+Shift+F)");
  const quickOpenButton = iconButton("go-to", "Quick open (Ctrl+P)");
  const tasksButton = iconButton("check", "Open tasks");
  const previewButton = iconButton("preview", "Cycle preview position (Ctrl+Shift+V)");
  const configButton = iconButton("settings", "Config health");

  const divider = (): HTMLElement => el("span", "sep");
  const notice = el("span", "notice");
  notice.hidden = true;
  const dirty = el("span", "dirty");
  dirty.textContent = "●";
  dirty.title = "Unsaved changes";
  dirty.hidden = true;

  topbar.append(
    brand,
    divider(),
    openButton,
    divider(),
    addNodeButton,
    addChildButton,
    newFolderButton,
    divider(),
    saveButton,
    undoButton,
    deleteButton,
    divider(),
    searchButton,
    quickOpenButton,
    tasksButton,
    divider(),
    previewButton,
    configButton,
    el("span", "spacer"),
    notice,
    dirty,
  );

  const errorBanner = el("div", "error-banner");
  errorBanner.hidden = true;

  const conflictBanner = el("div", "conflict-banner");
  conflictBanner.hidden = true;

  const tabBar = el("div", "tab-bar");
  tabBar.hidden = true;

  const workspace = el("div", "workspace");
  const sidebar = el("aside", "sidebar");
  const treeSearch = document.createElement("input");
  treeSearch.className = "tree-search";
  treeSearch.placeholder = "Filter nodes...";
  const treeContainer = el("div", "tree-container");
  const tagPanel = el("div", "tag-panel");
  const tagHeader = document.createElement("button");
  tagHeader.className = "tag-header";
  tagHeader.textContent = "Tags";
  const tagList = el("div", "tag-list");
  tagPanel.append(tagHeader, tagList);
  tagPanel.hidden = true;
  tagHeader.addEventListener("click", () => {
    tagList.hidden = !tagList.hidden;
  });
  sidebar.append(treeSearch, treeContainer, tagPanel);

  const docArea = el("div", "doc-area");
  const editorPane = el("main", "editor-pane");
  const formatBar = el("div", "format-bar");
  const editorHost = el("div", "editor-host");
  editorPane.append(formatBar, editorHost);
  const secondaryPane = el("section", "secondary-pane");
  secondaryPane.hidden = true;
  const splitter = el("div", "splitter");
  const previewPane = el("section", "preview-pane");
  previewPane.textContent = "Open a note to see the preview";
  docArea.append(editorPane, secondaryPane, splitter, previewPane);

  const statusBar = el("footer", "status-bar");
  const statusVault = el("span", "status-vault");
  const statusFile = el("span", "status-file");
  const statusType = el("span", "status-type");
  const tagChips = el("span", "tag-chips");
  const filterBadge = el("span", "filter-badge");
  filterBadge.hidden = true;
  const statusWords = el("span", "status-words");
  const statusCursor = el("span", "status-cursor");
  statusBar.append(
    statusVault,
    divider(),
    statusFile,
    statusType,
    el("span", "spacer"),
    tagChips,
    filterBadge,
    statusWords,
    statusCursor,
  );

  workspace.append(sidebar, docArea);
  app.append(topbar, tabBar, errorBanner, conflictBanner, workspace, statusBar);
  root.replaceChildren(app);

  return {
    app,
    openButton,
    addNodeButton,
    addChildButton,
    newFolderButton,
    saveButton,
    undoButton,
    deleteButton,
    searchButton,
    quickOpenButton,
    tasksButton,
    previewButton,
    configButton,
    divider,
    notice,
    dirty,
    errorBanner,
    conflictBanner,
    tabBar,
    sidebar,
    treeSearch,
    treeContainer,
    tagPanel,
    tagHeader,
    tagList,
    docArea,
    formatBar,
    editorHost,
    secondaryPane,
    splitter,
    previewPane,
    statusVault,
    statusFile,
    statusType,
    tagChips,
    filterBadge,
    statusWords,
    statusCursor,
  };
}
