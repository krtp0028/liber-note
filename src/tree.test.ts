import { describe, expect, it } from "vitest";
import type { TreeNode } from "./resolver";
import { filterTree, visibleNodes } from "./tree";

const node = (relPath: string, isDir: boolean, children: TreeNode[] = []): TreeNode => ({
  name: relPath.split("/").at(-1) ?? relPath,
  relPath,
  openPath: isDir ? "" : relPath,
  isDir,
  children,
  mirror: false,
  cycle: false,
  dangling: false,
  order: null,
  placements: [relPath],
  color: null,
  icon: null,
});

describe("visibleNodes", () => {
  const roots = [node("docs", true, [node("docs/a.md", false)]), node("root.md", false)];

  it("only includes children of expanded directories", () => {
    expect(visibleNodes(roots, new Set()).map((item) => item.relPath)).toEqual(["docs", "root.md"]);
  });

  it("includes children when a directory is expanded", () => {
    expect(visibleNodes(roots, new Set(["docs"])).map((item) => item.relPath)).toEqual([
      "docs",
      "docs/a.md",
      "root.md",
    ]);
  });

  it("reports tree depth, not folder depth", () => {
    const flat = [node("Alpha.md", false, [node("child.md", false)])];
    expect(
      visibleNodes(flat, new Set(["Alpha.md"])).map((item) => [item.relPath, item.depth]),
    ).toEqual([
      ["Alpha.md", 0],
      ["child.md", 1],
    ]);
  });

  it("expands notes that have child nodes", () => {
    const fileParent = node("Alpha.md", false, [node("child.md", false)]);
    expect(visibleNodes([fileParent], new Set()).map((item) => item.relPath)).toEqual(["Alpha.md"]);
    expect(visibleNodes([fileParent], new Set(["Alpha.md"])).map((item) => item.relPath)).toEqual([
      "Alpha.md",
      "child.md",
    ]);
  });
});

describe("filterTree", () => {
  const roots = [
    node("Docs", true, [node("Docs/guide.md", false)]),
    node("Random.md", false),
    node("Alpha.md", false, [node("Beta.md", false)]),
  ];

  it("keeps a matching directory with its whole subtree", () => {
    const filtered = filterTree(roots, (candidate) => candidate.name === "Docs");
    expect(filtered.map((item) => item.relPath)).toEqual(["Docs"]);
    expect(filtered[0].children.map((item) => item.relPath)).toEqual(["Docs/guide.md"]);
  });

  it("keeps ancestors of matching files", () => {
    const filtered = filterTree(roots, (candidate) => candidate.relPath === "Docs/guide.md");
    expect(filtered.map((item) => item.relPath)).toEqual(["Docs"]);
  });

  it("drops branches with no matches", () => {
    const filtered = filterTree(roots, (candidate) => candidate.relPath === "Beta.md");
    expect(filtered.map((item) => item.relPath)).toEqual(["Alpha.md"]);
    expect(filtered[0].children.map((item) => item.relPath)).toEqual(["Beta.md"]);
  });
});
