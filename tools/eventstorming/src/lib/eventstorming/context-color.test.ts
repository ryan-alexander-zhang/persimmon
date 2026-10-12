import { describe, expect, it } from "vitest";
import { contextTint, SUBDOMAIN_STYLE } from "./context-color";

describe("context-color", () => {
  it("gives a deterministic tint per context id, and none for Ungrouped", () => {
    expect(contextTint("ord")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contextTint("ord")).toBe(contextTint("ord")); // stable across calls
    expect(contextTint(undefined)).toBeUndefined();
    expect(contextTint("")).toBeUndefined();
  });

  it("styles every subdomain classification with a label and colour", () => {
    for (const cls of ["core", "supporting", "generic"] as const) {
      expect(SUBDOMAIN_STYLE[cls].label).toBeTruthy();
      expect(SUBDOMAIN_STYLE[cls].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
