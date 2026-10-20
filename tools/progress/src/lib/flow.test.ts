import { describe, expect, it } from "vitest";
import { phases, products, productsOf, type Run, view } from "./flow";

const run = (o: Partial<Run>): Run => ({ namespace: "default", name: "r", workflow: "author-prd", phase: "Running", created: "2026-10-20T01:00:00Z", steps: {}, inputs: {}, outputs: {}, upstream: [], parked: [], ...o });
const phase = (id: string) => phases.find((p) => p.id === id)!;

describe("productsOf", () => {
  it("is every Prd the run's artifacts reach, else the id author-prd gives its first draft", () => {
    expect(productsOf(run({ workflow: "architect", upstream: [{ kind: "Prd", id: "claims-prd" }, { kind: "BusinessRules", id: "claims-rules" }] }))).toEqual(["claims-prd"]);
    expect(productsOf(run({ inputs: { productId: { kind: "value", value: "claims" } } }))).toEqual(["claims-prd"]);
    expect(productsOf(run({ workflow: "design-check" }))).toEqual([]);
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

  it("takes only the product's runs of the phase's workflows", () => {
    const other = run({ workflow: "architect", upstream: [{ kind: "Prd", id: "q" }] });
    expect(view(phase("architecture"), "p", [other]).state).toBe("idle");
    expect(view(phase("architecture"), "q", [other]).state).toBe("running");
  });
});
