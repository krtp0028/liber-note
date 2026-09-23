import { z } from "zod";
import { parse as parseToml } from "smol-toml";
import * as api from "./api";

export const ConfigSchema = z.object({
  editor: z.object({
    fontSize: z.number().int().min(8).max(32),
    wordWrap: z.boolean(),
    autosaveDelayMs: z.number().int().min(0).max(10000),
    spellCheck: z.boolean(),
  }),
  preview: z.object({
    position: z.enum(["hidden", "right", "left", "bottom", "top"]),
    syncScroll: z.boolean(),
  }),
  theme: z.object({
    name: z.string(),
    followSystem: z.boolean(),
    light: z.string(),
    dark: z.string(),
  }),
  keymap: z.record(z.string(), z.string()),
  rollup: z.object({
    tasks: z.boolean(),
    words: z.boolean(),
    fields: z.array(z.string()),
  }),
  inherit: z.object({
    keys: z.array(z.string()),
  }),
  journal: z.object({
    folder: z.string(),
  }),
  files: z.object({
    exclude: z.array(z.string()),
  }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: AppConfig = {
  editor: { fontSize: 14, wordWrap: false, autosaveDelayMs: 500, spellCheck: true },
  preview: { position: "right", syncScroll: true },
  theme: {
    name: "default-light",
    followSystem: true,
    light: "default-light",
    dark: "default-dark",
  },
  keymap: {},
  rollup: { tasks: true, words: false, fields: [] },
  inherit: { keys: ["tags"] },
  journal: { folder: "Journal" },
  files: { exclude: [] },
};

export const STARTER_CONFIG = `# Liber configuration
# Values here override the built-in defaults.
# A \`.liber/config.toml\` inside a vault overrides this file per key.

[editor]
fontSize = 14
wordWrap = false
autosaveDelayMs = 500
spellCheck = true

[preview]
# hidden | right | left | bottom | top
position = "right"
syncScroll = true

[theme]
name = "default-light"
followSystem = true
light = "default-light"
dark = "default-dark"

[rollup]
tasks = true
words = false
fields = []

[inherit]
keys = ["tags"]

[journal]
folder = "Journal"

[files]
exclude = []

# Keymap overrides: chord = command id
[keymap]
# "Ctrl+Alt+N" = "tree.add_node"
`;

export interface Layer {
  source: string;
  data: Record<string, unknown>;
}

export interface MergeResult {
  merged: Record<string, unknown>;
  sources: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeLayers(layers: Layer[], defaultsSource = "defaults"): MergeResult {
  const merged: Record<string, unknown> = {};
  const sources: Record<string, string> = {};

  const mergeInto = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    prefix: string,
    sourceName: string,
  ): void => {
    for (const [key, value] of Object.entries(source)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (isRecord(value)) {
        const existing = isRecord(target[key]) ? (target[key] as Record<string, unknown>) : {};
        target[key] = existing;
        mergeInto(existing, value, path, sourceName);
      } else {
        target[key] = value;
        sources[path] = sourceName;
      }
    }
  };

  const defaults = layers.find((layer) => layer.source === defaultsSource);
  if (defaults) {
    mergeInto(merged, defaults.data, "", defaults.source);
  }
  for (const layer of layers) {
    if (layer.source !== defaultsSource) {
      mergeInto(merged, layer.data, "", layer.source);
    }
  }
  return { merged, sources };
}

export function collectUnknownKeys(
  value: Record<string, unknown>,
  reference: Record<string, unknown>,
  prefix = "",
): string[] {
  const unknown: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (!(key in reference)) {
      unknown.push(path);
      continue;
    }
    if (isRecord(child) && isRecord(reference[key])) {
      unknown.push(...collectUnknownKeys(child, reference[key] as Record<string, unknown>, path));
    }
  }
  return unknown;
}

export interface ConfigState {
  config: AppConfig;
  sources: Record<string, string>;
  loadedFiles: string[];
  errors: string[];
  warnings: string[];
}

export type ConfigListener = (state: ConfigState) => void;

export class ConfigManager {
  private readonly listeners = new Set<ConfigListener>();
  private paths: api.ConfigPaths | null = null;
  private vaultRoot: string | null = null;
  private timer: number | undefined;
  private readonly rawCache = new Map<string, string | null>();
  private state: ConfigState = {
    config: DEFAULT_CONFIG,
    sources: {},
    loadedFiles: [],
    errors: [],
    warnings: [],
  };

  getState(): ConfigState {
    return this.state;
  }

  getPaths(): api.ConfigPaths | null {
    return this.paths;
  }

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    await this.setVault(this.vaultRoot);
    if (this.timer === undefined) {
      this.timer = window.setInterval(() => {
        void this.poll();
      }, 1500);
    }
  }

  async setVault(vaultRoot: string | null): Promise<void> {
    this.vaultRoot = vaultRoot;
    this.paths = await api.configPaths(vaultRoot);
    await this.reload();
  }

  async ensureStarterConfig(): Promise<string> {
    const paths = this.paths ?? (await api.configPaths(this.vaultRoot));
    return api.configEnsure(paths.configFile, STARTER_CONFIG, this.vaultRoot);
  }

  private async poll(): Promise<void> {
    const paths = this.paths;
    if (!paths) {
      return;
    }
    const files = [
      paths.configFile,
      ...(paths.vaultConfigFile ? [paths.vaultConfigFile] : []),
      paths.customCss,
    ];
    let changed = false;
    for (const file of files) {
      try {
        const raw = await api.configRead(file, this.vaultRoot);
        if (!this.rawCache.has(file) || this.rawCache.get(file) !== raw) {
          this.rawCache.set(file, raw);
          changed = true;
        }
      } catch {
        changed = true;
      }
    }
    if (changed) {
      await this.reload();
    }
  }

  async reload(): Promise<void> {
    const paths = this.paths;
    if (!paths) {
      return;
    }

    const layers: Layer[] = [
      { source: "defaults", data: DEFAULT_CONFIG as unknown as Record<string, unknown> },
    ];
    const errors: string[] = [];
    const loadedFiles: string[] = [];
    const labelFor = new Map<string, string>([
      [paths.configFile, "user"],
      [paths.customCss, "custom.css"],
    ]);
    if (paths.vaultConfigFile) {
      labelFor.set(paths.vaultConfigFile, "vault");
    }

    const sources = new Map<string, string>([[paths.configFile, "user config"]]);
    if (paths.vaultConfigFile) {
      sources.set(paths.vaultConfigFile, "vault config");
    }

    const files = [paths.configFile, ...(paths.vaultConfigFile ? [paths.vaultConfigFile] : [])];
    for (const file of files) {
      let raw: string | null;
      try {
        raw = await api.configRead(file, this.vaultRoot);
        this.rawCache.set(file, raw);
      } catch (error) {
        errors.push(`${sources.get(file) ?? file}: ${String(error)}`);
        continue;
      }
      if (raw === null) {
        continue;
      }
      loadedFiles.push(sources.get(file) ?? file);
      try {
        const data = parseToml(raw) as Record<string, unknown>;
        layers.push({ source: labelFor.get(file) ?? file, data });
      } catch (error) {
        errors.push(
          `${sources.get(file) ?? file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let customCss: string | null;
    try {
      customCss = await api.configRead(paths.customCss, this.vaultRoot);
      this.rawCache.set(paths.customCss, customCss);
    } catch {
      customCss = null;
      this.rawCache.set(paths.customCss, null);
    }

    if (errors.length > 0) {
      this.setState({ ...this.state, errors, loadedFiles });
      return;
    }

    const { merged, sources: keySources } = mergeLayers(layers);
    const warnings = collectUnknownKeys(
      merged,
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
    );
    const parsed = ConfigSchema.safeParse(merged);
    if (!parsed.success) {
      this.setState({
        ...this.state,
        errors: parsed.error.issues.map(
          (issue) => `invalid config (${issue.path.join(".") || "root"}): ${issue.message}`,
        ),
        warnings,
        loadedFiles,
      });
      return;
    }

    this.setState({
      config: parsed.data,
      sources: keySources,
      loadedFiles,
      errors: [],
      warnings,
    });
    this.applyCustomCss(customCss);
  }

  private applyCustomCss(css: string | null): void {
    const id = "liber-custom-css";
    let style = document.getElementById(id);
    if (css === null) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.append(style);
    }
    style.textContent = css;
  }

  private setState(state: ConfigState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const config = new ConfigManager();
