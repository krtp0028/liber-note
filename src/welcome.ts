export const WELCOME_PATH = "Welcome.md";

export const WELCOME_MD = `# Welcome to Liber

Lightweight hierarchical Markdown notes. Your notes stay plain \`.md\` files in a folder you own — no account, no sync service, no lock-in. **This page is an ordinary note: edit it, format it, throw it away when you open a vault.**

## Step 1 — choose a root folder

Everything lives under one **root folder**: the folder you pick is the top of the tree, its subfolders become branches, and every \`.md\` file inside becomes a node. Pick an empty folder to start, or an existing one you already keep notes in — either way the files stay yours.

- **Choose root folder…** in the sidebar, or
- **Ctrl+O**, or the folder button in the toolbar

## Step 2 — add nodes

- **Ctrl+N** — node after the selected one
- **Ctrl+Shift+N** — child node of the selected one
- **Ctrl+Alt+N** — new folder
- Or the **+**, **+child**, and **folder** buttons in the toolbar

Folders are the tree, files are nodes. Frontmatter places a node anywhere in it:

\`\`\`yaml
Projects/Alpha.md
---
parent: Projects        # logical parent; the file stays where it is
also_under: [Topics]   # extra placements, no file duplication
tags: [project-alpha]  # inherited by everything under this node
order: 1               # sibling order inside its folder
---
\`\`\`

The result is one file that appears in several places, and a branch note that lends its tags to its whole subtree. Drag a node onto a folder to set its \`parent:\`; hold **Alt** while dropping to add a mirror instead.

> In every walk with nature one receives far more than he seeks.
>
> — John Muir

## Where to go next

- **Ctrl+Shift+P** — command palette
- **Ctrl+Shift+V** — cycle the preview position
- **Ctrl+Shift+E** — code block, language detected and written into the fence
- **Run vault doctor** from the palette — audits the vault and offers previewed repairs
`;
