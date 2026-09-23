export const WELCOME_PATH = "Welcome.md";

export const WELCOME_MD = `# Welcome to Liber

Lightweight hierarchical Markdown notes. Your notes stay plain \`.md\` files in a folder you own — no account, no sync service, no lock-in. **This page is an ordinary note: edit it, format it, throw it away when you open a vault.**

> In every walk with nature one receives far more than he seeks.
>
> — John Muir

## Nodes

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

The result is one file that appears in several places, and a branch note that lends its tags to its whole subtree.

## Add a node

- **Ctrl+N** — node after the selected one
- **Ctrl+Shift+N** — child node of the selected one
- **Ctrl+Alt+N** — new folder
- Or the **+**, **+child**, and **folder** buttons in the toolbar

Then give it a \`parent:\` in frontmatter, drag it onto another folder to set one, or hold **Alt** while dropping to add a mirror instead.

## Where to go next

- **Ctrl+O** — open a folder of Markdown files (any folder works)
- **Ctrl+Shift+P** — command palette
- **Ctrl+Shift+V** — cycle the preview position
- **Ctrl+Shift+E** — code block, language detected and written into the fence
- **Run vault doctor** from the palette — audits the vault and offers previewed repairs
`;
