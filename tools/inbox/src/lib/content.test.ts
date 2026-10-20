import { describe, expect, it } from "vitest";
import { toItem, verdict, words } from "./content";

const schema = {
  type: "object",
  properties: {
    goals: { type: "array", description: "the direction", items: { $ref: "#/$defs/Goal" } },
    nonGoals: { type: "array", items: { type: "string" } },
    successCriteria: { type: "array", items: { type: "object", properties: { metric: { type: "string", description: "what is measured" } } } },
  },
  $defs: { Goal: { type: "object", properties: { statement: { type: "string", description: "one sentence" } } } },
};

describe("toItem", () => {
  const page = toItem(
    { title: "Claims", goals: [{ id: "G-1", statement: "Claims are paid fast" }], nonGoals: ["payroll", "a/b"], successCriteria: [{ metric: "p95 days", target: 3 }], openQuestions: [] },
    schema,
    schema,
    "claims-prd",
  );

  it("renders an object as fields, the title from a short name or title field, labels in words with descriptions", () => {
    expect(page).toMatchObject({ shape: "fields", label: "Claims", anchor: "claims-prd" });
    expect(page.children!.map((c) => [c.label, c.shape])).toEqual([["Goals", "cards"], ["Non goals", "bullets"], ["Success criteria", "cards"], ["Open questions", "empty"]]);
    expect(page.children![0]!.description).toBe("the direction");
  });

  it("anchors a finding on the nearest id, else the artifact id and the JSON Pointer", () => {
    const goal = page.children![0]!.children![0]!;
    expect([goal.label, goal.anchor, goal.pointer, goal.children]).toEqual(["G-1 · Claims are paid fast", "G-1", "/goals/0", []]); // id and statement in the title, not again
    const [, bullets, criteria] = page.children!;
    expect(bullets!.children!.map((c) => [c.anchor, c.text])).toEqual([["claims-prd /nonGoals/0", "payroll"], ["claims-prd /nonGoals/1", "a/b"]]);
    const metric = criteria!.children![0]!.children![0]!;
    expect([metric.label, metric.description, metric.anchor, metric.text]).toEqual(["Metric", "what is measured", "claims-prd /successCriteria/0/metric", "p95 days"]); // through items and a $ref-free schema
    expect(criteria!.children![0]!.children![1]).toMatchObject({ label: "Target", text: "3" });
  });

  it("names a field below an id by the id and the pointer under it", () => {
    const item = toItem({ caps: [{ id: "CAP-1", name: "Submit", description: "long text", rules: ["BR-1"] }] }, undefined, {}, "p");
    const cap = item.children![0]!.children![0]!;
    expect(cap.children!.map((c) => [c.label, c.anchor, c.pointer])).toEqual([["Description", "CAP-1 /description", "/caps/0/description"], ["Rules", "CAP-1 /rules", "/caps/0/rules"]]);
    expect(cap.children![1]!.children!.map((c) => [c.anchor, c.pointer])).toEqual([["CAP-1 /rules/0", "/caps/0/rules/0"]]); // two levels down the pointer is still the full one: it keys the item
  });

  it("keeps the id and the name of a nested object a field labels", () => {
    const item = toItem({ owner: { id: "u1", name: "Ann" } }, undefined, {}, "p");
    expect(item.children![0]!.children!.map((c) => c.label)).toEqual(["Id", "Name"]);
  });
});

describe("verdict", () => {
  const ref = { apiVersion: "sdd.persimmon.ai/v1", kind: "Prd", id: "p", revision: 2 };
  it("answers blocking findings on reject and notes on approve, the anchor first", () => {
    expect(verdict(false, [{ anchor: "CAP-2", text: "split it" }, { anchor: "", text: "overall too wide" }], [ref])).toEqual({
      passed: false,
      findings: [
        { severity: "error", code: "blocking_1", message: "CAP-2: split it" },
        { severity: "error", code: "blocking_2", message: "overall too wide" },
      ],
      evidence: [ref],
    });
    expect(verdict(true, [{ anchor: "G-1", text: "fine" }], []).findings).toEqual([{ severity: "info", code: "note_1", message: "G-1: fine" }]);
  });
});

it("words", () => expect([words("successCriteria"), words("non_goals"), words("id")]).toEqual(["Success criteria", "Non goals", "Id"]));
