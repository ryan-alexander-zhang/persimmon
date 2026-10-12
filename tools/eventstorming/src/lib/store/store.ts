// The canvas state store (DSL v4.0). Holds React Flow nodes/edges, bounded
// contexts, and selection. Positions are never authored — after every
// structural change the store recomputes them with the layout engine.

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import { createStore, type StateCreator } from "zustand/vanilla";
import { uid } from "@/lib/uid";
import type { Context, ContextRelationship, Model } from "@/lib/eventstorming/grammar";
import { fromModel } from "@/lib/dsl/serialize";
import {
  type ContextRelationType,
  DEFAULT_CONTEXT_RELATION,
} from "@/lib/eventstorming/context-relations";
import { ELEMENT_DEFINITIONS, type ElementType } from "@/lib/eventstorming/elements";
import type { Level } from "@/lib/eventstorming/levels";
import { resolveRelation } from "@/lib/eventstorming/relations";
import { computeLayout } from "@/lib/layout/layout";
import { EMPTY_FILTER, type FilterState } from "./filter";
import type { IsolateDirection } from "./focus";
import { eventSlotIndex, gapOrder, normalizeOrders, slotOrders, timelineOrder } from "./timeline";
import type { ESEdge, ESNode, ESNodeData } from "./types";

/** What an isolate view is framed on: the element selected when Isolate was
 *  switched on, or a whole Bounded Context. */
export interface IsolateAnchor {
  kind: "element" | "context";
  id: string;
}

/** Isolate ("focus mode") view state: hide everything outside the anchor's slice —
 *  an element's `depth`-hop neighbourhood in `direction`, or a context's members
 *  and what they are directly related to. The anchor is **pinned** when Isolate is
 *  switched on, so selecting another element inside the view reads it without
 *  re-framing the view. `direction`/`depth` apply to an element anchor only. */
export interface IsolateState {
  active: boolean;
  direction: IsolateDirection;
  depth: number;
  anchor: IsolateAnchor | null;
}

/** How far the walkthrough's Reading Scope can be widened, in hops around the
 *  Current Step (us-00029-FR-4). One hop is the event's own slice; past that the
 *  reading reaches into the neighbouring events' slices, which is context rather
 *  than a wider slice, so the range is deliberately short. */
export const WALK_SCOPE_MAX = 3;

/** A Domain Event on the transient discovery wall: a free x/y position and a
 *  label, with no timeline order and no context (decision-00004). Never written
 *  into the structured model or the DSL; persisted under a separate key. */
export interface DiscoveryItem {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** Discovery Mode ("input funnel") state: a Big-Picture-only wall of unordered
 *  events that Converge hands to the structured board. `active` is view-only;
 *  `items` are scratch data mirrored to local storage, never to the DSL. */
export interface DiscoveryState {
  active: boolean;
  items: DiscoveryItem[];
}

/** The open EventStorming artifact (25-ui.md): which revision of which artifact the
 *  board was loaded from, and whether it has been edited since. A revision is
 *  immutable, so Save always writes a *new* one — opening an older revision only
 *  marks the board read-only until it is saved on as the newest. */
export interface OpenDocument {
  namespace: string;
  id: string;
  /** `meta.name` of the model. */
  name: string;
  /** The revision loaded, or null for a model that has never been saved. */
  revision: number | null;
  /** The revision the next Save declares as its base — the one loaded, or the
   *  latest when an older revision was taken on with `editAsNewRevision`. Null
   *  for a model that has never been saved. */
  base: number | null;
  /** An older revision, opened to read. Editing it is saving a new revision. */
  readOnly: boolean;
  /** Edited since the revision it was loaded from. */
  dirty: boolean;
}

export interface ESState {
  nodes: ESNode[];
  edges: ESEdge[];
  contexts: Context[];
  /** Typed directed relationships between Bounded Contexts (spec-00004 FR5). */
  contextRelationships: ContextRelationship[];
  level: Level;
  selectedId: string | null;
  /** Transient hover target; drives the focus highlight, never persisted. */
  hoveredId: string | null;
  /** Bounded Context Focus (spec-00010): the focused context's slice stays vivid
   *  and the rest dims. View-only, never persisted. */
  focusedContext: string | null;
  /** Transient hovered edge; drives edge-hover isolation, never persisted. */
  hoveredEdgeId: string | null;
  /** Clicked (selected) edge; a sticky highlight and the Delete-key target
   *  (us-00025-FR-3/FR-4). View-only, never persisted. */
  selectedEdgeId: string | null;
  /** Isolate/focus mode; view-only, never persisted. */
  isolate: IsolateState;
  /** Model-health panel visibility (spec-00007); view-only, never persisted. */
  healthOpen: boolean;
  /** Narrative walkthrough cursor and its Reading Scope — how many hops around the
   *  Current Step stay visible (us-00029). View-only, never persisted. */
  walk: { active: boolean; index: number; scope: number };
  /** Discovery Mode wall (spec-00002); transient, persisted outside the DSL. */
  discovery: DiscoveryState;
  /** Search + filter view state (spec-00006); view-only, never persisted. */
  filter: FilterState;
  /** Context Map view visibility (spec-00004 FR5); view-only, never persisted. */
  contextMapOpen: boolean;
  /** The open artifact. Null means no board: the Modeler picks or creates one first. */
  doc: OpenDocument | null;
  /** Why the last save did not land, or null. Surfaced rather than swallowed. */
  saveError: string | null;
  /** Why the revision in the URL could not be opened, or null. There is no board
   *  to carry it, so the picker shows it. */
  loadError: string | null;
  /** Picker (open / new model) visibility. Forced open whenever no artifact is
   *  open — with no board there is nothing else to show. View-only. */
  pickerOpen: boolean;
  /** Revision list visibility; view-only. */
  revisionsOpen: boolean;

