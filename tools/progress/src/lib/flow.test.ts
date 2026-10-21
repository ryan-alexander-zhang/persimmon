import { describe, expect, it } from "vitest";
import { edges, phases, phasesOf, products, productsOf, type Run, runView, view } from "./flow";

const run = (o: Partial<Run>): Run => ({ namespace: "default", name: "r", workflow: "author-prd", phase: "Running", created: "2026-10-20T01:00:00Z", steps: {}, inputs: {}, outputs: {}, upstream: [], parked: [], ...o });
const phase = (id: string) => phases.find((p) => p.id === id)!;

describe("productsOf", () => {
  it("is every Prd the run's artifacts reach, else the id author-prd gives its first draft", () => {
    expect(productsOf(run({ workflow: "architect", upstream: [{ kind: "Prd", id: "claims-prd" }, { kind: "BusinessRules", id: "claims-rules" }] }))).toEqual(["claims-prd"]);
    expect(productsOf(run({ inputs: { productId: { kind: "value", value: "claims" } } }))).toEqual(["claims-prd"]);
    expect(productsOf(run({ workflow: "design-check" }))).toEqual([]);
  });

  it("puts a rewrite under the Prd id recover-prd will give, until its runs cite that Prd", () => {
    const stem = { productId: { kind: "value", value: "jpetstore" } };
    expect(productsOf(run({ workflow: "survey", inputs: stem }))).toEqual(["jpetstore-prd"]);
    expect(productsOf(run({ workflow: "inventory", inputs: stem, upstream: [{ kind: "SourceInventory", id: "jpetstore-inventory" }] }))).toEqual(["jpetstore-prd"]);
    expect(productsOf(run({ workflow: "parity", inputs: stem, upstream: [{ kind: "Prd", id: "jpetstore-prd" }] }))).toEqual(["jpetstore-prd"]);
  });

  it("orders products with a step waiting on you first, then the most recent", () => {
    const runs = [
      run({ upstream: [{ kind: "Prd", id: "old" }], created: "2026-10-19T00:00:00Z", parked: [{ taskRun: "t", task: "confirm-prd", verdict: true }] }),
      run({ upstream: [{ kind: "Prd", id: "new" }], created: "2026-10-20T00:00:00Z" }),
      run({ upstream: [{ kind: "Prd", id: "newer" }], created: "2026-10-21T00:00:00Z" }),
    ];
    expect(products(runs)).toEqual(["old", "newer", "new"]);
  });
});

