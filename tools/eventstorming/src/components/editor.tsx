import "@xyflow/react/dist/style.css";
import {
  Background,
  type Connection,
  Controls,
  type IsValidConnection,
  MarkerType,
  MiniMap,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardChrome } from "@/components/board-chrome";
import { ContextMapCanvas } from "@/components/context-map-canvas";
import { DiscoveryCanvas } from "@/components/discovery-canvas";
import { RevisionsPanel } from "@/components/revisions-panel";
import { RelationEdge } from "@/components/edges/relation-edge";
import { HealthPanel } from "@/components/health-panel";
import { PanelRail } from "@/components/panel-rail";
import { Walkthrough } from "@/components/walkthrough";
import { ElementNode, routeHandles } from "@/components/nodes/element-node";
import { Picker } from "@/components/picker";
import { PropertyPanel } from "@/components/property-panel";
import { Toolbar } from "@/components/toolbar";
import { ApiError } from "@/lib/api";
import { open as openRevision, readLocation } from "@/lib/document";
import { RELATION_STYLE } from "@/lib/eventstorming/edge-style";
import { ELEMENT_DEFINITIONS, ELEMENT_TYPES, type ElementType } from "@/lib/eventstorming/elements";
import { FULL_DETAIL_ZOOM, typesForZoom } from "@/lib/eventstorming/levels";
import { isValidConnection as canConnect } from "@/lib/eventstorming/relations";
import { computeEdgeOffsets } from "@/lib/layout/edge-spread";
import { COL_W, computeIsolateLayout, NODE_W } from "@/lib/layout/layout";
import { isShownByFilter, matchesQuery } from "@/lib/store/filter";
import {
  computeContextFocus,
  computeContextNeighborhood,
  computeFocus,
  computeNeighborhood,
} from "@/lib/store/focus";
import { type ESState, useESStore } from "@/lib/store/store";
import { dropOrder, dropTarget, slotOrders, timelineOrder } from "@/lib/store/timeline";
import type { ESEdge, ESNode } from "@/lib/store/types";

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed },
  labelBgPadding: [4, 2] as [number, number],
  labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
};

// A dimmed element paints a muted copy of its own colours; it is never made
// translucent. `opacity < 1` turns each element into its own transparency group,
// which the compositor has to build and blend on every raster — and a camera
// gesture re-rasters constantly, so a few hundred dimmed elements drop the frame
// rate to a stutter while the picture is identical (issue-00029).
const MUTED_FILL = "color-mix(in srgb, var(--es-fill) 18%, #fff)";
const MUTED_TINT = "color-mix(in srgb, var(--es-tint, #fff) 30%, #fff)";
const MUTED_TEXT = "#a1a1aa";
const MUTED_STROKE = "#d8d8dc";
const EMPTY_STYLE: CSSProperties = {};

// Tier A/C dimming is delivered as one injected rule scoped to the board wrapper,
// so it never touches per-element props (issue-00019). The bright elements are
// excluded from that rule by id rather than given a rule of their own, so nothing
// has to restore an inline colour. Element ids come from the imported DSL, so they
// must be escaped before going into a selector.
const DIM_SCOPE = ".es-dim";
const EDGE_DIM_SCOPE = ".es-dim-edges";
const cssId = (id: string) =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
const except = (ids: Iterable<string>) =>
  [...ids].map((id) => `:not([data-id="${cssId(id)}"])`).join("");

// Search-hit ring (spec-00006): a blue halo around matched nodes, distinct from
// the selection outline and from focus dimming.
const SEARCH_RING = "0 0 0 3px #2563eb, 0 0 10px 2px rgba(37, 99, 235, 0.45)";

// Walkthrough step rendering (us-00028). The Step Ring is violet, so it reads as
// neither the near-black selection outline nor the blue search ring, and the white
// gap keeps it off the sticky's own colour. Visited events keep a half-muted copy
// of that colour: brighter than the dim layer's 18%, so "walked" is a third state
// rather than a synonym for "out of scope".
const STEP_RING = "0 0 0 3px #ffffff, 0 0 0 6px #6d28d9";
const VISITED_FILL = "color-mix(in srgb, var(--es-fill) 55%, #fff)";
const VISITED_TEXT = "#52525b";

// Timeline drag (us-00010 / design-00004 §5–6). Dragging a Domain Event edits
// its `order`, never its position: the drop x is hit-tested against a snapshot
// of the context's columns taken at drag start, then translated to an order.
const ONTO_BAND = COL_W * 0.25; // ± this of a column anchor = a concurrency drop
const STICKY_H = 64; // indicator vertical padding around the Domain Events row

type DropView =
  | { kind: "gap"; x: number; top: number; height: number }
  | { kind: "onto"; x: number; top: number; height: number };

