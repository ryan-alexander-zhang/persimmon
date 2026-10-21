// The local API (25-ui.md, 37-progress.md), same origin, no auth.
import type { Run } from "./lib/flow";
import type { RevisionRef, Schema } from "./lib/document";

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const runs = () => call<{ directory: string; runs: Run[] }>("/api/runs");

/** One run and every run it owns, as `persimmon tree` walks them. */
export interface Node {
  kind: "WorkflowRun" | "TaskRun" | "GateRun" | "ValidationRun";
  name: string;
  label: string;
  phase: string;
  waitingReason?: string;
  error?: { code: string; message: string };
  created: string;
  task?: string;
  parked?: boolean;
  /** Parked and answered with Approve or Request changes; false: it asks for work, at the terminal. */
  verdict?: boolean;
  outputs?: Record<string, { kind: string; ref?: RevisionRef; refs?: RevisionRef[]; value?: unknown }>;
  result?: Verdict;
  children: Node[];
}

export interface Verdict {
  passed: boolean;
  findings?: { severity: string; code?: string; message: string }[];
}

export const tree = (ns: string, name: string) => call<Node>(`/api/runs/${ns}/${name}`);

export interface ReadingEntry {
  kind: string;
  name?: string;
  ref?: RevisionRef;
  content?: unknown;
  error?: string;
}

export interface Form {
  instructions: string;
  reading?: ReadingEntry[];
  inputs?: Record<string, { kind: string; value?: unknown }>;
  outputs: Record<string, unknown>;
  verdict: boolean;
}

export const form = (ns: string, taskRun: string) => call<Form>(`/api/inbox/${ns}/${taskRun}`);

export const answer = (ns: string, taskRun: string, outputs: Record<string, unknown>) =>
  call(`/api/inbox/${ns}/${taskRun}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outputs }) });

let kinds: Promise<{ name: string; apiVersion: string; kind: string }[]> | undefined;
const kindName = async (ref: { apiVersion: string; kind: string }) => {
  kinds ??= call("/api/kinds");
  // a ref from the hash names no apiVersion (lib/route.ts): the kind name alone, unique across the packs
  return (await kinds).find((k) => k.kind === ref.kind && (!ref.apiVersion || k.apiVersion === ref.apiVersion))?.name;
};

const schemas = new Map<string, Promise<Schema | undefined>>();
/** A kind's content schema, fetched once; descriptions only, so a miss renders without them. */
export function schemaOf(ref: { apiVersion: string; kind: string }): Promise<Schema | undefined> {
  const key = `${ref.apiVersion}/${ref.kind}`;
  if (!schemas.has(key))
    schemas.set(
      key,
      kindName(ref)
        .then((n) => (n ? call<{ schema: Schema }>(`/api/kinds/${n}`).then((r) => r.schema) : undefined))
        .catch(() => undefined),
    );
  return schemas.get(key)!;
}

/** Every stored revision number of an artifact, ascending; the counter may have skipped an abandoned one. */
export async function revisions(ref: RevisionRef, namespace: string): Promise<number[]> {
  const n = await kindName(ref);
  if (!n) return [];
  return (await call<{ revisions: number[] }>(`/api/artifacts/${ref.namespace ?? namespace}/${n}/${ref.id}`)).revisions;
}

/** The revision before `ref` of the same artifact, and its content; none for a first revision. */
export async function previous(ref: RevisionRef, namespace: string): Promise<{ revision: number; content: unknown } | undefined> {
  const rev = (await revisions(ref, namespace)).filter((r) => r < ref.revision).at(-1);
  return rev === undefined ? undefined : { revision: rev, content: await revision({ ...ref, revision: rev }, namespace) };
}

/** One stored revision's content. */
export async function revision(ref: RevisionRef, namespace: string): Promise<unknown> {
  const n = await kindName(ref);
  if (!n) throw new Error(`no revisioned kind ${ref.kind}`);
  const r = await call<{ spec: { content: unknown } }>(`/api/artifacts/${ref.namespace ?? namespace}/${n}/${ref.id}/${ref.revision}`);
  return r.spec.content;
}

/** Every artifact of a kind, one per id at its latest revision. */
export const artifacts = (kindName: string) => call<{ namespace: string; id: string; revision: number }[]>(`/api/artifacts?kind=${encodeURIComponent(kindName)}`);

/** The latest revision's content of one artifact, or undefined when there is none. */
export async function latest(kindName: string, namespace: string, id: string): Promise<unknown> {
  try {
    const r = await call<{ spec: { content: unknown } }>(`/api/artifacts/${namespace}/${kindName}/${id}/latest`);
    return r.spec.content;
  } catch {
    return undefined;
  }
}