  setLevel: (level: Level) => void;
  toggleIsolate: () => void;
  isolateContext: (contextId: string) => void;
  setIsolateDirection: (direction: IsolateDirection) => void;
  setIsolateDepth: (depth: number) => void;
  toggleHealth: () => void;
  /** Start the walkthrough at the first Domain Event in timeline order. */
  startWalkthrough: () => void;
  /** Move the walkthrough cursor one step (clamped), selecting that event. */
  walkStep: (dir: -1 | 1) => void;
  /** Set the Reading Scope, clamped to 1..WALK_SCOPE_MAX hops (us-00029-FR-4). */
  setWalkScope: (scope: number) => void;
  stopWalkthrough: () => void;

  /** Enter Discovery Mode; no-op unless at Big Picture (decision-00004). */
  enterDiscovery: () => void;
  /** Leave Discovery Mode; the wall's items are kept for re-entry. */
  exitDiscovery: () => void;
  /** Drop an unordered event on the wall at a free position; returns its id. */
  addDiscoveryItem: (x: number, y: number, label?: string) => string;
  /** Move a wall event to a new free position (drag). */
  moveDiscoveryItem: (id: string, x: number, y: number) => void;
  /** Rename a wall event. */
  updateDiscoveryItem: (id: string, label: string) => void;
  /** Remove a wall event. */
  removeDiscoveryItem: (id: string) => void;
  /** Converge the wall: create one Ungrouped Domain Event per item, ordered by
   *  left→right (x) position on the global timeline, then clear the wall and
   *  leave Discovery Mode (us-00017). Empty wall → just leave the mode. */
  converge: () => void;

  /** Set the free-text search query (spec-00006). */
  setFilterQuery: (query: string) => void;
  /** Toggle an element type in the type filter (empty set = all types). */
  toggleFilterType: (type: ElementType) => void;
  /** Toggle a Bounded Context in the context filter (`null` = Ungrouped). */
  toggleFilterContext: (context: string | null) => void;
  /** Reset search + filters to show everything. */
  clearFilter: () => void;

  onNodesChange: (changes: NodeChange<ESNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ESEdge>[]) => void;

