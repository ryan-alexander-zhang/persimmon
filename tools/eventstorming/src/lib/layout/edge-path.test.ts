import { describe, expect, it } from "vitest";
import { offsetOrthogonalPath } from "./edge-path";

describe("offsetOrthogonalPath (issue-00003 render)", () => {
  it("jogs a collinear vertical edge sideways by the offset", () => {
    // source directly below target, same x=100; offset +26 → mid run at x=126
    const [path, labelX] = offsetOrthogonalPath(100, 300, 100, 50, true, 26);
    expect(labelX).toBe(126);
    expect(path).toContain("126,"); // the jogged vertical run is present
    expect(path).not.toMatch(/^M100,300 L100,50/); // not a straight line
  });

  it("jogs a collinear horizontal edge vertically by the offset", () => {
    const [path, , labelY] = offsetOrthogonalPath(50, 100, 300, 100, false, -26);
    expect(labelY).toBe(74);
    expect(path).toContain(",74");
  });

  it("keeps both endpoints exactly on the handles", () => {
    const [path] = offsetOrthogonalPath(100, 300, 100, 50, true, 26);
    expect(path.startsWith("M100,300")).toBe(true);
    expect(path.endsWith("L100,50")).toBe(true);
  });
});
