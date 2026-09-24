import { describe, expect, it } from "vitest";
import { builtinThemes, DEFAULT_LIGHT, parseTheme, pickThemeName, resolveTheme } from "./theme";
import { DEFAULT_CONFIG } from "./config";

describe("resolveTheme", () => {
  it("inherits tokens through extends chains", () => {
    const registry = new Map([
      ["base", DEFAULT_LIGHT],
      [
        "child",
        parseTheme(
          "child",
          `
[meta]
name = "child"
extends = "base"
variant = "light"

[colors]
accent = "#ff0000"
`,
        ),
      ],
    ]);

    const resolved = resolveTheme("child", registry);

    expect(resolved.tokens.accent).toBe("#ff0000");
    expect(resolved.tokens.bg).toBe(DEFAULT_LIGHT.tokens.bg);
  });

  it("resolves palette references", () => {
    const registry = new Map([
      [
        "pal",
        parseTheme(
          "pal",
          `
[meta]
name = "pal"
variant = "dark"

[palette]
north = "#2e3440"

[colors]
bg = "palette.north"
`,
        ),
      ],
    ]);

    const resolved = resolveTheme("pal", registry);

    expect(resolved.tokens.bg).toBe("#2e3440");
    expect(resolved.variant).toBe("dark");
  });

  it("falls back to the default theme for unknown names", () => {
    const resolved = resolveTheme("missing", new Map());
    expect(resolved.tokens.bg).toBe(DEFAULT_LIGHT.tokens.bg);
  });
  it("stops at cycles", () => {
    const registry = new Map([
      ["a", parseTheme("a", '[meta]\nname = "a"\nextends = "b"\n[colors]\naccent = "#111111"\n')],
      ["b", parseTheme("b", '[meta]\nname = "b"\nextends = "a"\n[colors]\nbg = "#222222"\n')],
    ]);

    const resolved = resolveTheme("a", registry);

    expect(resolved.tokens.accent).toBe("#111111");
    expect(resolved.tokens.bg).toBe("#222222");
  });

  it("includes the bundled Oh My Bash-inspired palettes", () => {
    const registry = builtinThemes();

    for (const name of ["robbyrussell", "agnoster", "powerline", "nekonight", "rainbowbrite"]) {
      expect(registry.has(name)).toBe(true);
      const resolved = resolveTheme(name, registry);
      expect(Object.values(resolved.tokens).every((token) => !token.includes("palette."))).toBe(
        true,
      );
    }
  });
});

describe("pickThemeName", () => {
  it("follows the system when enabled", () => {
    const config = {
      ...DEFAULT_CONFIG,
      theme: { ...DEFAULT_CONFIG.theme, followSystem: true, light: "l", dark: "d" },
    };
    expect(pickThemeName(config, true)).toBe("d");
    expect(pickThemeName(config, false)).toBe("l");
  });

  it("uses the explicit name when follow is off", () => {
    const config = {
      ...DEFAULT_CONFIG,
      theme: { ...DEFAULT_CONFIG.theme, followSystem: false, name: "solar" },
    };
    expect(pickThemeName(config, true)).toBe("solar");
  });
});