interface DragSnapshot {
  eventId: string;
  slots: { order: number; x: number }[]; // pre-drag columns, sorted left→right
  orders: number[]; // slot orders, for gap insertion
  band: { top: number; height: number };
}

// One representative x per distinct global order, from the pre-drag layout
// (decision-00005: one timeline, not per-context).
function timelineSlots(nodes: ESNode[]) {
  const x = new Map<number, number>();
  for (const n of nodes) {
    if (n.type !== "domainEvent") continue;
    const o = n.data.order ?? 0;
    if (!x.has(o)) x.set(o, n.position.x);
  }
  return [...x.entries()].map(([order, xx]) => ({ order, x: xx })).sort((a, b) => a.x - b.x);
}

function bandExtent(nodes: ESNode[]) {
  const ys = nodes.filter((n) => n.type === "domainEvent").map((n) => n.position.y);
  const top = ys.length ? Math.min(...ys) : 0;
  const bottom = ys.length ? Math.max(...ys) : 0;
  return { top: top - 6, height: bottom - top + STICKY_H };
}

function buildSnapshot(nodes: ESNode[], eventId: string): DragSnapshot {
  return {
    eventId,
    slots: timelineSlots(nodes),
    orders: slotOrders(nodes),
    band: bandExtent(nodes),
  };
}

function gapX(slots: { order: number; x: number }[], index: number) {
  if (index <= 0) return slots[0].x - (COL_W - NODE_W) / 2;
  if (index >= slots.length) return slots[slots.length - 1].x + NODE_W + (COL_W - NODE_W) / 2;
  return (slots[index - 1].x + slots[index].x) / 2 + NODE_W / 2;
}

function dropView(snap: DragSnapshot, x: number): DropView {
  const t = dropTarget(snap.slots, x, ONTO_BAND);
  const base = { top: snap.band.top, height: snap.band.height };
  if (t.kind === "onto") return { kind: "onto", x: snap.slots.find((s) => s.order === t.order)!.x, ...base };
  return { kind: "gap", x: gapX(snap.slots, t.index), ...base };
}

/** The pending-drop affordance (design-00004 §7): a vertical line for a gap
 *  insertion, a column outline for a concurrency drop. Tracks the viewport. */
function TimelineDropIndicator({ drop }: { drop: DropView }) {
  const { x: vx, y: vy, zoom } = useViewport();
  const left = drop.x * zoom + vx;
  const top = drop.top * zoom + vy;
  const height = drop.height * zoom;
  if (drop.kind === "gap") {
    return (
      <div
        className="pointer-events-none absolute z-20 -ml-px w-0.5 rounded bg-blue-500"
        style={{ left, top, height }}
      />
    );
  }
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border-2 border-blue-500 bg-blue-400/10"
      style={{ left, top, width: NODE_W * zoom, height }}
    />
  );
}

// What "changed since the revision this board was loaded from" means. It cannot be
// the nodes array: React Flow hands back new node objects for size, position, and
// selection changes, and the layout engine rebuilds them on every reflow — none of
// which a revision holds. So this compares only what does end up in the DSL. Each
// element keeps its `data` object identity through all of the above, which makes
// the comparison a walk of references rather than a serialization.
function modelFingerprint(s: ESState): unknown[] {
  const out: unknown[] = [s.contexts, s.contextRelationships, s.level, s.nodes.length, s.edges.length];
  for (const n of s.nodes) out.push(n.id, n.type, n.data);
  for (const e of s.edges) out.push(e.id, e.source, e.target, e.data);
  return out;
}

const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// The revision the board currently *is*. A load or a save changes it, and neither is
// an edit of it — the fingerprint re-baselines instead of counting one as a change.
const revisionKey = (s: ESState) =>
  s.doc && `${s.doc.namespace}/${s.doc.id}@${s.doc.revision}`;

/** Mark the open model dirty the moment anything that would be written changes. */
function useDirtyTracking() {
  useEffect(() => {
    let key = revisionKey(useESStore.getState());
    let fingerprint = modelFingerprint(useESStore.getState());
    return useESStore.subscribe((s) => {
      if (!s.doc) return;
      const next = revisionKey(s);
      if (next !== key) {
        key = next;
        fingerprint = modelFingerprint(s);
        return;
      }
      const taken = modelFingerprint(s);
      if (same(taken, fingerprint)) return;
      fingerprint = taken;
      useESStore.getState().markDirty();
    });
  }, []);
}

/** The URL is the open revision (25-ui.md): `?ns=&id=&rev=`. Without an id the
 *  picker is the whole page; with one the revision is loaded, and an id that has no
 *  revision yet starts an empty board that Save publishes as r1. */
