// The SDLC pack's phases as a map, framed by the Rewrite pack's for a rewrite, and what the store's runs say about each (37-progress.md). Pure: no DOM, no fetch.
// The server names no pack; this file is where the pack's workflows become phases.

export interface Run {
  namespace: string;
  name: string;
  workflow: string;
  phase: string;
  waitingReason?: string;
  error?: { code: string; message: string };
  created: string;
  steps: Record<string, { phase: string; iteration?: number }>;
  inputs: Record<string, { kind: string; value?: unknown }>;
  outputs: Record<string, { kind: string; value?: unknown }>;
  upstream: { kind: string; id: string }[];
  parked: { taskRun: string; task: string; verdict: boolean }[];
}

export interface Phase {
  id: string;
  title: string;
  /** The workflows whose top-level runs belong here: the phase's own, and the parts a user may run alone. */
  workflows: string[];
  /** Lane (left to right) and step (top to bottom) on the map: the flow reads downwards, beside the panel. */
  lane: number;
  step: number;
  /** A Rewrite pack phase (40-pack-rewrite.md): on a rewrite's map only. */
  rewrite?: boolean;
}

export const phases: Phase[] = [
  { id: "survey", title: "Survey", workflows: ["survey", "survey-work"], lane: 0.5, step: -3, rewrite: true },
  { id: "inventory", title: "Inventory", workflows: ["inventory", "inventory-work"], lane: 0.5, step: -2, rewrite: true },
  { id: "characterize", title: "Characterize", workflows: ["characterize", "characterize-work"], lane: 0.5, step: -1, rewrite: true },
  { id: "recover", title: "Recover PRD", workflows: ["recover-prd", "recover-work"], lane: 0.5, step: 0, rewrite: true }, // in the PRD station's place
  { id: "prd", title: "PRD", workflows: ["author-prd"], lane: 0.5, step: 0 },
  { id: "domain", title: "Domain", workflows: ["domain-discovery", "storm-big-picture", "storm-process", "storm-design", "derive-all", "derive-one"], lane: 0.5, step: 1 },
  { id: "architecture", title: "Architecture", workflows: ["architect"], lane: 0.5, step: 2 },
  { id: "specs", title: "Specs", workflows: ["spec-all", "spec-one"], lane: 0, step: 3 },
  { id: "design-system", title: "Design system", workflows: ["design-system"], lane: 1, step: 3 },
  { id: "designs", title: "Designs", workflows: ["design-all", "design-one"], lane: 1, step: 4 },
  { id: "plans", title: "Plans", workflows: ["plan-all", "plan-one"], lane: 0, step: 5 },
  { id: "test-setup", title: "Test setup", workflows: ["setup-tests", "harness-work"], lane: 1, step: 5 },
  { id: "test-design", title: "Test design", workflows: ["test-design-all", "test-design-one"], lane: 1, step: 6 },
  { id: "build", title: "Build", workflows: ["build-all", "build-one"], lane: 0.5, step: 7 },
  { id: "parity", title: "Parity", workflows: ["parity", "parity-work"], lane: 0.5, step: 8, rewrite: true },
];

/** Upstream to downstream, as the artifacts cite (23-pack-sdlc.md); Architecture to Designs is drawn through Design system, a Spec to its
 * TestDesign through Test setup (39-test-process.md). */
export const edges: [string, string][] = [
  ["survey", "inventory"],
  ["inventory", "characterize"],
  ["characterize", "recover"],
  ["recover", "domain"],
  ["prd", "domain"],
  ["domain", "architecture"],
  ["architecture", "specs"],
  ["architecture", "design-system"],
  ["design-system", "designs"],
  ["specs", "plans"],
  ["designs", "plans"],
  ["plans", "build"],
  ["designs", "test-setup"],
  ["test-setup", "test-design"],
  ["test-design", "build"],
  ["build", "parity"],
];

/** The Rewrite pack's human Tasks: each answers a typed `decisions` value, not a verdict (40-pack-rewrite.md). */
export const decisionTasks = ["cut-slices", "decide-recovery", "review-parity"];

