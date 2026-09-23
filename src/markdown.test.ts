import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { detectLanguage } from "./languages";
import { fenceAt } from "./markdown";

const doc = (text: string) => EditorState.create({ doc: text }).doc;

describe("detectLanguage", () => {
  it("recognizes code and ignores prose", () => {
    expect(detectLanguage('def greet(name):\n    print(f"hi {name}")\n')).toBe("python");
    expect(detectLanguage("hello")).toBeNull();
  });

  it("honors the relevance floor", () => {
    expect(detectLanguage("print('hi')", 0)).not.toBeNull();
    expect(detectLanguage("print('hi')", Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe("fenceAt", () => {
  it("finds the unlabeled fence above the cursor and its body", () => {
    const text = doc("intro\n```\nprint(1)\nprint(2)\n```\ntail\n");
    const fence = fenceAt(text, text.line(3).to);

    expect(fence).not.toBeNull();
    expect(text.sliceString(fence?.contentFrom ?? 0, fence?.contentTo ?? 0)).toBe(
      "print(1)\nprint(2)\n",
    );
    expect(fence?.infoFrom).toBe(text.line(2).to);
  });

  it("leaves explicit languages and plain text alone", () => {
    const tagged = doc("```rust\nfn main() {}\n```\n");
    expect(fenceAt(tagged, tagged.line(2).to)).toBeNull();
    expect(fenceAt(doc("just a paragraph\n"), 5)).toBeNull();
  });
});
