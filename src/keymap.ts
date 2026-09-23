export type KeymapContext = "global" | "editor" | "tree" | "preview" | "input";

export interface KeyBinding {
  chord: string;
  command: string;
  context: KeymapContext;
}

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { chord: "Mod+Shift+V", command: "preview.cycle_position", context: "global" },
  { chord: "Mod+O", command: "vault.open", context: "global" },
  { chord: "Mod+Shift+P", command: "palette.open", context: "global" },
  { chord: "Mod+S", command: "file.save", context: "global" },
  { chord: "Mod+P", command: "file.quick_open", context: "global" },
  { chord: "Mod+Shift+F", command: "search.open", context: "global" },
  { chord: "Mod+W", command: "tab.close", context: "global" },
  { chord: "Mod+Shift+T", command: "tab.reopen_last", context: "global" },
  { chord: "Mod+B", command: "markdown.bold", context: "global" },
  { chord: "Mod+I", command: "markdown.italic", context: "global" },
  { chord: "Mod+E", command: "markdown.code", context: "global" },
  { chord: "Mod+Shift+E", command: "markdown.codeBlock", context: "global" },
  { chord: "Mod+K", command: "markdown.link", context: "global" },
  { chord: "Mod+Shift+D", command: "journal.open_today", context: "global" },
  { chord: "Mod+=", command: "view.zoom_in", context: "global" },
  { chord: "Mod+-", command: "view.zoom_out", context: "global" },
  { chord: "Mod+0", command: "view.zoom_reset", context: "global" },
];

export interface Chord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  space: "space",
  esc: "escape",
  escape: "escape",
  return: "enter",
  enter: "enter",
  del: "delete",
  delete: "delete",
  ins: "insert",
  insert: "insert",
  up: "arrowup",
  arrowup: "arrowup",
  down: "arrowdown",
  arrowdown: "arrowdown",
  left: "arrowleft",
  arrowleft: "arrowleft",
  right: "arrowright",
  arrowright: "arrowright",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
  tab: "tab",
  backspace: "backspace",
};

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function parseChord(chord: string, isMac = false): Chord {
  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = "";

  for (const rawPart of chord.split("+")) {
    const part = rawPart.trim().toLowerCase();
    if (part === "") {
      continue;
    }
    if (part === "mod") {
      if (isMac) {
        meta = true;
      } else {
        ctrl = true;
      }
    } else if (part === "ctrl" || part === "control") {
      ctrl = true;
    } else if (part === "shift") {
      shift = true;
    } else if (part === "alt") {
      alt = true;
    } else if (part === "meta" || part === "cmd" || part === "super") {
      meta = true;
    } else {
      key = normalizeKey(part);
    }
  }

  if (key === "") {
    throw new Error(`invalid chord: ${chord}`);
  }

  return { key, ctrl, shift, alt, meta };
}

export function matchesEvent(event: KeyEventLike, chord: string, isMac = false): boolean {
  const parsed = parseChord(chord, isMac);
  if (normalizeKey(event.key) !== parsed.key) {
    return false;
  }
  return (
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.metaKey === parsed.meta
  );
}

export function isMacPlatform(userAgent?: string): boolean {
  if (userAgent !== undefined) {
    return /mac/i.test(userAgent);
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac/i.test(navigator.userAgent);
}
