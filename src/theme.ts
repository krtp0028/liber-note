import { parse as parseToml } from "smol-toml";
import * as api from "./api";
import { DEFAULT_CONFIG } from "./config";
import type { AppConfig } from "./config";

export const TOKEN_NAMES = [
  "bg",
  "surface",
  "sidebar",
  "hover",
  "fg",
  "muted",
  "border",
  "accent",
  "accentFg",
  "selection",
  "errorBg",
  "errorFg",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

const CSS_VARS: Record<TokenName, string> = {
  bg: "--bg",
  surface: "--bg-surface",
  sidebar: "--bg-sidebar",
  hover: "--bg-hover",
  fg: "--fg",
  muted: "--fg-muted",
  border: "--border",
  accent: "--accent",
  accentFg: "--accent-fg",
  selection: "--selection",
  errorBg: "--error-bg",
  errorFg: "--error-fg",
};

export type ThemeVariant = "light" | "dark";

export interface ThemeMeta {
  name: string;
  variant: ThemeVariant;
  extends?: string;
}

export interface ThemeDefinition {
  meta: ThemeMeta;
  palette: Record<string, string>;
  tokens: Partial<Record<TokenName, string>>;
}

export const DEFAULT_LIGHT: ThemeDefinition = {
  meta: { name: "default-light", variant: "light" },
  palette: {},
  tokens: {
    bg: "#f4f4f2",
    surface: "#ffffff",
    sidebar: "#ececea",
    hover: "rgba(0, 0, 0, 0.06)",
    fg: "#1f1f1f",
    muted: "#6f6f6f",
    border: "rgba(0, 0, 0, 0.12)",
    accent: "#3b5bdb",
    accentFg: "#ffffff",
    selection: "rgba(59, 91, 219, 0.25)",
    errorBg: "#f8d7da",
    errorFg: "#7a1f24",
  },
};

export const DEFAULT_DARK: ThemeDefinition = {
  meta: { name: "default-dark", variant: "dark" },
  palette: {},
  tokens: {
    bg: "#1c1c1e",
    surface: "#232326",
    sidebar: "#19191b",
    hover: "rgba(255, 255, 255, 0.07)",
    fg: "#e8e8e8",
    muted: "#9a9a9a",
    border: "rgba(255, 255, 255, 0.12)",
    accent: "#7a94f7",
    accentFg: "#101014",
    selection: "rgba(122, 148, 247, 0.3)",
    errorBg: "#4a1d20",
    errorFg: "#f1aeb5",
  },
};

const ROBBYRUSSELL: ThemeDefinition = {
  meta: { name: "robbyrussell", variant: "light" },
  palette: {
    canvas: "#f7f3e8",
    paper: "#fffdf7",
    sidebar: "#eee7d6",
    ink: "#27313a",
    muted: "#756f65",
    line: "#d8cebd",
    green: "#2f7d32",
    teal: "#007c83",
    navy: "#244b74",
    brown: "#8a5a2b",
    olive: "#718355",
    red: "#a33b32",
  },
  tokens: {
    bg: "palette.canvas",
    surface: "palette.paper",
    sidebar: "palette.sidebar",
    hover: "rgba(39, 49, 58, 0.08)",
    fg: "palette.ink",
    muted: "palette.muted",
    border: "palette.line",
    accent: "palette.teal",
    accentFg: "palette.paper",
    selection: "#d8eee3",
    errorBg: "#f4d6d2",
    errorFg: "palette.red",
  },
};

const AGNOSTER: ThemeDefinition = {
  meta: { name: "agnoster", variant: "dark" },
  palette: {
    navy: "#002b36",
    teal: "#073642",
    sidebar: "#001f27",
    blue: "#268bd2",
    cyan: "#2aa198",
    yellow: "#b58900",
    orange: "#cb4b16",
    green: "#859900",
    red: "#dc322f",
    violet: "#6c71c4",
    cream: "#eee8d5",
    muted: "#93a1a1",
  },
  tokens: {
    bg: "palette.navy",
    surface: "palette.teal",
    sidebar: "palette.sidebar",
    hover: "rgba(147, 161, 161, 0.14)",
    fg: "palette.cream",
    muted: "palette.muted",
    border: "rgba(147, 161, 161, 0.28)",
    accent: "palette.blue",
    accentFg: "palette.navy",
    selection: "rgba(38, 139, 210, 0.3)",
    errorBg: "palette.red",
    errorFg: "palette.cream",
  },
};

const POWERLINE: ThemeDefinition = {
  meta: { name: "powerline", variant: "dark" },
  palette: {
    background: "#0d1117",
    surface: "#161b22",
    sidebar: "#090c10",
    text: "#d8dee9",
    muted: "#8b949e",
    line: "#30363d",
    cyan: "#2dd4bf",
    green: "#7ee787",
    orange: "#ffa657",
    blue: "#58a6ff",
    yellow: "#d29922",
    red: "#f85149",
  },
  tokens: {
    bg: "palette.background",
    surface: "palette.surface",
    sidebar: "palette.sidebar",
    hover: "rgba(255, 255, 255, 0.08)",
    fg: "palette.text",
    muted: "palette.muted",
    border: "palette.line",
    accent: "palette.cyan",
    accentFg: "#061016",
    selection: "rgba(45, 212, 191, 0.28)",
    errorBg: "palette.red",
    errorFg: "#ffffff",
  },
};

const NEKONIGHT: ThemeDefinition = {
  meta: { name: "nekonight", variant: "dark" },
  palette: {
    background: "#161923",
    surface: "#202331",
    sidebar: "#11141c",
    text: "#e6e1f5",
    muted: "#9b98aa",
    line: "#36384a",
    violet: "#c792ea",
    magenta: "#ff9eb5",
    cyan: "#89ddff",
    yellow: "#ffcb6b",
    green: "#c3e88d",
    red: "#f07178",
  },
  tokens: {
    bg: "palette.background",
    surface: "palette.surface",
    sidebar: "palette.sidebar",
    hover: "rgba(199, 146, 234, 0.12)",
    fg: "palette.text",
    muted: "palette.muted",
    border: "palette.line",
    accent: "palette.violet",
    accentFg: "#181221",
    selection: "rgba(199, 146, 234, 0.3)",
    errorBg: "#55283a",
    errorFg: "palette.magenta",
  },
};

const RAINBOWBRITE: ThemeDefinition = {
  meta: { name: "rainbowbrite", variant: "dark" },
  palette: {
    background: "#18181b",
    surface: "#24242a",
    sidebar: "#101013",
    text: "#f4f1e8",
    muted: "#aaa7a3",
    line: "#3b3a42",
    red: "#ff6b6b",
    blue: "#5fa8ff",
    yellow: "#ffd75f",
    green: "#7ee787",
    purple: "#c77dff",
    orange: "#ff9f43",
  },
  tokens: {
    bg: "palette.background",
    surface: "palette.surface",
    sidebar: "palette.sidebar",
    hover: "rgba(255, 255, 255, 0.08)",
    fg: "palette.text",
    muted: "palette.muted",
    border: "palette.line",
    accent: "palette.yellow",
    accentFg: "#201a0d",
    selection: "rgba(95, 168, 255, 0.3)",
    errorBg: "#4b1d29",
    errorFg: "palette.red",
  },
};

export function builtinThemes(): Map<string, ThemeDefinition> {
  const themes = new Map<string, ThemeDefinition>();
  for (const theme of [
    DEFAULT_LIGHT,
    DEFAULT_DARK,
    ROBBYRUSSELL,
    AGNOSTER,
    POWERLINE,
    NEKONIGHT,
    RAINBOWBRITE,
  ]) {
    themes.set(theme.meta.name, theme);
  }
  return themes;
}

export function parseTheme(name: string, toml: string): ThemeDefinition {
  const data = parseToml(toml) as Record<string, unknown>;
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const palette = (data.palette ?? {}) as Record<string, unknown>;
  const colors = (data.colors ?? {}) as Record<string, unknown>;

  const variant = meta.variant === "dark" ? "dark" : "light";
  const themeName = typeof meta.name === "string" ? meta.name : name;
  const theme: ThemeDefinition = {
    meta: {
      name: themeName,
      variant,
      ...(typeof meta.extends === "string" ? { extends: meta.extends } : {}),
    },
    palette: Object.fromEntries(
      Object.entries(palette).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    tokens: {},
  };

  for (const token of TOKEN_NAMES) {
    const value = colors[token];
    if (typeof value === "string") {
      theme.tokens[token] = value;
    }
  }
  return theme;
}

function substitutePalette(value: string, palette: Record<string, string>): string {
  const match = /^palette\.(.+)$/.exec(value);
  if (!match) {
    return value;
  }
  return palette[match[1]] ?? value;
}

export function resolveTheme(
  name: string,
  registry: Map<string, ThemeDefinition>,
): { tokens: Record<string, string>; variant: ThemeVariant } {
  const chain: ThemeDefinition[] = [];
  const seen = new Set<string>();
  let current = registry.get(name);
  while (current && !seen.has(current.meta.name)) {
    seen.add(current.meta.name);
    chain.push(current);
    current = current.meta.extends ? registry.get(current.meta.extends) : undefined;
  }
  if (chain.length === 0) {
    chain.push(DEFAULT_LIGHT);
  }

  const variant = chain[chain.length - 1].meta.variant;
  const tokens: Record<string, string> = {};
  const palette: Record<string, string> = {};
  for (const theme of [...chain].reverse()) {
    Object.assign(palette, theme.palette);
  }
  for (const theme of [...chain].reverse()) {
    for (const [token, value] of Object.entries(theme.tokens)) {
      if (value !== undefined) {
        tokens[token] = substitutePalette(value, palette);
      }
    }
  }
  return { tokens, variant };
}

export function applyTokens(tokens: Record<string, string>): void {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(tokens)) {
    const cssVar = CSS_VARS[token as TokenName];
    if (cssVar) {
      root.style.setProperty(cssVar, value);
    }
  }
}

export function pickThemeName(config: AppConfig, prefersDark: boolean): string {
  if (config.theme.followSystem) {
    return prefersDark ? config.theme.dark : config.theme.light;
  }
  return config.theme.name;
}

export class ThemeController {
  private registry = builtinThemes();
  private paths: api.ConfigPaths | null = null;
  private config: AppConfig = DEFAULT_CONFIG;
  private readonly media = window.matchMedia("(prefers-color-scheme: dark)");
  private errors: string[] = [];

  constructor() {
    this.media.addEventListener("change", () => this.apply());
  }

  getErrors(): string[] {
    return this.errors;
  }

  async setPaths(paths: api.ConfigPaths): Promise<void> {
    this.paths = paths;
    await this.loadUserThemes();
    this.apply();
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.apply();
  }

  apply(): void {
    const name = pickThemeName(this.config, this.media.matches);
    const resolved = resolveTheme(name, this.registry);
    applyTokens(resolved.tokens);
  }

  private async loadUserThemes(): Promise<void> {
    if (!this.paths) {
      return;
    }
    const registry = builtinThemes();
    const errors: string[] = [];
    try {
      const files = await api.themesList(this.paths.themesDir);
      for (const file of files) {
        try {
          const raw = await api.configRead(`${this.paths.themesDir}/${file}`, null);
          if (raw === null) {
            continue;
          }
          const theme = parseTheme(file.replace(/\.toml$/, ""), raw);
          registry.set(theme.meta.name, theme);
          registry.set(file.replace(/\.toml$/, ""), theme);
        } catch (error) {
          errors.push(`theme ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`themes: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.registry = registry;
    this.errors = errors;
  }
}