function useRouting() {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const { namespace, id, revision } = location;
  useEffect(() => {
    if (!id) {
      useESStore.getState().openPicker();
      return;
    }
    const doc = useESStore.getState().doc;
    // Already showing it — a save navigates onto the revision it just wrote.
    if (
      doc &&
      doc.namespace === namespace &&
      doc.id === id &&
      (revision === "latest" ? !doc.readOnly : doc.revision === revision)
    ) {
      return;
    }
    let alive = true;
    void openRevision(namespace, id, revision).catch((e: unknown) => {
      if (!alive) return;
      const s = useESStore.getState();
      // An id nobody has saved yet is an empty board, not an error — but only for
      // `latest`: a missing numbered revision, or any other failure, is one, and
      // an empty board over it would invite a save that is not its next revision.
      if (revision === "latest" && e instanceof ApiError && e.code === "not_found") {
        s.newDocument(namespace, id);
        return;
      }
      s.closeDocument();
      s.setLoadError(e instanceof Error ? e.message : `${id} could not be opened.`);
    });
    return () => {
      alive = false;
    };
  }, [namespace, id, revision]);

  return location;
}

/** Unsaved edits live only in the page: the browser asks before leaving with them. */
function useUnsavedGuard() {
  const dirty = useESStore((s) => s.doc?.dirty ?? false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

function Canvas() {
  const nodes = useESStore((s) => s.nodes);
  const edges = useESStore((s) => s.edges);
  const onNodesChange = useESStore((s) => s.onNodesChange);
  const onEdgesChange = useESStore((s) => s.onEdgesChange);
  const connect = useESStore((s) => s.connect);
  const setSelected = useESStore((s) => s.setSelected);
  const setHovered = useESStore((s) => s.setHovered);
  const setHoveredEdge = useESStore((s) => s.setHoveredEdge);
  const hoveredEdgeId = useESStore((s) => s.hoveredEdgeId);
  const setSelectedEdge = useESStore((s) => s.setSelectedEdge);
  const selectedEdgeId = useESStore((s) => s.selectedEdgeId);
  const removeEdge = useESStore((s) => s.removeEdge);
  const selectedId = useESStore((s) => s.selectedId);
  const hoveredId = useESStore((s) => s.hoveredId);
  const focusedContext = useESStore((s) => s.focusedContext);
  const setFocusedContext = useESStore((s) => s.setFocusedContext);
  const contexts = useESStore((s) => s.contexts);
  const level = useESStore((s) => s.level);
  const isolate = useESStore((s) => s.isolate);
  const healthOpen = useESStore((s) => s.healthOpen);
  const walkActive = useESStore((s) => s.walk.active);
  const walkIndex = useESStore((s) => s.walk.index);
  const scopeHops = useESStore((s) => s.walk.scope);
  const discoveryActive = useESStore((s) => s.discovery.active);
  const contextMapOpen = useESStore((s) => s.contextMapOpen);
  const revisionsOpen = useESStore((s) => s.revisionsOpen);
  const filter = useESStore((s) => s.filter);
  const readOnly = useESStore((s) => s.doc?.readOnly ?? false);
  const setEventOrder = useESStore((s) => s.setEventOrder);
  const toggleIsolate = useESStore((s) => s.toggleIsolate);
  // Visible element types = the Level filter, further narrowed by semantic zoom.
  // Subscribed as the *band*, not the raw zoom: a wheel gesture changes the zoom on
  // every tick, and reading it here re-rendered the whole Canvas per tick for a band
  // that changes only at a threshold (issue-00028).
  const visibleTypeKey = useStore((s) => typesForZoom(s.transform[2], level).join("|"));
  const { fitView, getNode } = useReactFlow();

  // Timeline drag session (us-00010). `dragRef` freezes the pre-drag columns so
  // hit-testing is stable; `cancelRef` records an Escape mid-drag; `drop` drives
  // the pending-drop indicator.
  const dragRef = useRef<DragSnapshot | null>(null);
  const cancelRef = useRef(false);
  const [drop, setDrop] = useState<DropView | null>(null);

  const onNodeDragStart = useCallback(
    (_: unknown, node: ESNode) => {
      if (node.type !== "domainEvent") return;
      cancelRef.current = false;
      dragRef.current = buildSnapshot(nodes, node.id);
    },
    [nodes],
  );

  const onNodeDrag = useCallback((_: unknown, node: ESNode) => {
    if (dragRef.current) setDrop(dropView(dragRef.current, node.position.x));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: ESNode) => {
      const snap = dragRef.current;
      dragRef.current = null;
      setDrop(null);
      if (!snap) return;
      const current = nodes.find((n) => n.id === snap.eventId)?.data.order ?? 0;
      // Any stop relayouts (setEventOrder → computeLayout), so a cancel/no-op
      // still snaps the freely-dragged node back to its computed column.
      const ord = cancelRef.current
        ? current
        : dropOrder(snap.slots, snap.orders, node.position.x, ONTO_BAND);
      setEventOrder(snap.eventId, ord);
    },
    [nodes, setEventOrder],
  );

  // Escape mid-drag cancels the reorder (committed on mouse release). "i" toggles
  // Isolate on the selected element. Arrow keys move the selected Domain Event one
  // column when the canvas (not a field) has focus — the keyboard equivalent of
  // dragging (us-00010-FR-5/FR-7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        cancelRef.current = true;
        return;
      }
      // Escape (not mid-drag) clears Bounded Context Focus (spec-00010), and with
      // no context focused it leaves Isolate — the keyboard exit for a mode that
      // is sticky across the clearing click (design-00003 §3 Tier C).
      if (e.key === "Escape") {
        const s = useESStore.getState();
        if (s.focusedContext) {
          s.setFocusedContext(null);
          return;
        }
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (s.isolate.active) s.toggleIsolate();
        return;
      }
      // "i" is the keyboard twin of the panel's Isolate On/Off — the same switch, so
      // re-anchoring is still Off then On (issue-00024). Off works whatever is
      // selected; On has nothing to anchor on without a selected element, which is
      // also why the panel's control only exists there.
      if ((e.key === "i" || e.key === "I") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        const s = useESStore.getState();
        // Isolate reshapes the board, and Discovery / Context Map replace it.
        // A walkthrough has its own Reading Scope and does not share the board with
        // Isolate either (us-00029-FR-5, issue-00031).
        if (s.discovery.active || s.contextMapOpen || s.walk.active) return;
        if (!s.isolate.active && !s.selectedId) return;
        e.preventDefault();
        s.toggleIsolate();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const s = useESStore.getState();
      if (s.walk.active) return; // walkthrough is read-only (spec-00005-XFR-1)
      const n = s.nodes.find((x) => x.id === s.selectedId);
      if (n?.type !== "domainEvent") return;
      e.preventDefault();
      s.nudgeEvent(n.id, e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nodeTypes = useMemo<NodeTypes>(() => {
    const map: NodeTypes = {};
    for (const t of ELEMENT_TYPES) map[t] = ElementNode;
    return map;
  }, []);

  const edgeTypes = useMemo(() => ({ relation: RelationEdge }), []);

  // The focus set that drives dimming (design-00003 Tier A). A committed scope —
  // a focused Bounded Context (spec-00010) or a selected element — is sticky:
  // node hover no longer overrides it. Node hover only previews in the neutral
  // state (nothing committed). Edge hover still traces on top of any of these
  // (handled below via hoveredEndpoints / decoratedEdges).
  // Inside a committed scope the hovered node cannot change the result, so it must
  // not be a dependency either: every node the pointer crossed rebuilt `focus`, and
  // through it the whole edge decoration chain, for an identical set (issue-00028).
  const scoped = !!(focusedContext || selectedId);
  const hoverPreview = scoped ? null : hoveredId;

  // The walkthrough's Reading Scope (us-00029): the Current Step's neighbourhood at
  // `walk.scope` hops in either direction. It is the walkthrough's own scope — the
  // walkthrough never shares the board with Isolate (issue-00031) — and it drives
  // both what is rendered and what stays vivid, so at scope 1 the picture matches
  // the plain selection focus it replaces.
  const walkScope = useMemo(() => {
    if (!walkActive) return null;
    const current = timelineOrder(nodes)[walkIndex] ?? null;
    if (!current) return null;
    return computeNeighborhood(current, edges, { depth: scopeHops, direction: "both" });
  }, [walkActive, walkIndex, scopeHops, nodes, edges]);

  // The whole timeline is kept whatever the scope, so the reader never loses the
  // global picture of where the story is (us-00029-FR-1).
  const eventIds = useMemo(
    () => nodes.filter((n) => n.type === "domainEvent").map((n) => n.id),
    [nodes],
  );

  const focus = useMemo(() => {
    if (walkScope) return { active: true, ...walkScope };
    if (focusedContext) return computeContextFocus(focusedContext, nodes, edges);
    if (selectedId) return computeFocus(selectedId, edges);
    return computeFocus(hoverPreview, edges);
  }, [walkScope, focusedContext, selectedId, hoverPreview, nodes, edges]);

  // Isolate ("focus mode"): keep only the anchor's slice — an element's N-hop
  // neighbourhood, or a Bounded Context's members and what they are directly
  // related to; otherwise null (show everything the types allow). The anchor is
  // pinned when Isolate is switched on, so selecting another element inside the
  // view reads it without re-framing the view (issue-00024). An anchor that is no
  // longer on the board (deleted element, emptied context) frames nothing.
  const anchor = isolate.active ? isolate.anchor : null;
  const isoNodeIds = useMemo(() => {
    // A walkthrough keeps the whole timeline plus the Current Step's Reading Scope,
    // and takes the same relayout: the vacated columns and bands have to be
    // reclaimed, or the slice is left scattered across the space the hidden
    // elements used to hold (issue-00032). Every event survives, so the columns
    // come from the same set of orders on every step and the spine cannot drift.
    if (walkScope) return new Set([...eventIds, ...walkScope.nodeIds]);
    if (!anchor) return null;
    if (anchor.kind === "context") {
      const ids = computeContextNeighborhood(anchor.id, nodes, edges);
      return ids.size > 0 ? ids : null;
    }
    return nodes.some((n) => n.id === anchor.id)
      ? computeNeighborhood(anchor.id, edges, {
          depth: isolate.depth,
          direction: isolate.direction,
        }).nodeIds
      : null;
  }, [walkScope, eventIds, anchor, isolate.depth, isolate.direction, nodes, edges]);

  // Edge-hover tracing works on any edge in the neutral state, but inside a
  // committed scope (focused Bounded Context / selected element) only on edges
  // within that scope — hovering an out-of-scope line does nothing. A clicked
  // (selected) edge gets the same emphasis but sticks when the pointer leaves;
  // a live hover on another edge still previews on top (us-00025-FR-3).
  // While isolating, the scope is the whole neighbourhood — everything rendered is
  // inside it — so any of its edges traces, not just the anchor's own (issue-00023).
  const committed = !!(focusedContext || selectedId) && !isoNodeIds;
  const candidateEdgeId = hoveredEdgeId ?? selectedEdgeId;
  const activeHoveredEdgeId =
    candidateEdgeId && (!committed || focus.edgeIds.has(candidateEdgeId)) ? candidateEdgeId : null;

  // The neighbourhood is laid out as its own board, so the columns and bands the
  // hidden elements vacated are reclaimed instead of leaving the survivors spread
  // across empty space (issue-00021). Keyed on the isolate switch and the Level
  // only — never on zoom or the search filter, which must not move nodes.
  const isoLayout = useMemo(
    () => (isoNodeIds ? computeIsolateLayout(nodes, edges, contexts, level, isoNodeIds) : null),
    [isoNodeIds, nodes, edges, contexts, level],
  );

  // Every position-derived layer below reads the board through this: the isolate
  // layout while isolating, the full board otherwise.
  const boardNodes = isoLayout?.nodes ?? nodes;

  // Attach handle anchors per edge from current node positions, so the vertical
  // slice chain draws top↔bottom and timeline links left↔right.
  const routedEdges = useMemo(() => {
    const pos = new Map(boardNodes.map((n) => [n.id, n.position]));
    return edges.map((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      return a && b ? { ...e, ...routeHandles(a, b) } : e;
    });
  }, [boardNodes, edges]);

  // Keyed by the type list's *contents* (see the subscription above): a fresh Set
  // identity here would invalidate the whole node/edge decoration chain whenever the
  // zoom band is re-read (issue-00019).
  const visibleTypes = useMemo(
    () => new Set(visibleTypeKey.split("|") as ElementType[]),
    [visibleTypeKey],
  );

  // Level (+ semantic zoom) → search/filter (spec-00006). Each stage only narrows,
  // so filter never widens past what Level allows. The Isolate neighbourhood was
  // already applied by the relayout above, which is what `boardNodes` holds.
  const visibleNodes = useMemo(
    () => boardNodes.filter((n) => visibleTypes.has(n.type) && isShownByFilter(n, filter)),
    [boardNodes, visibleTypes, filter],
  );

  // Search highlight: visible nodes whose label/description match the query. Null
  // when no query, so nothing is ringed until the modeller types.
  const matchIds = useMemo(
    () =>
      filter.query.trim()
        ? new Set(visibleNodes.filter((n) => matchesQuery(n, filter.query)).map((n) => n.id))
        : null,
    [visibleNodes, filter.query],
  );

  // Dimming (Tier A) applies only when NOT isolating — isolate already removed
  // the irrelevant nodes, so everything left stays full opacity. A walkthrough is
  // the exception: it keeps the whole timeline as *context* rather than as scope, so
  // the events outside the Current Step's Reading Scope still have to dim.
  const dimActive = focus.active && (!isoNodeIds || !!walkScope);

  // Hovering an edge dims every node except that edge's two endpoints, so a
  // single connection reads as just "source → target". Otherwise the focus
  // neighbourhood is the bright set.
  const hoveredEndpoints = useMemo(() => {
    if (!activeHoveredEdgeId) return null;
    const e = edges.find((x) => x.id === activeHoveredEdgeId);
    return e ? new Set([e.source, e.target]) : null;
  }, [activeHoveredEdgeId, edges]);

  // The bright set drives Tier-A dimming, but it must not reach the nodes as props:
  // writing the dim per node rebuilds every node object, so React Flow re-renders
  // the whole board (each node = 8 handles) for one pointer move. One stylesheet
  // mutes the layer and skips the bright ids instead, which keeps hover at O(1)
  // React work whatever the board size (issue-00019).
  const brightNodeIds = hoveredEndpoints ?? (dimActive ? focus.nodeIds : null);

  // The walkthrough's three states (us-00028): the Current Step, and the Visited
  // events that are not already vivid as part of its slice. Both travel to the DOM
  // as injected CSS keyed by id, never as node props, so a step costs the same
  // React work whatever the board size (issue-00019).
  const step = useMemo(() => {
    if (!walkActive) return null;
    const order = timelineOrder(nodes);
    return { current: order[walkIndex] ?? null, visited: order.slice(0, walkIndex) };
  }, [walkActive, walkIndex, nodes]);
  const visitedIds = useMemo(
    () => (step ? step.visited.filter((id) => !brightNodeIds?.has(id)) : []),
    [step, brightNodeIds],
  );

  const dimCss = useMemo(() => {
    if (!brightNodeIds) return "";
    const dimmed = `${DIM_SCOPE} .react-flow__node${except(brightNodeIds)}`;
    // Visited events get their own fill below. They are excluded from this one
    // rather than overridden by it: every exclusion here is another attribute
    // selector, so the dim rule's specificity outruns anything that tried to.
    const muted = `${DIM_SCOPE} .react-flow__node${except([...brightNodeIds, ...visitedIds])}`;
    // The handles are an affordance for an element that is currently out of scope,
    // and each carries its own alpha — hidden rather than muted.
    return (
      `${muted} .es-sticky{background:${MUTED_FILL}!important;color:${MUTED_TEXT}!important;border-left-color:${MUTED_TINT}!important}` +
      `${dimmed} .react-flow__handle{visibility:hidden}`
    );
  }, [brightNodeIds, visitedIds]);

  // The Step Ring replaces the selection outline on the current event, so the step
  // reads as one mark instead of two stacked frames. The halo restarts on every
  // step because the rule begins matching a different element each time — a
  // re-declared animation on the same element would not replay.
  const stepCss = useMemo(() => {
    // `.es-sticky` is repeated per id: a descendant appended after the comma list
    // would bind to its last selector only.
    const visited = visitedIds
      .map((id) => `.react-flow__node[data-id="${cssId(id)}"] .es-sticky`)
      .join(",");
    const fill = visited
      ? `${visited}{background:${VISITED_FILL}!important;color:${VISITED_TEXT}!important}`
      : "";
    const current = step?.current
      ? `.react-flow__node[data-id="${cssId(step.current)}"] .es-sticky`
      : null;
    return current
      ? `${fill}${current}{outline:none!important;box-shadow:${STEP_RING};animation:es-walk-step 520ms ease-out}` +
          `@media (prefers-reduced-motion:reduce){${current}{animation:none}}`
      : fill;
  }, [step, visitedIds]);

  const decoratedNodes = useMemo(() => {
    // Domain Events are draggable to adjust the timeline (us-00010); every other
    // type stays locked. Dragging edits `order`, not position (design-00004 §1).
    // Isolate is a reading lever, and its relaid columns no longer map to the full
    // timeline, so the drag is locked while isolating — re-order on the full board
    // (issue-00021).
    return visibleNodes.map((n) => {
      // Search hit: a blue ring, kept separate from focus dimming (spec-00006).
      const style: CSSProperties = matchIds?.has(n.id)
        ? { ...n.style, boxShadow: SEARCH_RING }
        : n.style ?? EMPTY_STYLE;
      return { ...n, draggable: n.type === "domainEvent" && !isoLayout, style };
    });
  }, [visibleNodes, matchIds, isoLayout]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return routedEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [routedEdges, visibleNodes]);

  // Center offset per edge so edges sharing a column/row corridor bow apart
  // instead of overlapping on one centreline (needs node positions + measured
  // sizes so the lane centreline is computed in the space edges render in).
  const nodePos = useMemo(
    () =>
      new Map(
        boardNodes.map((n) => [
          n.id,
          { x: n.position.x, y: n.position.y, w: n.measured?.width, h: n.measured?.height },
        ]),
      ),
    [boardNodes],
  );
  const offsets = useMemo(() => computeEdgeOffsets(visibleEdges, nodePos), [visibleEdges, nodePos]);

  // Edges dim the same way as the nodes: the emphasised set is small, so only those
  // edges carry view state and get a new object; the rest keep their identity (and
  // their already-rendered path) while the stylesheet dims them (issue-00019).
  const brightEdgeIds = useMemo(() => {
    if (activeHoveredEdgeId) return new Set([activeHoveredEdgeId]);
    return focus.active && dimActive ? focus.edgeIds : null;
  }, [activeHoveredEdgeId, focus, dimActive]);

  const dimEdgeCss = useMemo(() => {
    if (!brightEdgeIds) return "";
    // Same rule as the nodes: a muted stroke, not a translucent one. The arrowhead
    // is a coloured marker that cannot be muted from CSS, so a dimmed edge drops it.
    return `${EDGE_DIM_SCOPE} .react-flow__edge${except(brightEdgeIds)} .react-flow__edge-path{stroke:${MUTED_STROKE}!important;marker-end:none!important}`;
  }, [brightEdgeIds]);

  // Colour each edge by relation, colour its arrow to match, and spread parallel
  // edges. This layer depends only on the model + layout, so it survives hover.
  const baseEdges = useMemo<ESEdge[]>(
    () =>
      visibleEdges.map((e) => {
        const relation = e.data?.relation;
        const color = relation ? RELATION_STYLE[relation].color : undefined;
        return {
          ...e,
          type: "relation",
          data: e.data ? { ...e.data, pathOffset: offsets.get(e.id) } : e.data,
          markerEnd: color ? { type: MarkerType.ArrowClosed, color } : e.markerEnd,
        };
      }),
    [visibleEdges, offsets],
  );

  // Only the emphasised edges get a new object; every other edge is handed back the
  // identity it already had, so memo(RelationEdge) skips it and its path is never
  // recomputed. Edge-hover isolation overrides focus, and is gated to in-scope edges
  // while committed (activeHoveredEdgeId).
  const decoratedEdges = useMemo<ESEdge[]>(
    () =>
      baseEdges.map((e) => {
        const hovered = activeHoveredEdgeId === e.id;
        const focused =
          !activeHoveredEdgeId && focus.active && focus.edgeIds.has(e.id);
        if (!hovered && !focused) return e;
        return {
          ...e,
          // Focused (or hovered) edges flow; reduced-motion falls back to a static
          // line via a CSS override in globals.css.
          animated: true,
          zIndex: hovered ? 1000 : undefined,
          data: e.data
            ? { ...e.data, focusState: focused ? "on" : "none", hover: hovered ? "on" : undefined }
            : e.data,
        };
      }),
    [baseEdges, focus, activeHoveredEdgeId],
  );

  // Refit the view when isolate frames a subset (or clears back to the board).
  // `maxZoom` keeps a small neighbourhood from being blown up oversized when its
  // compact box is scaled to the viewport (issue-00021).
  const isoKey = isoNodeIds
    ? `${anchor?.kind}:${anchor?.id}|${isolate.direction}|${isolate.depth}`
    : "off";

  // Where the camera goes when Isolate is left. The modeller wants the element they
  // were just reading, which is the last one they selected inside the view — the
  // anchor's own slice only while they have selected nothing else (issue-00025).
  // Kept past the exit, and dropped when a new anchor starts a new view. A null
  // `selectedId` never erases the selection here, so the clearing click cannot race
  // it away.
  const exitRef = useRef<{ key: string; ids: string[]; selection: string | null } | null>(null);
  // Whether the previous render was inside a view. `isoKey` identifies the *view*, so
  // it cannot tell two readings of the same one apart: re-isolating the same anchor at
  // the same direction and depth kept the element read the last time round and left the
  // camera there instead of on what was just isolated (issue-00030). Entering always
  // starts a fresh reading. Cleared here rather than on exit, because the refit below
  // still has to read what this effect recorded.
  const openRef = useRef(false);
  useEffect(() => {
    if (!isoNodeIds || !anchor) {
      openRef.current = false;
      return;
    }
    if (!openRef.current || exitRef.current?.key !== isoKey) {
      // An element anchor frames itself; a context anchor frames the slice it kept.
      const ids = anchor.kind === "context" ? [...isoNodeIds] : [anchor.id];
      exitRef.current = { key: isoKey, ids, selection: null };
    }
    openRef.current = true;
    if (selectedId && selectedId !== anchor.id) exitRef.current.selection = selectedId;
  }, [isoNodeIds, anchor, isoKey, selectedId]);

  useEffect(() => {
    const t = setTimeout(() => {
      // On leaving isolate, recenter on what was being read — else on the anchor's
      // slice; if none of it is on the board any more, fit the board as before.
      const s = isoKey === "off" ? exitRef.current : null;
      const ids = s
        ? s.selection && getNode(s.selection)
          ? [s.selection]
          : s.ids.filter((id) => getNode(id))
        : [];
      // Framing a chosen subset never zooms out past the detail threshold: a wide
      // slice (a whole Bounded Context can span most of the timeline) is better read
      // at readable size and panned than shrunk until its stickies lose their text.
      // The whole-board fit is exempt — that view exists to orient, not to read.
      const framed = isoKey !== "off" || ids.length > 0;
      const target = ids.length > 0 ? { nodes: ids.map((id) => ({ id })) } : {};
      fitView({
        padding: 0.2,
        duration: 300,
        maxZoom: 1,
        ...(framed ? { minZoom: FULL_DETAIL_ZOOM } : {}),
        ...target,
      });
    }, 0);
    return () => clearTimeout(t);
  }, [isoKey, fitView, getNode]);

  // Delete / Backspace removes the selected relation edge (us-00025-FR-4). Scoped
  // to edges only — nodes are removed from the Property Panel, so a stray keypress
  // never deletes a node. Ignored while typing in a field.
  useEffect(() => {
    if (!selectedEdgeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      removeEdge(selectedEdgeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeId, removeEdge]);

  const onConnect = useCallback((c: Connection) => void connect(c), [connect]);

  // Manual links stay possible for cross-context/ambiguous relations; the rule
  // table validates them. Positions are never hand-set — a Domain Event drag
  // edits its timeline order (us-00010), everything else is computed.
  const isValidConnection = useCallback<IsValidConnection>(
    (c) => {
      const s = nodes.find((n) => n.id === c.source);
      const t = nodes.find((n) => n.id === c.target);
      return !!s?.type && !!t?.type && canConnect(s.type, t.type);
    },
    [nodes],
  );

  // The structured timeline board (and its chrome/panels) shows only when no
  // alternate view — Discovery or Context Map — is open.
  const boardView = !discoveryActive && !contextMapOpen;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div
          className={`relative flex-1${brightNodeIds ? " es-dim" : ""}${brightEdgeIds ? " es-dim-edges" : ""}`}
        >
          {/* Tier A/C dimming and the walkthrough's step marking, as one rule
              rather than per-element props. */}
          {(dimCss || dimEdgeCss || stepCss) && <style>{dimCss + dimEdgeCss + stepCss}</style>}
          {contextMapOpen ? (
            <ContextMapCanvas />
          ) : discoveryActive ? (
            <DiscoveryCanvas />
          ) : (
          <ReactFlow
            nodes={decoratedNodes}
            edges={decoratedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={null}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            minZoom={0.2}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, n) => {
              setSelected(n.id);
              setSelectedEdge(null);
            }}
            // Node hover is a preview for the neutral state only, so inside a
            // committed scope it is not even recorded: the hovered id has one
            // reader (`hoverPreview`), which ignores it there, and storing it
            // re-rendered the board for every node the pointer crossed — which is
            // most of a pan gesture (issue-00028). Normalised to null rather than
            // skipped, so clearing the scope cannot resurrect a stale hover.
            onNodeMouseEnter={(_, n) => setHovered(scoped ? null : n.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onEdgeClick={(_, e) => {
              setSelectedEdge(e.id);
              setSelected(null);
            }}
            onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            onPaneClick={() => {
              setSelected(null);
              setSelectedEdge(null);
              setHovered(null);
              setFocusedContext(null);
              // The clearing click also leaves Isolate — the anchor is pinned, so
              // otherwise nothing would take the view back to the whole board
              // (issue-00024). The camera then recenters on that anchor.
              if (useESStore.getState().isolate.active) toggleIsolate();
            }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
          >
            <Background />
            <MiniMap
              zoomable
              pannable
              nodeColor={(n) => ELEMENT_DEFINITIONS[n.type as ElementType]?.color ?? "#ccc"}
            />
            <Controls />
          </ReactFlow>
          )}
          {boardView && <BoardChrome isolated={isoLayout} />}
          {boardView && drop && <TimelineDropIndicator drop={drop} />}
          {boardView && walkActive && <Walkthrough />}
        </div>
        {/* Right region: the active docked panel (Health/Revisions are mutually
            exclusive), the always-docked Inspector, then the panel rail. */}
        {boardView && healthOpen && <HealthPanel />}
        {boardView && revisionsOpen && <RevisionsPanel />}
        {boardView && <PropertyPanel />}
        {boardView && <PanelRail />}
      </div>
    </div>
  );
}

export function Editor() {
  // Routing lives here, not in Canvas: it is what opens the revision that decides
  // whether a board renders at all.
  const location = useRouting();
  useDirtyTracking();
  useUnsavedGuard();
  const doc = useESStore((s) => s.doc);
  const pickerOpen = useESStore((s) => s.pickerOpen);
  return (
    <ReactFlowProvider>
      {doc ? <Canvas /> : null}
      {(!doc || pickerOpen) && <Picker namespace={location.namespace} />}
    </ReactFlowProvider>
  );
}
