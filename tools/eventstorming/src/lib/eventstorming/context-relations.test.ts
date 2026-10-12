import { describe, expect, it } from "vitest";
import {
  CONTEXT_RELATION_STYLE,
  CONTEXT_RELATION_TYPES,
  DEFAULT_CONTEXT_RELATION,
} from "./context-relations";

describe("context relationship vocabulary [decision-00007]", () => {
  it("has the full canonical 8-pattern set", () => {
    expect([...CONTEXT_RELATION_TYPES]).toEqual([
      "partnership",
      "sharedKernel",
      "customerSupplier",
      "conformist",
      "acl",
      "openHostService",
      "publishedLanguage",
      "separateWays",
    ]);
  });

  it("styles every type with a label and colour", () => {
    for (const t of CONTEXT_RELATION_TYPES) {
      expect(CONTEXT_RELATION_STYLE[t].label).toBeTruthy();
      expect(CONTEXT_RELATION_STYLE[t].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("marks the symmetric patterns", () => {
    expect(CONTEXT_RELATION_STYLE.partnership.symmetric).toBe(true);
    expect(CONTEXT_RELATION_STYLE.sharedKernel.symmetric).toBe(true);
    expect(CONTEXT_RELATION_STYLE.acl.symmetric).toBe(false);
  });

  it("defaults a new relationship to Customer/Supplier [us-00020-FR-2]", () => {
    expect(DEFAULT_CONTEXT_RELATION).toBe("customerSupplier");
    expect(CONTEXT_RELATION_TYPES).toContain(DEFAULT_CONTEXT_RELATION);
  });
});
