import "@xyflow/react/dist/style.css";
import {
  Background,
  type Connection,
  Controls,
  type EdgeTypes,
  MarkerType,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextRelationEdge } from "@/components/edges/context-relation-edge";
import { ContextNode, type ContextFlowNode } from "@/components/nodes/context-node";
import { SubdomainNode, type SubdomainFlowNode } from "@/components/nodes/subdomain-node";
import { contextTint } from "@/lib/eventstorming/context-color";
import { CONTEXT_RELATION_STYLE } from "@/lib/eventstorming/context-relations";
import { contextEdgeHandles, contextMapGroups, contextMapPositions } from "@/lib/layout/context-map";
import { computeEdgeOffsets } from "@/lib/layout/edge-spread";
import { computeFocus } from "@/lib/store/focus";
import { useESStore } from "@/lib/store/store";

const nodeTypes: NodeTypes = { context: ContextNode, subdomain: SubdomainNode };
type MapNode = ContextFlowNode | SubdomainFlowNode;
const edgeTypes: EdgeTypes = { contextRelation: ContextRelationEdge };

const NODE_DIM_OPACITY = 0.15;

// The Context Map (spec-00004 FR5): Bounded Contexts as nodes, relationships as
// typed directed edges. A distinct view over the model — it never touches the
// timeline board. Node positions are a deterministic grid + transient free drag
// (never persisted), holding the decision-00002 invariant (no hand positions in
// the model).
function ContextMapSurface() {
  const contexts = useESStore((s) => s.contexts);
  const domain = useESStore((s) => s.doc?.name);
  const relationships = useESStore((s) => s.contextRelationships);
  const addContextRelationship = useESStore((s) => s.addContextRelationship);
  const hoveredEdgeId = useESStore((s) => s.hoveredEdgeId);
  const setHoveredEdge = useESStore((s) => s.setHoveredEdge);
  const focusedContext = useESStore((s) => s.focusedContext);
  const setFocusedContext = useESStore((s) => s.setFocusedContext);
  // Node hover only previews (nothing committed), so it is this surface's own view
  // state; the board's `hoveredId` names a board node and must not take a context id.
  const [hoveredContext, setHoveredContext] = useState<string | null>(null);

  // Domain > Subdomain > Bounded Context: a subdomain box per group behind its
  // contexts (DSL 4.1), the type read off its first context (the gate holds them equal).
  const seeded = useMemo<MapNode[]>(() => {
    const pos = contextMapPositions(contexts);
    const groups: MapNode[] = contextMapGroups(contexts).map((g) => ({
      id: `subdomain:${g.subdomain ?? ""}`,
      type: "subdomain",
      position: { x: g.box.x, y: g.box.y },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
      data: {
        subdomain: g.subdomain,
        classification: g.contexts[0].classification,
        w: g.box.w,
        h: g.box.h,
      },
    }));
    const ctxNodes: MapNode[] = contexts.map((c) => ({
      id: c.id,
      type: "context",
      position: pos.get(c.id)!,
      data: {
        name: c.name,
        tint: contextTint(c.id),
        classification: c.classification,
        bigBallOfMud: c.bigBallOfMud,
      },
    }));
    return [...groups, ...ctxNodes];
  }, [contexts]);

  // The hovered id only isolates while it still names a live relationship —
  // deleting the hovered one (via its own X) must not leave every edge dimmed.
  const hoveredRelationship = useMemo(
    () => relationships.find((r) => r.id === hoveredEdgeId),
    [relationships, hoveredEdgeId],
  );

  // Bounded Context Focus on this surface (spec-00010), read the board's way
  // (design-00003 Tier A): clicking a context commits it — that context, the
  // contexts one relationship away and those relationships stay vivid, the rest
  // dims. A node hover only previews while nothing is committed, so reading a
  // relationship's label never disturbs the chosen focus.
  const contextFocus = useMemo(
    () => computeFocus(focusedContext ?? hoveredContext, relationships),
    [focusedContext, hoveredContext, relationships],
  );

  // Edge hover traces on top of any of that, but inside a committed focus only on
  // relationships within it — hovering an out-of-scope line does nothing.
  const activeHovered =
    hoveredRelationship && (!focusedContext || contextFocus.edgeIds.has(hoveredRelationship.id))
      ? hoveredRelationship
      : null;

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  // Re-seed when the set of contexts (or their names/classification/mud mark) changes;
  // editing relationships does not touch this, so drag positions survive.
  useEffect(() => setNodes(seeded), [seeded, setNodes]);

  // Route each edge to the handles facing the other node (issue-00012), from the
  // live node positions so it re-routes as a context is dragged. Measured sizes
  // come along so the corridor centreline is computed in the space edges render in.
  const posById = useMemo(
    () =>
      new Map(
        nodes.map((n) => [
          n.id,
          { x: n.position.x, y: n.position.y, w: n.measured?.width, h: n.measured?.height },
        ]),
      ),
    [nodes],
  );
  // Relationships sharing a corridor bow apart instead of stacking on one
  // centreline — the board's spread, reused (issue-00003).
  const offsets = useMemo(() => computeEdgeOffsets(relationships, posById), [
    relationships,
    posById,
  ]);
  const edges = useMemo(
    () =>
      relationships.map((r) => {
        const a = posById.get(r.source);
        const b = posById.get(r.target);
        const handles = a && b ? contextEdgeHandles(a, b) : undefined;
        // Edge-hover isolation, as on the board: the hovered relationship is
        // emphasised and flows, every other one dims (design-00003 Tier C). No
        // zIndex lift on hover — here the always-visible label is the hover
        // target, and re-parenting the edge remounts its label, which flickers
        // hover on/off. Without a hover, a focused context flows its own
        // relationships and dims the rest.
        const inFocus = contextFocus.edgeIds.has(r.id);
        const hover = activeHovered
          ? r.id === activeHovered.id
            ? "on"
            : "dim"
          : contextFocus.active && !inFocus
            ? "dim"
            : undefined;
        const focused = !activeHovered && contextFocus.active && inFocus;
        return {
          id: r.id,
          source: r.source,
          target: r.target,
          ...(handles ?? {}),
          type: "contextRelation",
          animated: hover === "on" || focused,
          data: {
            type: r.type,
            hover,
            focusState: focused ? "on" : undefined,
            pathOffset: offsets.get(r.id),
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: CONTEXT_RELATION_STYLE[r.type].color },
        };
      }),
    [relationships, posById, offsets, activeHovered, contextFocus],
  );

  // The vivid set: an isolated relationship's two endpoints, so one relationship
  // reads as just "source → target"; otherwise the focused context's neighbourhood.
  const brightNodeIds = useMemo(() => {
    if (activeHovered) return new Set([activeHovered.source, activeHovered.target]);
    return contextFocus.active ? contextFocus.nodeIds : null;
  }, [activeHovered, contextFocus]);

  const decoratedNodes = useMemo(() => {
    if (!brightNodeIds) return nodes;
    return nodes.map((n) =>
      n.type === "subdomain"
        ? n
        : { ...n, style: { ...n.style, opacity: brightNodeIds.has(n.id) ? 1 : NODE_DIM_OPACITY } },
    );
  }, [nodes, brightNodeIds]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) addContextRelationship(c.source, c.target);
    },
    [addContextRelationship],
  );

  return (
    <ReactFlow
      nodes={decoratedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
      onEdgeMouseLeave={() => setHoveredEdge(null)}
      onNodeClick={(_, n) => n.type === "context" && setFocusedContext(n.id)}
      onNodeMouseEnter={(_, n) => n.type === "context" && setHoveredContext(n.id)}
      onNodeMouseLeave={() => setHoveredContext(null)}
      onPaneClick={() => setFocusedContext(null)}
      deleteKeyCode={null}
      minZoom={0.2}
      fitView
      fitViewOptions={{ padding: 0.3 }}
    >
      <Background />
      <Controls showInteractive={false} />
      {domain && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Domain
          </span>
          <span className="text-sm font-semibold text-zinc-700">{domain}</span>
        </div>
      )}
      {contexts.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="rounded-md bg-white/80 px-4 py-2 text-sm text-zinc-500 shadow-sm">
            Add Bounded Contexts on the board, then drag between them here to map their
            relationships.
          </p>
        </div>
      )}
    </ReactFlow>
  );
}

/** Context Map view, isolated in its own React Flow provider. */
export function ContextMapCanvas() {
  return (
    <ReactFlowProvider>
      <ContextMapSurface />
    </ReactFlowProvider>
  );
}
