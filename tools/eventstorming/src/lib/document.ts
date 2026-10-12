// Opening and saving the board as an EventStorming revision (25-ui.md): the URL
// says which one, Save publishes the next, and a file goes in and out as the
// Resource envelope the engine reads.

import YAML from "yaml";
import { ApiError, type ArtifactRef, getRevision, saveRevision } from "@/lib/api";
import { stripCreatedAt, toModel } from "@/lib/dsl/serialize";
import type { Model } from "@/lib/eventstorming/grammar";
import { useESStore } from "@/lib/store/store";

const DEFAULT_NAMESPACE = "default";

export interface Location {
  namespace: string;
  /** Null means no artifact chosen: the picker opens. */
  id: string | null;
  revision: number | "latest";
}

/** A DNS label — what an artifact id has to be (00-resource.md). */
export const isDnsLabel = (id: string) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(id);

export function readLocation(search = window.location.search): Location {
  const params = new URLSearchParams(search);
  const rev = params.get("rev");
  return {
    namespace: params.get("ns") || DEFAULT_NAMESPACE,
    id: params.get("id"),
    revision: rev && /^\d+$/.test(rev) ? Number(rev) : "latest",
  };
}

/** Point the URL at a revision, without reloading the page. */
export function navigate(namespace: string, id: string, revision: number | "latest"): void {
  const params = new URLSearchParams({ ns: namespace, id });
  if (revision !== "latest") params.set("rev", String(revision));
  window.history.pushState(null, "", `?${params}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Load a revision onto the board. `latest` is editable; an older one opens read-only. */
export async function open(
  namespace: string,
  id: string,
  revision: number | "latest",
): Promise<void> {
  const resource = await getRevision(namespace, id, revision);
  const current = await (revision === "latest"
    ? Promise.resolve(resource.spec.identity.revision)
    : getRevision(namespace, id, "latest").then((r) => r.spec.identity.revision));
  useESStore.getState().openDocument(
    {
      namespace,
      id,
      revision: resource.spec.identity.revision,
      readOnly: resource.spec.identity.revision !== current,
    },
    resource.spec.content,
  );
}

/** The board as a DSL v4.0 model. */
export function currentModel(): Model {
  const s = useESStore.getState();
  return toModel(
    s.nodes,
    s.edges,
    s.contexts,
    { name: s.doc?.name ?? s.doc?.id ?? "Event Storming", level: s.level },
    s.contextRelationships,
  );
}

/** Publish the board as the next revision and move the URL onto it. The save
 *  declares the revision it was edited from, so the API refuses it when someone
 *  else published in the meantime rather than writing over them. */
export async function save(): Promise<ArtifactRef> {
  const doc = useESStore.getState().doc;
  if (!doc) throw new Error("no open model");
  const ref = await saveRevision(
    doc.namespace,
    doc.id,
    currentModel(),
    doc.base ?? undefined,
  ).catch((e: unknown) => {
    if (e instanceof ApiError && e.code === "conflict") {
      const what =
        doc.base === null
          ? "This model already has revisions"
          : `r${doc.base} is no longer the latest revision`;
      throw new Error(`${what} — reload the latest revision, then save again.`);
    }
    throw e;
  });
  useESStore.getState().markSaved(ref.revision);
  navigate(doc.namespace, doc.id, ref.revision);
  return ref;
}

/** The file an export downloads: the Resource envelope `persimmon create` reads
 *  back (00-resource.md). It carries the *next* revision — `revision` is the one
 *  on the board — so creating the file stores it as that next revision. */
export function exportFile(
  id: string,
  revision: number | null,
  content: Model,
): { name: string; yaml: string } {
  const n = (revision ?? 0) + 1;
  return {
    name: `${id}.r${n}.yaml`,
    yaml: YAML.stringify({
      apiVersion: "sdd.persimmon.ai/v1",
      kind: "EventStorming",
      metadata: { name: `${id}.r${n}` },
      spec: { identity: { id, revision: n }, content },
    }),
  };
}

/** The model inside an imported file: a Resource (YAML or JSON) or a bare old
 *  `.eventstorming.json`. JSON is YAML, so one parser reads both. */
export function parseImport(text: string): Model {
  const parsed = YAML.parse(text) as Record<string, unknown> | null;
  const kind = parsed?.kind;
  if (typeof kind === "string" && kind !== "EventStorming") {
    throw new Error(`That file is a Resource of kind ${kind}, not EventStorming.`);
  }
  const spec = parsed?.spec as { content?: unknown } | undefined;
  const model = (spec?.content ?? parsed) as Record<string, unknown> | null;
  const meta = model?.meta;
  if (model?.version !== "4.0" || typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error("That file is not a DSL 4.0 model.");
  }
  return stripCreatedAt(model) as Model;
}
