// Serialize between the runtime canvas (React Flow nodes + edges + contexts) and
// the DSL v4.0 Model — the `spec.content` of an EventStorming artifact
// (24-eventstorming.md). Positions are runtime-only (computed by the layout engine)
// and never stored. There is no `meta.createdAt`: the revision carries time.
// Shape is the kind schema's and the API answers 400 on a violation; the grammar's
// `check` reports the rest live in the health panel, so nothing validates here.

import type {
  Context,
  ContextRelationship,
  Level,
  Model,
  ModelNode,
} from "@/lib/eventstorming/grammar";
import { DSL_VERSION } from "@/lib/eventstorming/grammar";
import type { ESEdge, ESNode } from "@/lib/store/types";

export interface ModelMeta {
  name: string;
  level: Level;
}

/** A model with every list written out — what this exporter always produces, and
 *  what the kind requires (24-eventstorming.md). */
export type FullModel = Model & Required<Pick<Model, "contexts" | "contextRelationships" | "nodes" | "edges">>;

/** Canvas → DSL. */
export function toModel(
  nodes: ESNode[],
  edges: ESEdge[],
  contexts: Context[],
  meta: ModelMeta,
  contextRelationships: ContextRelationship[] = [],
): FullModel {
  return {
    version: DSL_VERSION,
    meta: { name: meta.name, level: meta.level },
    contexts,
    contextRelationships,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.data.label,
      ...(n.data.context !== undefined ? { context: n.data.context } : {}),
      ...(n.data.order !== undefined ? { order: n.data.order } : {}),
      properties: {
        ...(n.data.description !== undefined ? { description: n.data.description } : {}),
        ...(n.data.pivotal !== undefined ? { pivotal: n.data.pivotal } : {}),
        ...(n.data.temporal !== undefined ? { temporal: n.data.temporal } : {}),
        ...(n.data.state !== undefined ? { state: n.data.state } : {}),
        ...(n.data.kind !== undefined ? { kind: n.data.kind } : {}),
        ...(n.data.priority !== undefined ? { priority: n.data.priority } : {}),
        ...(n.data.resolution !== undefined ? { resolution: n.data.resolution } : {}),
        ...(n.data.resolvedAt !== undefined ? { resolvedAt: n.data.resolvedAt } : {}),
        ...(n.data.condition !== undefined ? { condition: n.data.condition } : {}),
        ...(n.data.execution !== undefined ? { execution: n.data.execution } : {}),
        ...(n.data.alternativeSet !== undefined
          ? { alternativeSet: n.data.alternativeSet }
          : {}),
        ...(n.data.parameters !== undefined ? { parameters: n.data.parameters } : {}),
        ...(n.data.rule !== undefined ? { rule: n.data.rule } : {}),
      },
    })) as ModelNode[],
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.data!.relation,
    })),
  };
}

/** DSL → canvas. Positions are placeholders; the layout engine computes them. */
export function fromModel(model: Model): {
  nodes: ESNode[];
  edges: ESEdge[];
  contexts: Context[];
  contextRelationships: ContextRelationship[];
  level: Level;
} {
  return {
    contexts: model.contexts ?? [],
    contextRelationships: model.contextRelationships ?? [],
    level: model.meta.level,
    nodes: (model.nodes ?? []).map((n) => {
      const p = n.properties ?? {};
      return {
        id: n.id,
        type: n.type,
        position: { x: 0, y: 0 },
        data: {
          label: n.label,
          ...(n.context !== undefined ? { context: n.context } : {}),
          ...(n.order !== undefined ? { order: n.order } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.pivotal !== undefined ? { pivotal: p.pivotal } : {}),
          ...(p.temporal !== undefined ? { temporal: p.temporal } : {}),
          ...(p.state !== undefined ? { state: p.state } : {}),
          ...(p.kind !== undefined ? { kind: p.kind } : {}),
          ...(p.priority !== undefined ? { priority: p.priority } : {}),
          ...(p.resolution !== undefined ? { resolution: p.resolution } : {}),
          ...(p.resolvedAt !== undefined ? { resolvedAt: p.resolvedAt } : {}),
          ...(p.condition !== undefined ? { condition: p.condition } : {}),
          ...(p.execution !== undefined ? { execution: p.execution } : {}),
          ...(p.alternativeSet !== undefined ? { alternativeSet: p.alternativeSet } : {}),
          ...(p.parameters !== undefined ? { parameters: p.parameters } : {}),
          ...(p.rule !== undefined ? { rule: p.rule } : {}),
        },
      };
    }),
    edges: (model.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: { relation: e.relation },
      label: e.relation,
    })),
  };
}

/** The content of an imported file: an old `.eventstorming.json` model, or the
 *  `spec.content` of a YAML Resource. `meta.createdAt` is DSL v4.0 of the old tool
 *  and not of the kind, so it is stripped on the way in (24-eventstorming.md). */
export function stripCreatedAt(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = raw as { meta?: Record<string, unknown> };
  if (!model.meta || typeof model.meta !== "object") return raw;
  const { createdAt: _dropped, ...meta } = model.meta;
  return { ...model, meta };
}