  /** Add a bounded context; returns its id. */
  addContext: (name: string) => string;
  renameContext: (id: string, name: string) => void;
  /** Set (or clear, with undefined) a Bounded Context's subdomain classification. */
  setContextClassification: (
    id: string,
    classification: "core" | "supporting" | "generic" | undefined,
  ) => void;
  /** Mark (or clear, with undefined) a Bounded Context as a Big Ball of Mud (decision-00015). */
  setContextBigBallOfMud: (id: string, bigBallOfMud: true | undefined) => void;
  /** Add a directed relationship source→target (default Customer/Supplier); returns its id. */
  addContextRelationship: (source: string, target: string) => string;
  /** Change a context relationship's type. */
  setContextRelationshipType: (id: string, type: ContextRelationType) => void;
  /** Remove a context relationship. */
  removeContextRelationship: (id: string) => void;
  /** Toggle the Context Map view. */
  toggleContextMap: () => void;
  /** Remove a context along with its member nodes and their edges. */
  removeContext: (id: string) => void;
  /** Add a node of `type` in `context` (omit/empty → Ungrouped); Domain Events get
   *  the next order on the global timeline (decision-00005). */
  addNode: (type: ElementType, context?: string, data?: Partial<ESNodeData>) => string;
  updateNodeData: (id: string, patch: Partial<ESNodeData>) => void;
  removeNode: (id: string) => void;
  /** Attach a hotspot to `targetId` (inherits its context); returns the hotspot id. */
  addHotspot: (targetId: string, text: string) => string;
  /** Open or resolve a Hotspot. Resolving stamps `resolvedAt`; setting it back to
   *  `open` changes the state and nothing else (us-00033-FR-3). */
  setHotspotState: (id: string, state: "open" | "resolved") => void;
  /** Attach an opportunity to `targetId` (inherits its context); returns its id. */
  addOpportunity: (targetId: string, text: string) => string;
  /** Create a semantic edge if the connection is valid; returns success. */
  connect: (connection: Connection) => boolean;
  /** Remove a relation edge, leaving its endpoint elements in place (us-00025-FR-1). */
  removeEdge: (id: string) => void;
  /** Set a Domain Event's global timeline order, then normalize the timeline to a
   *  contiguous slot sequence (preserving concurrency). Fractional orders are
   *  allowed — the UI uses them to insert between slots. */
  setEventOrder: (eventId: string, order: number) => void;
  /** Move a Domain Event one timeline column toward the start (-1) or end (1). */
  nudgeEvent: (eventId: string, dir: -1 | 1) => void;
  /** Send a Domain Event to the start (-1) or end (1) of the global timeline. */
  moveEventToEnd: (eventId: string, dir: -1 | 1) => void;
  /** Move a node into another bounded context. */
  reassignContext: (nodeId: string, context: string) => void;

  /** Toggle the revision list. */
  toggleRevisions: () => void;

  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setHoveredEdge: (id: string | null) => void;
  /** Select (highlight) an edge, or clear with null (us-00025-FR-3). */
  setSelectedEdge: (id: string | null) => void;
  /** Focus a Bounded Context (single-select); passing the current id or null
   *  clears focus. */
  setFocusedContext: (id: string | null) => void;
  setModel: (model: {
    nodes: ESNode[];
    edges: ESEdge[];
    contexts: Context[];
    contextRelationships?: ContextRelationship[];
    level?: Level;
  }) => void;
  clear: () => void;