export const phaseOf = (workflow: string) => phases.find((p) => p.workflows.includes(workflow));

/** The Prd ids a run belongs to: what its artifacts cite, else the id its `productId` gives the Prd (`author-prd`'s first draft, a rewrite before `recover-prd`). */
export function productsOf(run: Run): string[] {
  const prds = run.upstream.filter((a) => a.kind === "Prd").map((a) => a.id);
  const stem = run.inputs.productId?.value;
  if (prds.length === 0 && typeof stem === "string") return [`${stem}-prd`];
  return [...new Set(prds)];
}

/** The phases on a product's map: a rewrite's, any of whose runs is a Rewrite pack phase's, swap PRD for the Rewrite phases. */
export function phasesOf(product: string, runs: Run[]): Phase[] {
  const rewrite = runs.some((r) => phaseOf(r.workflow)?.rewrite && productsOf(r).includes(product));
  return phases.filter((p) => (rewrite ? p.id !== "prd" : !p.rewrite));
}

/** Every product, the ones with a step waiting on you first, then the most recently active. */
export function products(runs: Run[]): string[] {
  const score = new Map<string, { parked: number; latest: string }>();
  for (const r of runs)
    for (const p of productsOf(r)) {
      const s = score.get(p) ?? { parked: 0, latest: "" };
      score.set(p, { parked: s.parked + r.parked.length, latest: r.created > s.latest ? r.created : s.latest });
    }
  return [...score].sort(([, a], [, b]) => (b.parked > 0 ? 1 : 0) - (a.parked > 0 ? 1 : 0) || b.latest.localeCompare(a.latest)).map(([p]) => p);
}

export type State = "idle" | "running" | "needs-you" | "done" | "rejected" | "failed";

export interface PhaseView {
  phase: Phase;
  state: State;
  /** One short line under the phase name. */
  detail: string;
  /** Newest first. */
  runs: Run[];
}

const value = (o: { value?: unknown } | undefined) => o?.value;

/** The Slice a Rewrite pack run works on, `SL-n`. */
export const sliceOf = (run: Run) => (typeof run.inputs.slice?.value === "string" ? run.inputs.slice.value : undefined);

/** A review loop's round, the step `rounds` its expansion runs (21-composition.md). */
export const roundOf = (run: Run) => run.steps.rounds?.iteration;

/** What one phase of one product shows: the newest run's state, unless any run waits on you. */
export function view(phase: Phase, product: string, runs: Run[]): PhaseView {
  const mine = runs.filter((r) => phase.workflows.includes(r.workflow) && productsOf(r).includes(product)).sort((a, b) => b.created.localeCompare(a.created));
  const base = { phase, runs: mine };
  const parked = mine.flatMap((r) => r.parked);
  const newest = mine[0];
  const round = newest && roundOf(newest);
  const slice = newest && sliceOf(newest);
  const inRound = `${slice ? `${slice}: ` : ""}${round ? `Round ${round}, ` : ""}`;
  // a gate asks for a verdict; any other parked step (a human drafting, the builder) asks for its work
  if (parked.length) return { ...base, state: "needs-you", detail: `${inRound}${parked.length > 1 ? `${parked.length} steps wait on you` : parked[0]!.verdict ? "your review" : "your input"}` };
  if (!newest) return { ...base, state: "idle", detail: "Not started" };
  const at = slice ? `${slice}: ` : "";
  if (newest.phase === "Failed" || newest.phase === "Cancelled") return { ...base, state: "failed", detail: `${at}${newest.error?.code ? `Failed: ${newest.error.code}` : newest.phase}` };
  if (newest.phase !== "Succeeded") return { ...base, state: "running", detail: `${inRound}${newest.waitingReason === "human" ? "waiting on a reviewer" : "running"}` };
  const rounds = value(newest.outputs.rounds);
  const after = typeof rounds === "number" ? ` after ${rounds} round${rounds === 1 ? "" : "s"}` : "";
  if (value(newest.outputs.passed) === false) return { ...base, state: "rejected", detail: `${at}Rejected${after}` };
  return { ...base, state: "done", detail: `${at}Approved${after}` };
}
