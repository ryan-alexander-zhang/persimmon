import { describe, expect, it } from "vitest";
import { countChanges, diffDoc } from "./diff";
import { toDoc } from "./document";

const r1 = {
  title: "Expense claims",
  owner: "Finance",
  problem: "Claims travel as spreadsheets mailed to the approver.",
  nonGoals: ["Payroll", "Travel booking"],
  capabilities: [
    { id: "CAP-1", name: "Submit a claim", description: "An employee attaches a receipt to each line.", priority: "P1" },
    { id: "CAP-2", name: "Route a claim", description: "Routing.", priority: "P1" },
  ],
};
const r2 = {
  title: "Expense claims",
  owner: "Finance operations",
  problem: "Claims travel as spreadsheets mailed to the approver.",
  nonGoals: ["Payroll", "Corporate cards"],
  capabilities: [
    { id: "CAP-2", name: "Route a claim", description: "Routing.", priority: "P1" }, // reordered, unchanged
    { id: "CAP-1", name: "Submit a claim", description: "An employee attaches a receipt to each line over 25 EUR.", priority: "P2" },
    { id: "CAP-3", name: "Export", description: "Finance exports.", priority: "P2" },
  ],
};

describe("diffDoc", () => {
  const doc = diffDoc(toDoc(r1, undefined, "p"), toDoc(r2, undefined, "p"));
  const section = (h: string) => doc.blocks.find((b) => b.t === "section" && b.heading === h) as Extract<(typeof doc.blocks)[number], { t: "section" }>;

  it("marks a changed short field with its old value, and leaves an unchanged section unmarked", () => {
    expect(doc.meta).toEqual([{ label: "Owner", value: "Finance operations", anchor: "p owner", change: "changed", was: "Finance" }]);
    expect(section("Problem").change).toBeUndefined();
  });

  it("pairs elements by id, so a reordered one is no change; diffs a passage word by word; tags an added element", () => {
    const caps = section("Capabilities");
    expect(caps.change).toBe("changed");
    const [cap2, cap1, cap3] = caps.blocks as Extract<(typeof caps.blocks)[number], { t: "element" }>[];
    expect([cap2!.id, cap2!.change]).toEqual(["CAP-2", undefined]);
    expect([cap1!.id, cap1!.change, cap1!.meta]).toEqual(["CAP-1", "changed", [{ label: "Priority", value: "P2", anchor: "CAP-1 priority", change: "changed", was: "P1" }]]);
    expect(cap1!.blocks[0]).toMatchObject({ t: "prose", change: "changed", parts: [{ text: "An employee attaches a receipt to each line " }, { text: "over 25 EUR", change: "added" }, { text: "." }] });
    expect([cap3!.id, cap3!.change]).toEqual(["CAP-3", "added"]);
  });

  it("keeps a space between words removed and the words that replace them", () => {
    const d = diffDoc(toDoc({ p: "a receipt for each line that needs one, then submit" }, undefined, "x"), toDoc({ p: "a receipt for each line of 25 EUR or more, then submit" }, undefined, "x"));
    const parts = (d.blocks[0] as { blocks: { parts: { text: string; change?: string }[] }[] }).blocks[0]!.parts;
    expect(parts.map((x) => x.text).join("")).toMatch(/one of 25|one ?of 25/);
    expect(parts.filter((x) => x.change === "removed").every((x) => /\s$/.test(x.text))).toBe(true);
  });

  it("marks list entries added and removed, and puts a removed element back where it was", () => {
    expect((section("Non goals").blocks[0] as { items: unknown[] }).items).toEqual([
      { text: "Payroll", anchor: "p nonGoals" },
      { text: "Corporate cards", anchor: "p nonGoals", change: "added" },
      { text: "Travel booking", anchor: "p nonGoals", change: "removed" },
    ]);
    const back = diffDoc(toDoc(r2, undefined, "p"), toDoc(r1, undefined, "p"));
    const caps = back.blocks.find((b) => b.t === "section" && b.heading === "Capabilities") as { blocks: { id?: string; change?: string }[] };
    expect(caps.blocks.map((b) => [b.id, b.change])).toEqual([["CAP-1", "changed"], ["CAP-3", "removed"], ["CAP-2", undefined]]); // after CAP-1, which preceded it
  });

  it("counts what changed: a field, a list, an element's passage and field, an added element", () => {
    expect(countChanges(doc.blocks) + doc.meta.filter((m) => m.change).length).toBe(1 + 1 + 2 + 1);
  });

  it("is no change at all between equal revisions", () => {
    const same = diffDoc(toDoc(r1, undefined, "p"), toDoc(r1, undefined, "p"));
    expect(countChanges(same.blocks)).toBe(0);
  });
});
