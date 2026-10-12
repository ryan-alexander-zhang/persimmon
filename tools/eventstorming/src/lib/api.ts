// The local Engine HTTP API (25-ui.md), same-origin, no auth. The editor opens and
// saves EventStorming revisions through it; the API validates the kind schema and
// answers 400, so nothing is validated twice here.

import type { Model } from "@/lib/eventstorming/grammar";

const KIND = "eventstormings.sdd.persimmon.ai";

export interface ArtifactRef {
  apiVersion: string;
  kind: string;
  namespace: string;
  id: string;
  revision: number;
}

export interface ArtifactHistory extends Omit<ArtifactRef, "revision"> {
  /** Ascending. */
  revisions: number[];
}

export interface Resource {
  apiVersion: string;
  kind: string;
  metadata: { name: string; [k: string]: unknown };
  spec: { identity: { id: string; revision: number }; content: Model; provenance?: unknown };
  status?: unknown;
}

/** An API call that came back with an error body — `{error: {code, message}}` on a
 *  schema violation, anything else as text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(error?.message ?? `${response.status} ${response.statusText}`, error?.code ?? "http_error");
  }
  return (await response.json()) as T;
}

const base = (namespace: string, id: string) =>
  `/api/artifacts/${encodeURIComponent(namespace)}/${KIND}/${encodeURIComponent(id)}`;

/** Every EventStorming artifact in the namespace, latest revision each. */
export const listArtifacts = (namespace: string): Promise<ArtifactRef[]> =>
  call(`/api/artifacts?kind=${KIND}&namespace=${encodeURIComponent(namespace)}`);

/** One artifact's revision list. */
export const getHistory = (namespace: string, id: string): Promise<ArtifactHistory> =>
  call(base(namespace, id));

/** One revision; `rev` defaults to the latest. */
export const getRevision = (
  namespace: string,
  id: string,
  rev: number | "latest" = "latest",
): Promise<Resource> => call(`${base(namespace, id)}/${rev}`);

/** Publish a new revision of `id` from `content`; answers the revision created.
 *  `from` is the revision the content was edited from — the API refuses with 409
 *  `conflict` unless it is still the latest. Omitted for an artifact with none. */
export const saveRevision = (
  namespace: string,
  id: string,
  content: Model,
  from?: number,
): Promise<ArtifactRef> =>
  call(base(namespace, id), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, base: from }),
  });