  /** Load a revision onto the board: its model replaces whatever was there. */
  openDocument: (doc: Omit<OpenDocument, "name" | "dirty" | "base">, model: Model) => void;
  /** Start an empty model under `namespace`/`id`; nothing is written until Save. */
  newDocument: (namespace: string, id: string) => void;
  closeDocument: () => void;
  /** The model changed since the revision it was loaded from. */
  markDirty: () => void;
  /** Record that the board now *is* revision `revision`. */
  markSaved: (revision: number) => void;
  /** Take an older revision on for editing: the next Save forks from it onto
   *  `base`, which has to be the latest revision or the API refuses it. */
  editAsNewRevision: (base: number) => void;
  setSaveError: (message: string | null) => void;
  setLoadError: (message: string | null) => void;
  openPicker: () => void;
  closePicker: () => void;
}

// Recompute positions from the model whenever structure — or the Level — changes.
// The Level collapses its hidden bands, so switching Level reflows the board
// (issue-00009).
function laidOut(nodes: ESNode[], edges: ESEdge[], contexts: Context[], level: Level): ESNode[] {
  return computeLayout(nodes, edges, contexts, level);
}

const initializer: StateCreator<ESState> = (set, get) => ({
  nodes: [],
  edges: [],
  contexts: [],
  contextRelationships: [],
  level: "design",
  selectedId: null,
  hoveredId: null,
  focusedContext: null,
  hoveredEdgeId: null,
  selectedEdgeId: null,
  isolate: { active: false, direction: "down", depth: 2, anchor: null },
  healthOpen: false,
  walk: { active: false, index: 0, scope: 1 },
  discovery: { active: false, items: [] },
  filter: EMPTY_FILTER,
  contextMapOpen: false,
  doc: null,
  saveError: null,
  loadError: null,
  pickerOpen: false,
  revisionsOpen: false,

  setLevel: (level) =>
    set({
      level,
      nodes: laidOut(get().nodes, get().edges, get().contexts, level),
      // Discovery is Big-Picture only; leaving that level exits the mode but
      // keeps the wall's items for re-entry (spec-00002 §5).
      discovery:
        level === "big-picture" ? get().discovery : { ...get().discovery, active: false },
    }),
  toggleIsolate: () => {
    const on = !get().isolate.active;
    // Switching on pins the current selection as the anchor; switching off releases it.
    const selectedId = get().selectedId;
    const anchor: IsolateAnchor | null =
      on && selectedId ? { kind: "element", id: selectedId } : null;
    set({ isolate: { ...get().isolate, active: on, anchor } });
  },
  // Isolating a whole Bounded Context: the same view, anchored on the context
  // instead of an element (its `⋯` menu is the entry point).
  isolateContext: (contextId) =>
    set({ isolate: { ...get().isolate, active: true, anchor: { kind: "context", id: contextId } } }),
  setIsolateDirection: (direction) => set({ isolate: { ...get().isolate, direction } }),
  setIsolateDepth: (depth) => set({ isolate: { ...get().isolate, depth: Math.max(1, depth) } }),
  // Health and the revision list dock into the same column, so one closes the other.
  toggleHealth: () => set({ healthOpen: !get().healthOpen, revisionsOpen: false }),

  // A walkthrough carries its own Reading Scope (us-00029), so it never shares a
  // board with Isolate — two independent pointers into one board is what made a step
  // land on an event the isolated board had hidden (issue-00031). Starting one leaves
  // Isolate; the editor and the panel keep it unavailable until the walk ends.
  startWalkthrough: () => {
    const order = timelineOrder(get().nodes);
    set({
      walk: { ...get().walk, active: true, index: 0 },
      selectedId: order[0] ?? null,
      isolate: { ...get().isolate, active: false, anchor: null },
    });
  },
  walkStep: (dir) => {
    const order = timelineOrder(get().nodes);
    if (order.length === 0) return;
    const index = Math.min(order.length - 1, Math.max(0, get().walk.index + dir));
    set({ walk: { ...get().walk, index }, selectedId: order[index] });
  },
  setWalkScope: (scope) =>
    set({ walk: { ...get().walk, scope: Math.min(WALK_SCOPE_MAX, Math.max(1, scope)) } }),
  stopWalkthrough: () => set({ walk: { ...get().walk, active: false } }),

  enterDiscovery: () => {
    if (get().level !== "big-picture") return;
    set({ discovery: { ...get().discovery, active: true } });
  },
  exitDiscovery: () => set({ discovery: { ...get().discovery, active: false } }),
  addDiscoveryItem: (x, y, label) => {
    const id = uid();
    const item: DiscoveryItem = { id, label: label ?? ELEMENT_DEFINITIONS.domainEvent.label, x, y };
    set({ discovery: { ...get().discovery, items: [...get().discovery.items, item] } });
    return id;
  },
  moveDiscoveryItem: (id, x, y) =>
    set({
      discovery: {
        ...get().discovery,
        items: get().discovery.items.map((it) => (it.id === id ? { ...it, x, y } : it)),
      },
    }),
  updateDiscoveryItem: (id, label) =>
    set({
      discovery: {
        ...get().discovery,
        items: get().discovery.items.map((it) => (it.id === id ? { ...it, label } : it)),
      },
    }),
  removeDiscoveryItem: (id) =>
    set({
      discovery: {
        ...get().discovery,
        items: get().discovery.items.filter((it) => it.id !== id),
      },
    }),
  converge: () => {
    // Left→right (x) becomes the timeline order; addNode assigns the next global
    // order per call, so the wall lands as a contiguous block after any existing
    // events, Ungrouped (us-00017). Ties broken by id for determinism.
    const ordered = [...get().discovery.items].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
    for (const it of ordered) get().addNode("domainEvent", undefined, { label: it.label });
    set({ discovery: { active: false, items: [] } });
  },

  setFilterQuery: (query) => set({ filter: { ...get().filter, query } }),
  toggleFilterType: (type) => {
    const types = new Set(get().filter.types);
    if (types.has(type)) types.delete(type);
    else types.add(type);
    set({ filter: { ...get().filter, types } });
  },
  toggleFilterContext: (context) => {
    const contexts = new Set(get().filter.contexts);
    if (contexts.has(context)) contexts.delete(context);
    else contexts.add(context);
    set({ filter: { ...get().filter, contexts } });
  },
  clearFilter: () => set({ filter: { query: "", types: new Set(), contexts: new Set() } }),

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  addContext: (name) => {
    const id = uid();
    const order = get().contexts.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    set({ contexts: [...get().contexts, { id, name, order }] });
    return id;
  },

  renameContext: (id, name) =>
    set({ contexts: get().contexts.map((c) => (c.id === id ? { ...c, name } : c)) }),

  setContextClassification: (id, classification) =>
    set({ contexts: get().contexts.map((c) => (c.id === id ? { ...c, classification } : c)) }),

  setContextBigBallOfMud: (id, bigBallOfMud) =>
    set({ contexts: get().contexts.map((c) => (c.id === id ? { ...c, bigBallOfMud } : c)) }),

  addContextRelationship: (source, target) => {
    const id = uid();
    set({
      contextRelationships: [
        ...get().contextRelationships,
        { id, source, target, type: DEFAULT_CONTEXT_RELATION },
      ],
    });
    return id;
  },
  setContextRelationshipType: (id, type) =>
    set({
      contextRelationships: get().contextRelationships.map((r) =>
        r.id === id ? { ...r, type } : r,
      ),
    }),
  removeContextRelationship: (id) =>
    set({ contextRelationships: get().contextRelationships.filter((r) => r.id !== id) }),
  // `hoveredEdgeId` is shared by both surfaces' edge-hover isolation, so clear it
  // on the swap — a hovered relationship id must not leak into the board's.
  toggleContextMap: () => set({ contextMapOpen: !get().contextMapOpen, hoveredEdgeId: null }),

  removeContext: (id) => {
    const nodes = get().nodes.filter((n) => n.data.context !== id);
    const keep = new Set(nodes.map((n) => n.id));
    const edges = get().edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    const contexts = get().contexts.filter((c) => c.id !== id);
    // Prune any relationship touching the removed context (us-00020-AC-5.1).
    const contextRelationships = get().contextRelationships.filter(
      (r) => r.source !== id && r.target !== id,
    );
    set({
      nodes: laidOut(nodes, edges, contexts, get().level),
      edges,
      contexts,
      contextRelationships,
      selectedId: null,
      focusedContext: get().focusedContext === id ? null : get().focusedContext,
    });
  },

  addNode: (type, context, data) => {
    const id = uid();
    const ctx = context || undefined; // "" and undefined both mean Ungrouped
    const nodeData: ESNodeData = { label: ELEMENT_DEFINITIONS[type].label, context: ctx, ...data };
    if (type === "domainEvent" && nodeData.order === undefined) {
      // Next slot on the single global timeline (decision-00005), across contexts.
      nodeData.order =
        get()
          .nodes.filter((n) => n.type === "domainEvent")
          .reduce((m, n) => Math.max(m, n.data.order ?? 0), -1) + 1;
    }
    const node: ESNode = { id, type, position: { x: 0, y: 0 }, data: nodeData };
    const nodes = [...get().nodes, node];
    set({ nodes: laidOut(nodes, get().edges, get().contexts, get().level) });
    return id;
  },

  updateNodeData: (id, patch) => {
    const nodes = get().nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
    );
    set({ nodes: laidOut(nodes, get().edges, get().contexts, get().level) });
  },

  removeNode: (id) => {
    const nodes = get().nodes.filter((n) => n.id !== id);
    const edges = get().edges.filter((e) => e.source !== id && e.target !== id);
    set({
      nodes: laidOut(nodes, edges, get().contexts, get().level),
      edges,
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  addHotspot: (targetId, text) => {
    const target = get().nodes.find((n) => n.id === targetId);
    const id = get().addNode("hotspot", target?.data.context, { label: text });
    get().connect({ source: id, target: targetId, sourceHandle: null, targetHandle: null });
    return id;
  },

  // Resolving is a two-field change, so it is one action rather than two calls the
  // panel has to order correctly. Setting it back to `open` does not clear
  // `resolvedAt`: the Hotspot *was* resolved then, and that trace is the point of
  // recording it at all. (This is the Hotspot's own state.)
  setHotspotState: (id, state) =>
    get().updateNodeData(id, {
      state,
      ...(state === "resolved" ? { resolvedAt: new Date().toISOString() } : {}),
    }),

  addOpportunity: (targetId, text) => {
    const target = get().nodes.find((n) => n.id === targetId);
    const id = get().addNode("opportunity", target?.data.context, { label: text });
    get().connect({ source: id, target: targetId, sourceHandle: null, targetHandle: null });
    return id;
  },

  connect: (connection) => {
    const { source, target } = connection;
    if (!source || !target || source === target) return false;
    const nodes = get().nodes;
    const s = nodes.find((n) => n.id === source);
    const t = nodes.find((n) => n.id === target);
    if (!s?.type || !t?.type) return false;
    const relation = resolveRelation(s.type, t.type);
    if (!relation) return false;
    const edge: ESEdge = { id: uid(), source, target, data: { relation }, label: relation };
    const edges = addEdge(edge, get().edges);
    set({ nodes: laidOut(nodes, edges, get().contexts, get().level), edges });
    return true;
  },

  removeEdge: (id) =>
    set({
      edges: get().edges.filter((e) => e.id !== id),
      selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId,
      // Deleting from the hover-revealed control unmounts the label without a
      // mouseleave, so drop the hover here too — a hovered id that outlives its
      // edge dims every remaining edge with none emphasised (issue-00018).
      hoveredEdgeId: get().hoveredEdgeId === id ? null : get().hoveredEdgeId,
    }),

  setEventOrder: (eventId, order) => {
    const ev = get().nodes.find((n) => n.id === eventId);
    if (ev?.type !== "domainEvent") return;
    const written = get().nodes.map((n) =>
      n.id === eventId ? { ...n, data: { ...n.data, order } } : n,
    );
    const normalized = normalizeOrders(written);
    set({ nodes: laidOut(normalized, get().edges, get().contexts, get().level) });
  },

  nudgeEvent: (eventId, dir) => {
    const ev = get().nodes.find((n) => n.id === eventId);
    if (ev?.type !== "domainEvent") return;
    const orders = slotOrders(get().nodes);
    const i = eventSlotIndex(get().nodes, eventId);
    if (i < 0) return;
    // toward start: insert before the previous slot; toward end: after the next.
    get().setEventOrder(eventId, gapOrder(orders, dir < 0 ? i - 1 : i + 2));
  },

  moveEventToEnd: (eventId, dir) => {
    const ev = get().nodes.find((n) => n.id === eventId);
    if (ev?.type !== "domainEvent") return;
    const orders = slotOrders(get().nodes);
    get().setEventOrder(eventId, gapOrder(orders, dir < 0 ? 0 : orders.length));
  },

  // Empty selection → Ungrouped (no context), keeping one canonical "no context".
  reassignContext: (nodeId, context) =>
    get().updateNodeData(nodeId, { context: context || undefined }),

  toggleRevisions: () => set({ revisionsOpen: !get().revisionsOpen, healthOpen: false }),

  setSelected: (id) => set({ selectedId: id }),
  setHovered: (id) => set({ hoveredId: id }),
  setHoveredEdge: (id) => set({ hoveredEdgeId: id }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id }),
  setFocusedContext: (id) => set({ focusedContext: id === get().focusedContext ? null : id }),
  setModel: ({ nodes, edges, contexts, contextRelationships, level }) =>
    set({
      nodes: laidOut(nodes, edges, contexts, level ?? get().level),
      edges,
      contexts,
      contextRelationships: contextRelationships ?? [],
      level: level ?? get().level,
      selectedId: null,
      hoveredId: null,
      focusedContext: null,
      hoveredEdgeId: null,
      selectedEdgeId: null,
      isolate: { ...get().isolate, active: false, anchor: null },
      walk: { active: false, index: 0, scope: 1 },
      discovery: { active: false, items: [] },
      filter: { query: "", types: new Set(), contexts: new Set() },
      contextMapOpen: false,
      revisionsOpen: false,
    }),
  clear: () =>
    set({
      nodes: [],
      edges: [],
      contexts: [],
      contextRelationships: [],
      selectedId: null,
      hoveredId: null,
      focusedContext: null,
      hoveredEdgeId: null,
      selectedEdgeId: null,
      isolate: { ...get().isolate, active: false, anchor: null },
      walk: { active: false, index: 0, scope: 1 },
      discovery: { active: false, items: [] },
      filter: { query: "", types: new Set(), contexts: new Set() },
      contextMapOpen: false,
      revisionsOpen: false,
    }),

  // Opening a revision replaces the board outright: setModel already resets the view
  // and the discovery wall, so only the artifact's identity is layered on top.
  openDocument: (doc, model) => {
    get().setModel(fromModel(model));
    set({
      saveError: null,
      loadError: null,
      pickerOpen: false,
      doc: { ...doc, base: doc.revision, name: model.meta.name, dirty: false },
    });
  },
  newDocument: (namespace, id) => {
    get().clear();
    set({
      saveError: null,
      loadError: null,
      pickerOpen: false,
      doc: {
        namespace,
        id,
        name: id,
        revision: null,
        base: null,
        readOnly: false,
        dirty: false,
      },
    });
  },
  closeDocument: () => {
    get().clear();
    set({ doc: null, saveError: null });
  },
  markDirty: () => {
    const doc = get().doc;
    if (!doc || doc.dirty) return;
    set({ doc: { ...doc, dirty: true } });
  },
  // A save lands a new revision, which is by definition the newest — so it also
  // releases the read-only mark an older revision was opened under.
  markSaved: (revision) => {
    const doc = get().doc;
    if (!doc) return;
    set({
      doc: { ...doc, revision, base: revision, readOnly: false, dirty: false },
      saveError: null,
    });
  },
  // The board keeps the older revision's content and number — the fork is what
  // `base` says: the save goes onto the latest, as latest + 1.
  editAsNewRevision: (base) => {
    const doc = get().doc;
    if (!doc) return;
    set({ doc: { ...doc, base, readOnly: false }, saveError: null });
  },
  setSaveError: (message) => set({ saveError: message }),
  setLoadError: (message) => set({ loadError: message }),
  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),
});

// An older revision is read-only (25-ui.md): everything that would change the
// model is a no-op until "edit as new revision" takes it on. One gate here rather
// than a guard in every panel. `setModel` is out of it — loading a revision runs
// through it — and so are the React Flow change handlers, which also carry
// selection; dragging and connecting are switched off on the canvas instead.
const MODEL_ACTIONS = [
  "addContext",
  "renameContext",
  "setContextClassification",
  "setContextBigBallOfMud",
  "addContextRelationship",
  "setContextRelationshipType",
  "removeContextRelationship",
  "removeContext",
  "addNode",
  "updateNodeData",
  "removeNode",
  "addHotspot",
  "setHotspotState",
  "addOpportunity",
  "connect",
  "removeEdge",
  "setEventOrder",
  "nudgeEvent",
  "moveEventToEnd",
  "reassignContext",
  "converge",
] as const satisfies readonly (keyof ESState)[];

type Action = (...args: never[]) => unknown;

const readOnlyGuarded: StateCreator<ESState> = (set, get, api) => {
  const state = initializer(set, get, api);
  const actions = state as unknown as Record<string, Action>;
  for (const name of MODEL_ACTIONS) {
    const action = actions[name] as Action;
    actions[name] = (...args) => (get().doc?.readOnly ? undefined : action(...args));
  }
  return state;
};

export const useESStore = create<ESState>()(readOnlyGuarded);

/** Isolated store instance (for tests). */
export const createESStore = () => createStore<ESState>()(readOnlyGuarded);