describe("view", () => {
  const prd = [{ kind: "Prd", id: "p" }];
  it("is idle with no run, and waiting on you when any run of the phase is parked here", () => {
    expect(view(phase("domain"), "p", [])).toMatchObject({ state: "idle", detail: "Not started" });
    const parked = run({ upstream: prd, steps: { rounds: { phase: "Pending", iteration: 2 } }, parked: [{ taskRun: "t", task: "confirm-prd", verdict: true }] });
    expect(view(phase("prd"), "p", [parked])).toMatchObject({ state: "needs-you", detail: "Round 2, your review" });
    const drafting = { ...parked, parked: [{ taskRun: "t", task: "draft-prd", verdict: false }] };
    expect(view(phase("prd"), "p", [drafting])).toMatchObject({ state: "needs-you", detail: "Round 2, your input" }); // no verdict to give: not a review
  });

  it("reads the newest run: running with its round, approved or rejected after its rounds, failed with its code", () => {
    expect(view(phase("prd"), "p", [run({ upstream: prd, steps: { rounds: { phase: "Pending", iteration: 1 } } })])).toMatchObject({ state: "running", detail: "Round 1, running" });
    const done = (passed: boolean, rounds: number) => run({ upstream: prd, phase: "Succeeded", outputs: { passed: { kind: "value", value: passed }, rounds: { kind: "value", value: rounds } } });
    expect(view(phase("prd"), "p", [done(true, 1)])).toMatchObject({ state: "done", detail: "Approved after 1 round" });
    expect(view(phase("prd"), "p", [done(false, 3)])).toMatchObject({ state: "rejected", detail: "Rejected after 3 rounds" });
    const failed = run({ upstream: prd, phase: "Failed", error: { code: "timeout", message: "" }, created: "2026-10-22T00:00:00Z" });
    expect(view(phase("prd"), "p", [done(true, 1), failed])).toMatchObject({ state: "failed", detail: "Failed: timeout", runs: [failed, expect.anything()] });
  });

  it("puts the Test process between the Designs and the Build (39-test-process.md)", () => {
    expect(["setup-tests", "test-design-all", "test-design-one"].map((w) => phases.find((p) => p.workflows.includes(w))!.id)).toEqual(["test-setup", "test-design", "test-design"]);
    expect(edges.filter(([from, to]) => to === "build" || from.startsWith("test-"))).toEqual([["plans", "build"], ["test-setup", "test-design"], ["test-design", "build"]]);
  });

  it("leads a run for a Slice with its Slice", () => {
    const slice = (s: string, created: string, o: Partial<Run> = {}) => run({ workflow: "inventory", upstream: prd, inputs: { slice: { kind: "value", value: s } }, created, ...o });
    expect(view(phase("inventory"), "p", [slice("SL-1", "2026-10-20T00:00:00Z", { phase: "Succeeded", outputs: { passed: { kind: "value", value: true }, rounds: { kind: "value", value: 1 } } }), slice("SL-2", "2026-10-21T00:00:00Z", { steps: { rounds: { phase: "Pending", iteration: 1 } } })])).toMatchObject({
      state: "running",
      detail: "SL-2: Round 1, running",
    });
    expect(view(phase("survey"), "p", [run({ workflow: "survey", upstream: prd, steps: { rounds: { phase: "Running", iteration: 1 } }, parked: [{ taskRun: "t", task: "cut-slices", verdict: false }] })])).toMatchObject({ state: "needs-you", detail: "Round 1, your input" });
  });

  it("takes only the product's runs of the phase's workflows", () => {
    const other = run({ workflow: "architect", upstream: [{ kind: "Prd", id: "q" }] });
    expect(view(phase("architecture"), "p", [other]).state).toBe("idle");
    expect(view(phase("architecture"), "q", [other]).state).toBe("running");
  });
});

describe("runView", () => {
  it("says one run's outcome, its Slice first", () => {
    const rejected = run({ phase: "Succeeded", inputs: { slice: { kind: "value", value: "SL-1" } }, outputs: { passed: { kind: "value", value: false }, rounds: { kind: "value", value: 2 } } });
    expect(runView(rejected)).toEqual({ state: "rejected", detail: "SL-1: Rejected after 2 rounds" });
    expect(runView(run({ phase: "Failed", error: { code: "adapter", message: "" } }))).toEqual({ state: "failed", detail: "Failed: adapter" });
  });
});

describe("phasesOf", () => {
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id);
  const sdlc = ["prd", "domain", "architecture", "specs", "design-system", "designs", "plans", "test-setup", "test-design", "build"];
  it("is the SDLC phases for a product from an idea", () => expect(ids(phasesOf("p", [run({ upstream: [{ kind: "Prd", id: "p" }] })]))).toEqual(sdlc));

  it("frames a rewrite's SDLC phases with the Rewrite pack's, Recover PRD in the PRD station's place", () => {
    const survey = run({ workflow: "survey", inputs: { productId: { kind: "value", value: "jp" } } });
    expect(ids(phasesOf("jp-prd", [survey]))).toEqual(["survey", "inventory", "characterize", "recover", ...sdlc.slice(1), "parity"]);
    expect(phasesOf("other", [survey]).map((p) => p.id)).toEqual(sdlc);
    expect(edges.filter(([from, to]) => [from, to].some((id) => ["survey", "inventory", "characterize", "recover", "parity"].includes(id)))).toEqual([
      ["survey", "inventory"],
      ["inventory", "characterize"],
      ["characterize", "recover"],
      ["recover", "domain"],
      ["build", "parity"],
    ]);
  });
});
