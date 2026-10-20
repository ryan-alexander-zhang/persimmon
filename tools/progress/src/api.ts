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
  return (await kinds).find((k) => k.apiVersion === ref.apiVersion && k.kind === ref.kind)?.name;
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

/** One stored revision's content. */
export async function revision(ref: RevisionRef, namespace: string): Promise<unknown> {
  const n = await kindName(ref);
  if (!n) throw new Error(`no revisioned kind ${ref.kind}`);
  const r = await call<{ spec: { content: unknown } }>(`/api/artifacts/${ref.namespace ?? namespace}/${n}/${ref.id}/${ref.revision}`);
  return r.spec.content;
}
