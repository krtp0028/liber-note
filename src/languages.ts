import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

const MODULES: Record<string, LanguageFn> = {
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  xml,
};

for (const [name, module] of Object.entries(MODULES)) {
  hljs.registerLanguage(name, module);
}

export const MIN_RELEVANCE = 5;

export function codeLanguages(): string[] {
  return hljs.listLanguages().sort();
}

export function detectLanguage(code: string, minRelevance = MIN_RELEVANCE): string | null {
  if (code.trim() === "") {
    return null;
  }
  const result = hljs.highlightAuto(code);
  return result.language && result.relevance >= minRelevance ? result.language : null;
}
