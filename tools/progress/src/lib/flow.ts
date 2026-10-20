// The SDLC pack's phases as a map, and what the store's runs say about each (37-progress.md). Pure: no DOM, no fetch.
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
}

export const phases: Phase[] = [
  { id: "prd", title: "PRD", workflows: ["author-prd"], lane: 0.5, step: 0 },
  { id: "domain", title: "Domain", workflows: ["domain-discovery", "storm-big-picture", "storm-process", "storm-design", "derive-all", "derive-one"], lane: 0.5, step: 1 },
  { id: "architecture", title: "Architecture", workflows: ["architect"], lane: 0.5, step: 2 },
  { id: "specs", title: "Specs", workflows: ["spec-all", "spec-one"], lane: 0, step: 3 },
  { id: "design-system", title: "Design system", workflows: ["design-system"], lane: 1, step: 3 },
  { id: "designs", title: "Designs", workflows: ["design-all", "design-one"], lane: 1, step: 4 },
  { id: "plans", title: "Plans", workflows: ["plan-all", "plan-one"], lane: 0.5, step: 5 },
  { id: "build", title: "Build", workflows: ["build-all", "build-one"], lane: 0.5, step: 6 },
];

/** Upstream to downstream, as the artifacts cite (23-pack-sdlc.md); Architecture to Designs is drawn through Design system. */
export const edges: [string, string][] = [
  ["prd", "domain"],
  ["domain", "architecture"],
  ["architecture", "specs"],
  ["architecture", "design-system"],
  ["design-system", "designs"],
  ["specs", "plans"],
  ["designs", "plans"],
  ["plans", "build"],
];

export const phaseOf = (workflow: string) => phases.find((p) => p.workflows.includes(workflow));

/** The Prd ids a run belongs to: what its artifacts cite, else the id `author-prd` will give its first draft. */
export function productsOf(run: Run): string[] {
  const prds = run.upstream.filter((a) => a.kind === "Prd").map((a) => a.id);
  const stem = run.inputs.productId?.value;
  if (prds.length === 0 && run.workflow === "author-prd" && typeof stem === "string") return [`${stem}-prd`];
  return [...new Set(prds)];
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

/** A review loop's round, the step `rounds` its expansion runs (21-composition.md). */
export const roundOf = (run: Run) => run.steps.rounds?.iteration;

/** What one phase of one product shows: the newest run's state, unless any run waits on you. */
export function view(phase: Phase, product: string, runs: Run[]): PhaseView {
  const mine = runs.filter((r) => phase.workflows.includes(r.workflow) && productsOf(r).includes(product)).sort((a, b) => b.created.localeCompare(a.created));
  const base = { phase, runs: mine };
  const parked = mine.flatMap((r) => r.parked);
  const newest = mine[0];
  const round = newest && roundOf(newest);
  const inRound = round ? `Round ${round}, ` : "";
  if (parked.length) return { ...base, state: "needs-you", detail: `${inRound}${parked.length > 1 ? `${parked.length} reviews wait` : "your review"}` };
  if (!newest) return { ...base, state: "idle", detail: "Not started" };
  if (newest.phase === "Failed" || newest.phase === "Cancelled") return { ...base, state: "failed", detail: newest.error?.code ? `Failed: ${newest.error.code}` : newest.phase };
  if (newest.phase !== "Succeeded") return { ...base, state: "running", detail: `${inRound}${newest.waitingReason === "human" ? "waiting on a reviewer" : "running"}` };
  const rounds = value(newest.outputs.rounds);
  const after = typeof rounds === "number" ? ` after ${rounds} round${rounds === 1 ? "" : "s"}` : "";
  if (value(newest.outputs.passed) === false) return { ...base, state: "rejected", detail: `Rejected${after}` };
  return { ...base, state: "done", detail: `Approved${after}` };
}
