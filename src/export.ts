import { tempDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import * as api from "./api";
import { baseName } from "./paths";
import { renderMarkdown } from "./preview";

export function buildHtmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; font-family: system-ui, sans-serif; line-height: 1.6; color: #1f1f1f; }
  pre { background: #f4f4f4; padding: 10px 12px; border-radius: 6px; overflow: auto; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 10px; }
  blockquote { margin: 0.7em 0; padding-left: 10px; border-left: 3px solid #ccc; color: #666; }
  img { max-width: 100%; }
  a { color: #3b5bdb; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function exportNoteAsHtml(relPath: string, contents: string): Promise<string | null> {
  const target = await save({
    defaultPath: `${baseName(relPath).replace(/\.md$/i, "")}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (typeof target !== "string") {
    return null;
  }
  await api.writeTextAbsolute(
    target,
    buildHtmlDocument(baseName(relPath), renderMarkdown(contents)),
  );
  return target;
}

export async function exportNoteAsPdf(relPath: string, contents: string): Promise<string> {
  const directory = await tempDir();
  const target = `${directory}liber-${baseName(relPath).replace(/\.md$/i, "")}.html`;
  await api.writeTextAbsolute(
    target,
    buildHtmlDocument(baseName(relPath), renderMarkdown(contents)),
  );
  await api.openExternal(target);
  return target;
}
