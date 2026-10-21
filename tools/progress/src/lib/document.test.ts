import { describe, expect, it } from "vitest";
import { message, toDoc, verdict, words } from "./document";

const schema = {
  type: "object",
  properties: {
    problem: { type: "string", description: "who hurts, how, today" },
    capabilities: { type: "array", description: "the feature list", items: { $ref: "#/$defs/Cap" } },
  },
  $defs: { Cap: { type: "object", properties: { description: { type: "string", description: "what it lets a user do" } } } },
};
const prd = {
  title: "Expense claims",
  businessRules: "claims-rules",
  problem: "Claims travel as spreadsheets.\nFinance re-keys them.",
  nonGoals: ["Payroll", "Corporate cards are handled elsewhere today"],
  capabilities: [{ id: "CAP-1", name: "Submit a claim", description: "An employee builds a claim from lines and submits it.", priority: "P1", rules: ["BR-2", "BR-3"] }],
  successCriteria: [{ metric: "days to payment", target: 3 }],
  openQuestions: [],
};

describe("toDoc", () => {
  const doc = toDoc(prd, schema, "claims-prd");

  it("titles the document, puts short top-level fields on its meta line and every other field in a section", () => {
    expect(doc.title).toBe("Expense claims");
    expect(doc.meta).toEqual([{ label: "Business rules", value: "claims-rules", anchor: "claims-prd businessRules" }]);
    expect(doc.blocks.map((b) => (b.t === "section" ? b.heading : b.t))).toEqual(["Problem", "Non goals", "Capabilities", "Success criteria", "Open questions"]);
    expect(doc.blocks[0]).toEqual({ t: "section", heading: "Problem", description: "who hurts, how, today", anchor: "claims-prd problem", blocks: [{ t: "prose", description: "who hurts, how, today", text: "Claims travel as spreadsheets.\nFinance re-keys them.", anchor: "claims-prd problem" }] });
    expect(doc.blocks[4]).toMatchObject({ heading: "Open questions", blocks: [{ t: "empty" }] });
  });

  it("sets an element under its id and name, short fields on one meta line, prose and tags below, anchored on the id", () => {
    const caps = doc.blocks[2]!;
    expect(caps).toMatchObject({ t: "section", description: "the feature list" });
    const cap = (caps as { blocks: unknown[] }).blocks[0];
    expect(cap).toEqual({
      t: "element",
      id: "CAP-1",
      title: "Submit a claim",
      meta: [{ label: "Priority", value: "P1", anchor: "CAP-1 priority" }],
      anchor: "CAP-1",
      blocks: [
        { t: "prose", label: "Description", description: "what it lets a user do", text: "An employee builds a claim from lines and submits it.", anchor: "CAP-1 description" },
        { t: "list", label: "Rules", items: [{ text: "BR-2", anchor: "CAP-1 rules" }, { text: "BR-3", anchor: "CAP-1 rules" }], tags: true },
      ],
    });
  });

  it("anchors an element without an id on the artifact and its place; a list of prose is bullets, not tags", () => {
    expect((doc.blocks[3] as { blocks: unknown[] }).blocks[0]).toEqual({
      t: "element",
      meta: [
        { label: "Metric", value: "days to payment", anchor: "claims-prd successCriteria #1 metric" },
        { label: "Target", value: "3", anchor: "claims-prd successCriteria #1 target" },
      ],
      anchor: "claims-prd successCriteria #1",
      blocks: [],
    });
    expect((doc.blocks[1] as { blocks: unknown[] }).blocks[0]).toMatchObject({ t: "list", tags: false });
  });

  it("sets a SourceInventory in reading order: entry points, then what they reach, then what was read in them", () => {
    const inv = { source: { repository: "r", commit: "c9a37f2" }, openQuestions: [], unread: [], guards: [], stateChanges: [], externalSystems: [], entities: [], entryPoints: [], declarations: [], absences: [], plumbingPatterns: [], tests: [] };
    expect(toDoc(inv, undefined, "jp-inventory", "SourceInventory").blocks.map((b) => (b.t === "section" ? b.heading : b.t))).toEqual([
      "Source",
      "Entry points",
      "Entities",
      "External systems",
      "Guards",
      "Declarations",
      "State changes",
      "Absences",
      "Plumbing patterns",
      "Tests",
      "Unread",
      "Open questions",
    ]);
  });

  it("puts a ParityLedger's verdict first and heads an item by the ref it accounts for", () => {
    const ledger = { source: { repository: "r", commit: "c9a37f2" }, items: [{ ref: "GD-3", slice: "SL-1", account: "open", reason: "no test pinned it" }], slices: [{ id: "SL-1", name: "Catalog", entryPoints: ["EP-2"], order: 1 }], verdict: { result: "concerns", rule: "an open item" } };
    const doc = toDoc(ledger, undefined, "jp-parity", "ParityLedger");
    expect(doc.blocks.map((b) => (b.t === "section" ? b.heading : b.t))).toEqual(["Verdict", "Slices", "Items", "Source"]);
    expect((doc.blocks[2] as { blocks: unknown[] }).blocks[0]).toMatchObject({ t: "element", id: "GD-3", anchor: "GD-3", meta: [{ label: "Slice", value: "SL-1" }, { label: "Account", value: "open" }, { label: "Reason", value: "no test pinned it" }] });
  });

  it("keeps a whole-string content as one passage", () => expect(toDoc("# DESIGN.md\n\ntext", undefined, "ds")).toEqual({ meta: [], blocks: [{ t: "prose", text: "# DESIGN.md\n\ntext", anchor: "ds" }] }));
});

describe("findings", () => {
  it("names the anchor first, then the quote, then the note", () => {
    expect(message({ anchor: "CAP-1 description", quote: "builds a claim from lines", text: "split per tier" })).toBe('CAP-1 description: "builds a claim from lines" — split per tier');
    expect(message({ anchor: "BR-4", text: "drop it" })).toBe("BR-4: drop it");
    expect(message({ anchor: "", text: "scope reads right" })).toBe("scope reads right");
    expect(message({ anchor: "x", quote: "a".repeat(200), text: "t" })).toBe(`x: "${"a".repeat(117)}..." — t`);
  });

  it("blocks on reject, notes on approve", () => {
    const ref = { apiVersion: "sdd.persimmon.ai/v1", kind: "Prd", id: "p", revision: 1 };
    expect(verdict(false, [{ anchor: "G-1", text: "vague" }], [ref])).toEqual({ passed: false, findings: [{ severity: "error", code: "blocking_1", message: "G-1: vague" }], evidence: [ref] });
    expect(verdict(true, [{ anchor: "G-1", text: "fine" }], []).findings[0]).toEqual({ severity: "info", code: "note_1", message: "G-1: fine" });
  });
});

it("words", () => expect([words("successCriteria"), words("non_goals")]).toEqual(["Success criteria", "Non goals"]));
