import { beforeEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand";
import { toModel } from "@/lib/dsl/serialize";
import { BAND_H } from "@/lib/layout/layout";
import { createESStore, type ESState, WALK_SCOPE_MAX } from "./store";
import { gapOrder, slotOrders } from "./timeline";

let store: StoreApi<ESState>;
const get = () => store.getState();
const node = (id: string) => get().nodes.find((n) => n.id === id);

beforeEach(() => {
  store = createESStore();
});

describe("store (RT3)", () => {
  it("adds a bounded context with an incrementing order [us-00006-FR-1]", () => {
    const a = get().addContext("Ordering");
    const b = get().addContext("Payment");
    expect(get().contexts).toEqual([
      { id: a, name: "Ordering", order: 0 },
      { id: b, name: "Payment", order: 1 },
    ]);
  });

  it("adds a typed node into a context with a default label [us-00001-FR-1]", () => {
    const ctx = get().addContext("Ordering");
    const id = get().addNode("command", ctx);
    expect(node(id)).toMatchObject({ type: "command", data: { context: ctx, label: "Command" } });
  });

  it("assigns Domain Events an incrementing timeline order [us-00006-FR-2]", () => {
    const ctx = get().addContext("Ordering");
    const e0 = get().addNode("domainEvent", ctx);
    const e1 = get().addNode("domainEvent", ctx);
    expect(node(e0)?.data.order).toBe(0);
    expect(node(e1)?.data.order).toBe(1);
  });

  it("adds an Ungrouped node when no context is given, with its own timeline [issue-00006]", () => {
    const e0 = get().addNode("domainEvent");
    const e1 = get().addNode("domainEvent");
    expect(node(e0)?.data.context).toBeUndefined();
    expect(node(e0)?.data.order).toBe(0);
    expect(node(e1)?.data.order).toBe(1); // ungrouped events share one timeline
  });

  it("reassigning to an empty context returns a node to Ungrouped [issue-00006]", () => {
    const ctx = get().addContext("c");
    const e = get().addNode("domainEvent", ctx);
    expect(node(e)?.data.context).toBe(ctx);
    get().reassignContext(e, "");
    expect(node(e)?.data.context).toBeUndefined();
  });

  it("creates a semantic edge for a valid connection [us-00002-FR-1]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    expect(get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null })).toBe(true);
    expect(get().edges[0]).toMatchObject({ source: a, target: c, data: { relation: "issues" } });
  });

  it("links a Command directly to the Domain Event it produces [decision-00003]", () => {
    const ctx = get().addContext("c");
    const cmd = get().addNode("command", ctx);
    const e = get().addNode("domainEvent", ctx);
    expect(get().connect({ source: cmd, target: e, sourceHandle: null, targetHandle: null })).toBe(true);
    expect(get().edges[0].data?.relation).toBe("produces");
  });

  it("links a Command to a Constraint that restricts it [decision-00003]", () => {
    const ctx = get().addContext("c");
    const cmd = get().addNode("command", ctx);
    const k = get().addNode("constraint", ctx);
    get().connect({ source: cmd, target: k, sourceHandle: null, targetHandle: null });
    expect(get().edges[0].data?.relation).toBe("constrainedBy");
  });

  it("creates an updates edge for Domain Event -> Read Model [us-00007-FR-2]", () => {
    const ctx = get().addContext("c");
    const e = get().addNode("domainEvent", ctx);
    const rm = get().addNode("readModel", ctx);
    get().connect({ source: e, target: rm, sourceHandle: null, targetHandle: null });
    expect(get().edges[0].data?.relation).toBe("updates");
  });

  it("rejects an invalid connection [us-00002-FR-2]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const e = get().addNode("domainEvent", ctx);
    expect(get().connect({ source: a, target: e, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(get().edges).toHaveLength(0);
  });

  it("attaches a hotspot via an annotates edge, inheriting context [us-00003-FR-1]", () => {
    const ctx = get().addContext("c");
    const e = get().addNode("domainEvent", ctx);
    const h = get().addHotspot(e, "reserve when?");
    expect(node(h)).toMatchObject({ type: "hotspot", data: { context: ctx, label: "reserve when?" } });
    expect(get().edges).toContainEqual(
      expect.objectContaining({ source: h, target: e, data: { relation: "annotates" } }),
    );
  });

  it("writes a Policy's condition and execution via updateNodeData [us-00026-AC-1.1/2.1]", () => {
    const p = get().addNode("policy");
    get().updateNodeData(p, { condition: "retry count < 3", execution: "manual" });
    expect(node(p)?.data).toMatchObject({ condition: "retry count < 3", execution: "manual" });
    get().updateNodeData(p, { execution: "automatic" });
    expect(node(p)?.data.execution).toBe("automatic");
  });

  it("replaces a Policy's parameter list on edit [us-00026-AC-3.1]", () => {
    const p = get().addNode("policy");
    get().updateNodeData(p, {
      parameters: [{ name: "retry", value: "3" }, { name: "radius", value: "2km" }],
    });
    expect(node(p)?.data.parameters).toHaveLength(2);
    get().updateNodeData(p, { parameters: [{ name: "radius", value: "2km" }] });
    expect(node(p)?.data.parameters).toEqual([{ name: "radius", value: "2km" }]);
  });

  it("writes a Constraint's rule via updateNodeData [us-00027-AC-1.1]", () => {
    const k = get().addNode("constraint");
    get().updateNodeData(k, { description: "credit check", rule: "total <= limit" });
    expect(node(k)?.data).toMatchObject({ description: "credit check", rule: "total <= limit" });
  });

  it("attaches an opportunity via a highlights edge, inheriting context [us-00013-AC-1.1]", () => {
    const ctx = get().addContext("c");
    const e = get().addNode("domainEvent", ctx);
    const o = get().addOpportunity(e, "batch discounts?");
    expect(node(o)).toMatchObject({
      type: "opportunity",
      data: { context: ctx, label: "batch discounts?" },
    });
    expect(get().edges).toContainEqual(
      expect.objectContaining({ source: o, target: e, data: { relation: "highlights" } }),
    );
  });

  it("removes a node and its attached edges [us-00001-FR-4]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    get().removeNode(c);
    expect(node(c)).toBeUndefined();
    expect(get().edges).toHaveLength(0);
  });

  it("tiles free (unconnected) same-band nodes horizontally, not stacked [issue-00007]", () => {
    const a0 = get().addNode("actor");
    const a1 = get().addNode("actor");
    const a2 = get().addNode("actor");
    const xs = [a0, a1, a2].map((id) => node(id)!.position.x);
    const ys = [a0, a1, a2].map((id) => node(id)!.position.y);
    // free actors are not concurrent: they spread along the band (distinct x),
    // and share the one Actors/Systems row (same y), never stacked vertically.
    expect(new Set(xs).size).toBe(3);
    expect(new Set(ys).size).toBe(1);
  });

  it("aligns free nodes to their own band's first columns, not after other bands [issue-00007]", () => {
    const e0 = get().addNode("domainEvent");
    const e1 = get().addNode("domainEvent");
    const a0 = get().addNode("actor");
    const a1 = get().addNode("actor");
    // Actors are a different band (row) than Domain Events, so they never collide;
    // free Actors should tile from their band's column 0 (above the events), not be
    // pushed to the right past the events.
    expect(node(a0)!.position.x).toBe(node(e0)!.position.x);
    expect(node(a1)!.position.x).toBe(node(e1)!.position.x);
  });

  it("connecting one free node to an event keeps the others compact, not shifted right [issue-00008]", () => {
    const c0 = get().addNode("command");
    const c1 = get().addNode("command");
    const c2 = get().addNode("command");
    const e0 = get().addNode("domainEvent");
    const e1 = get().addNode("domainEvent");
    const e2 = get().addNode("domainEvent");
    get().connect({ source: c0, target: e2, sourceHandle: null, targetHandle: null }); // produces
    const cmdXs = [c0, c1, c2].map((id) => node(id)!.position.x).sort((a, b) => a - b);
    const evtXs = [e0, e1, e2].map((id) => node(id)!.position.x).sort((a, b) => a - b);
    // the connected command aligns above its event; the free ones fill the empty
    // low columns — so the band spans the same columns as the events, not beyond.
    expect(cmdXs).toEqual(evtXs);
  });

  it("reassigns a node's context [us-00006-FR-4]", () => {
    const c1 = get().addContext("c1");
    const c2 = get().addContext("c2");
    const e = get().addNode("domainEvent", c1);
    get().reassignContext(e, c2);
    expect(node(e)?.data.context).toBe(c2);
  });

  it("lays out a slice into bands (command above its event, same column) [us-00007-FR-3]", () => {
    const ctx = get().addContext("c");
    const c = get().addNode("command", ctx);
    const ag = get().addNode("aggregate", ctx);
    const e = get().addNode("domainEvent", ctx);
    get().connect({ source: c, target: ag, sourceHandle: null, targetHandle: null }); // handledBy
    get().connect({ source: ag, target: e, sourceHandle: null, targetHandle: null }); // emits
    // command band (row 1) is above domainEvent band (row 3)
    expect(node(c)!.position.y).toBeLessThan(node(e)!.position.y);
    // same slice → same column (x)
    expect(node(c)!.position.x).toBe(node(e)!.position.x);
  });

  it("rejects degenerate connections (self, missing node, null endpoint)", () => {
    const ctx = get().addContext("c");
    const c = get().addNode("command", ctx);
    expect(get().connect({ source: c, target: c, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(get().connect({ source: "ghost", target: c, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(
      get().connect({ source: null as unknown as string, target: c, sourceHandle: null, targetHandle: null }),
    ).toBe(false);
    expect(get().edges).toHaveLength(0);
  });

  it("removeContext drops member nodes and their edges", () => {
    const ctx = get().addContext("c");
    const e = get().addNode("domainEvent", ctx);
    const p = get().addNode("policy", ctx);
    get().connect({ source: e, target: p, sourceHandle: null, targetHandle: null });
    expect(get().edges).toHaveLength(1);
    get().removeContext(ctx);
    expect(get().nodes).toHaveLength(0);
    expect(get().edges).toHaveLength(0);
  });

  it("sets the level [us-00008-FR-1]", () => {
    expect(get().level).toBe("design");
    get().setLevel("big-picture");
    expect(get().level).toBe("big-picture");
  });

  it("sets and clears a context's subdomain classification [us-00019-AC-1.1/2.1]", () => {
    const a = get().addContext("Ordering");
    const b = get().addContext("Payment");
    get().setContextClassification(a, "core");
    expect(get().contexts.find((c) => c.id === a)?.classification).toBe("core");
    expect(get().contexts.find((c) => c.id === b)?.classification).toBeUndefined(); // only target
    get().setContextClassification(a, undefined); // clear
    expect(get().contexts.find((c) => c.id === a)?.classification).toBeUndefined();
  });

  it("sets and clears the subdomain a context realises [DSL 4.1]", () => {
    const a = get().addContext("Ordering");
    get().setContextSubdomain(a, "orders");
    expect(get().contexts.find((c) => c.id === a)?.subdomain).toBe("orders");
    get().setContextSubdomain(a, undefined);
    expect(get().contexts.find((c) => c.id === a)?.subdomain).toBeUndefined();
  });

  it("marks and clears a context as a Big Ball of Mud [decision-00015]", () => {
    const a = get().addContext("Legacy ERP");
    get().setContextBigBallOfMud(a, true);
    expect(get().contexts.find((c) => c.id === a)?.bigBallOfMud).toBe(true);
    get().setContextBigBallOfMud(a, undefined); // clear
    expect(get().contexts.find((c) => c.id === a)?.bigBallOfMud).toBeUndefined();
  });

  it("adds, retypes, and removes a context relationship [us-00020-AC-2.1/3.1/4.1]", () => {
    const a = get().addContext("Ordering");
    const b = get().addContext("Payment");
    const rid = get().addContextRelationship(a, b);
    expect(get().contextRelationships).toEqual([
      { id: rid, source: a, target: b, type: "customerSupplier" }, // default (AC-2.1)
    ]);
    get().setContextRelationshipType(rid, "acl");
    expect(get().contextRelationships[0].type).toBe("acl"); // (AC-3.1)
    get().removeContextRelationship(rid);
    expect(get().contextRelationships).toHaveLength(0); // (AC-4.1)
  });

  it("prunes relationships touching a removed context [us-00020-AC-5.1]", () => {
    const a = get().addContext("Ordering");
    const b = get().addContext("Payment");
    const c = get().addContext("Shipping");
    get().addContextRelationship(a, b); // touches Ordering
    get().addContextRelationship(b, c); // does not touch Ordering
    get().removeContext(a);
    expect(get().contextRelationships).toHaveLength(1);
    expect(get().contextRelationships[0]).toMatchObject({ source: b, target: c });
  });

  it("toggles the Context Map view and resets it on clear [us-00020-FR-1]", () => {
    expect(get().contextMapOpen).toBe(false);
    get().toggleContextMap();
    expect(get().contextMapOpen).toBe(true);
    get().clear();
    expect(get().contextMapOpen).toBe(false);
    expect(get().contextRelationships).toHaveLength(0);
  });

  it("renames only the target context", () => {
    const c = get().addContext("Old");
    const other = get().addContext("Other");
    get().renameContext(c, "New");
    expect(get().contexts.find((x) => x.id === c)?.name).toBe("New");
    expect(get().contexts.find((x) => x.id === other)?.name).toBe("Other");
  });

  it("clears selection when the selected node is removed", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    get().setSelected(a);
    get().removeNode(a);
    expect(get().selectedId).toBeNull();
  });

  it("reordering an event swaps its timeline column (x) [us-00006-AC-3.1]", () => {
    const ctx = get().addContext("c");
    const e0 = get().addNode("domainEvent", ctx); // order 0
    const e1 = get().addNode("domainEvent", ctx); // order 1
    expect(node(e1)!.position.x).toBeGreaterThan(node(e0)!.position.x);
    get().setEventOrder(e0, 2); // move e0 after e1
    expect(node(e0)!.position.x).toBeGreaterThan(node(e1)!.position.x);
  });

  it("reassigning context updates the attribute without moving the timeline column [us-00006-AC-4.1]", () => {
    const a = get().addContext("A");
    const b = get().addContext("B");
    const ev = get().addNode("domainEvent", a);
    const before = node(ev)!.position.x;
    get().reassignContext(ev, b);
    // decision-00005: context is an attribute (tint/region), not an x segment —
    // reassigning changes the attribute but not the event's global timeline column.
    expect(node(ev)!.data.context).toBe(b);
    expect(node(ev)!.position.x).toBe(before);
  });

  it("replaces state on setModel and resets on clear", () => {
    const ctx = get().addContext("c");
    get().addNode("actor", ctx);
    get().setModel({ nodes: [], edges: [], contexts: [] });
    expect(get().nodes).toHaveLength(0);
    expect(get().contexts).toHaveLength(0);
    get().addNode("command", get().addContext("x"));
    get().clear();
    expect(get().nodes).toHaveLength(0);
    expect(get().edges).toHaveLength(0);
    expect(get().contexts).toHaveLength(0);
  });

  it("tracks the transient hover target and clears it on clear/setModel (RA3)", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    get().setHovered(a);
    expect(get().hoveredId).toBe(a);
    get().clear();
    expect(get().hoveredId).toBeNull();
    const ctx2 = get().addContext("c2");
    get().setHovered(get().addNode("actor", ctx2));
    get().setModel({ nodes: [], edges: [], contexts: [] });
    expect(get().hoveredId).toBeNull();
  });

  it("tracks isolate view state and clears active on clear/setModel (TC2)", () => {
    expect(get().isolate).toEqual({ active: false, direction: "down", depth: 2, anchor: null });
    get().toggleIsolate();
    expect(get().isolate.active).toBe(true);
    get().setIsolateDirection("up");
    get().setIsolateDepth(3);
    expect(get().isolate).toMatchObject({ active: true, direction: "up", depth: 3 });
    get().setIsolateDepth(0); // clamped to >= 1
    expect(get().isolate.depth).toBe(1);
    get().clear();
    expect(get().isolate.active).toBe(false);
    expect(get().isolate.direction).toBe("up"); // preference kept
  });

  it("pins the anchor when isolate is switched on, so a later selection cannot re-frame it [issue-00024]", () => {
    const ctx = get().addContext("Ordering");
    const a = get().addNode("domainEvent", ctx);
    const b = get().addNode("domainEvent", ctx);
    get().setSelected(a);
    get().toggleIsolate();
    expect(get().isolate.anchor).toEqual({ kind: "element", id: a });

    // selecting another element (or clearing the selection) leaves the frame alone
    get().setSelected(b);
    expect(get().isolate.anchor).toEqual({ kind: "element", id: a });
    get().setSelected(null);
    expect(get().isolate.anchor).toEqual({ kind: "element", id: a });
    // direction/depth re-frame the same anchor
    get().setIsolateDepth(3);
    expect(get().isolate.anchor).toEqual({ kind: "element", id: a });

    // switching off releases the anchor; switching on again pins what is selected now
    get().toggleIsolate();
    expect(get().isolate).toMatchObject({ active: false, anchor: null });
    get().setSelected(b);
    get().toggleIsolate();
    expect(get().isolate.anchor).toEqual({ kind: "element", id: b });
    get().clear();
    expect(get().isolate).toMatchObject({ active: false, anchor: null });
  });

  it("anchors isolate on a whole Bounded Context, and releases it on toggle off", () => {
    const ctx = get().addContext("Ordering");
    const ev = get().addNode("domainEvent", ctx);
    get().setSelected(ev);
    get().isolateContext(ctx);
    expect(get().isolate).toMatchObject({ active: true, anchor: { kind: "context", id: ctx } });
    // the selection is left alone — it is not what the view is framed on
    expect(get().selectedId).toBe(ev);
    // isolating another context re-frames without going through off
    const other = get().addContext("Payment");
    get().isolateContext(other);
    expect(get().isolate.anchor).toEqual({ kind: "context", id: other });
    get().toggleIsolate();
    expect(get().isolate).toMatchObject({ active: false, anchor: null });
  });

  it("toggles the model-health panel visibility [spec-00007]", () => {
    expect(get().healthOpen).toBe(false);
    get().toggleHealth();
    expect(get().healthOpen).toBe(true);
    get().toggleHealth();
    expect(get().healthOpen).toBe(false);
  });

  it("walkthrough steps the timeline read-only: start, step, clamp, stop [us-00014-AC-1.1/2.1/3.1/5.1]", () => {
    const ctx = get().addContext("c");
    const e0 = get().addNode("domainEvent", ctx); // order 0
    const e1 = get().addNode("domainEvent", ctx); // order 1
    const before = JSON.stringify(get().nodes);

    get().startWalkthrough();
    expect(get().walk).toEqual({ active: true, index: 0, scope: 1 });
    expect(get().selectedId).toBe(e0); // first event (AC-1.1)

    get().walkStep(1);
    expect(get().walk.index).toBe(1);
    expect(get().selectedId).toBe(e1); // forward (AC-2.1)

    get().walkStep(1); // clamp at last (AC-3.1)
    expect(get().walk.index).toBe(1);

    get().walkStep(-1);
    expect(get().selectedId).toBe(e0); // backward (AC-2.1)
    get().walkStep(-1); // clamp at first
    expect(get().walk.index).toBe(0);

    get().stopWalkthrough();
    expect(get().walk.active).toBe(false);
    expect(JSON.stringify(get().nodes)).toBe(before); // model unchanged (AC-5.1)
  });

  it("starting a walkthrough leaves isolate [issue-00031, us-00029-AC-5.1]", () => {
    const ctx = get().addContext("c");
    const e0 = get().addNode("domainEvent", ctx);
    get().setSelected(e0);
    get().toggleIsolate();
    expect(get().isolate).toMatchObject({ active: true, anchor: { kind: "element", id: e0 } });

    get().startWalkthrough();
    expect(get().isolate).toMatchObject({ active: false, anchor: null });
    expect(get().isolate.depth).toBe(2); // the preference itself is kept
  });

  it("carries its own reading scope, clamped [us-00029-AC-4.1]", () => {
    expect(get().walk.scope).toBe(1); // the event's own slice
    get().setWalkScope(2);
    expect(get().walk.scope).toBe(2);
    get().setWalkScope(WALK_SCOPE_MAX + 5);
    expect(get().walk.scope).toBe(WALK_SCOPE_MAX);
    get().setWalkScope(0);
    expect(get().walk.scope).toBe(1);
    // a step keeps it; leaving the board resets it with the rest of the cursor
    get().setWalkScope(3);
    get().startWalkthrough();
    expect(get().walk.scope).toBe(3);
    get().clear();
    expect(get().walk).toEqual({ active: false, index: 0, scope: 1 });
  });

  it("walkthrough on an empty board activates with no selection and no-op steps", () => {
    get().startWalkthrough();
    expect(get().walk.active).toBe(true);
    expect(get().selectedId).toBeNull();
    get().walkStep(1); // no events → no-op, no throw
    expect(get().walk.index).toBe(0);
  });

  it("resets the walkthrough on clear [plan-00010 P1.2]", () => {
    const ctx = get().addContext("c");
    get().addNode("domainEvent", ctx);
    get().addNode("domainEvent", ctx);
    get().startWalkthrough();
    get().walkStep(1);
    expect(get().walk).toEqual({ active: true, index: 1, scope: 1 });
    get().clear();
    expect(get().walk).toEqual({ active: false, index: 0, scope: 1 });
  });

  it("tracks the hovered edge and clears it on clear (HE1)", () => {
    get().setHoveredEdge("e1");
    expect(get().hoveredEdgeId).toBe("e1");
    get().clear();
    expect(get().hoveredEdgeId).toBeNull();
  });

  it("applies node/edge changes and tracks selection", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    get().onEdgesChange([{ type: "remove", id: get().edges[0].id }]);
    expect(get().edges).toHaveLength(0);
    get().setSelected(a);
    expect(get().selectedId).toBe(a);
    get().onNodesChange([{ type: "remove", id: a }]);
    expect(node(a)).toBeUndefined();
  });

  it("removes a relation edge but keeps its endpoints [us-00025-AC-1.1]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    const edgeId = get().edges[0].id;
    get().removeEdge(edgeId);
    expect(get().edges).toHaveLength(0);
    expect(node(a)).toBeDefined();
    expect(node(c)).toBeDefined();
  });

  it("selects an edge and drops the selection when that edge is removed [us-00025-AC-3.1/4.1]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    const edgeId = get().edges[0].id;
    get().setSelectedEdge(edgeId);
    expect(get().selectedEdgeId).toBe(edgeId);
    get().removeEdge(edgeId);
    expect(get().edges).toHaveLength(0);
    expect(get().selectedEdgeId).toBeNull();
  });

  // A hovered id that outlives its edge dims every remaining edge with none
  // emphasised: the delete control sits on the hovered edge's label, which
  // unmounts without a mouseleave to clear the hover.
  it("drops the hover when the hovered edge is removed [issue-00018]", () => {
    const ctx = get().addContext("c");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null });
    const edgeId = get().edges[0].id;
    get().setHoveredEdge(edgeId);
    get().removeEdge(edgeId);
    expect(get().hoveredEdgeId).toBeNull();
  });
});

describe("timeline editing [us-00010]", () => {
  // build n Domain Events in one context; return the context id and their ids
  const events = (n: number) => {
    const ctx = get().addContext("c");
    const ids = Array.from({ length: n }, () => get().addNode("domainEvent", ctx));
    return { ctx, ids };
  };
  const orderOf = (id: string) => node(id)!.data.order;
  // the context's Domain Events, in timeline order, as an id sequence
  const sequence = (ctx: string) =>
    get()
      .nodes.filter((n) => n.type === "domainEvent" && n.data.context === ctx)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
      .map((n) => n.id);

  it("inserts a dragged event into a gap, shifting the rest [us-00010-AC-1.1]", () => {
    const { ctx, ids: [a, b, c] } = events(3);
    // drop C in the gap between A and B (gap index 1)
    get().setEventOrder(c, gapOrder(slotOrders(get().nodes), 1));
    expect(sequence(ctx)).toEqual([a, c, b]);
  });

  it("moves a dragged event after the last column [us-00010-AC-1.2]", () => {
    const { ctx, ids: [a, b, c] } = events(3);
    get().setEventOrder(a, gapOrder(slotOrders(get().nodes), 3));
    expect(sequence(ctx)).toEqual([b, c, a]);
  });

  it("makes two events concurrent when one is dropped onto the other [us-00010-AC-2.1]", () => {
    const {
      ids: [a, b],
    } = events(2);
    get().setEventOrder(b, slotOrders(get().nodes)[0]); // onto A's slot
    expect(orderOf(a)).toBe(orderOf(b)); // one shared slot
    // concurrent → same timeline column (x), different parallel sub-lane (y)
    expect(node(a)!.position.x).toBe(node(b)!.position.x);
    expect(node(a)!.position.y).not.toBe(node(b)!.position.y);
  });

  it("splits a concurrent event back into its own column [us-00010-AC-3.1]", () => {
    const { ctx, ids: [a, b] } = events(2);
    get().setEventOrder(b, slotOrders(get().nodes)[0]); // concurrent with A
    expect(orderOf(a)).toBe(orderOf(b));
    // drag B into the gap after the (now single) column
    get().setEventOrder(b, gapOrder(slotOrders(get().nodes), 1));
    expect(orderOf(a)).not.toBe(orderOf(b));
    expect(sequence(ctx)).toEqual([a, b]);
  });

  it("moves an event to the start of its context [us-00010-AC-4.1]", () => {
    const { ctx, ids: [a, b, c] } = events(3);
    get().moveEventToEnd(c, -1);
    expect(sequence(ctx)).toEqual([c, a, b]);
  });

  it("nudges a selected event one column toward the start [us-00010-AC-5.1]", () => {
    const { ctx, ids: [a, b, c] } = events(3);
    get().nudgeEvent(b, -1);
    expect(sequence(ctx)).toEqual([b, a, c]);
  });

  it("leaves no empty column: an adjustment normalizes a gapped context [us-00010-AC-8.1]", () => {
    const { ids: [a, b, c] } = events(3);
    get().removeNode(b); // A at order 0, C at order 2 → a gap at slot 1
    get().setEventOrder(c, 2); // any adjustment re-normalizes the context
    expect([orderOf(a), orderOf(c)].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([0, 1]);
  });

  it("a reorder keeps the event's Bounded Context unchanged [us-00015-FR-1]", () => {
    const a = get().addContext("A");
    const ev = get().addNode("domainEvent", a);
    get().addNode("domainEvent", a);
    get().setEventOrder(ev, 5); // reorder on the global timeline
    expect(node(ev)!.data.context).toBe(a); // drag changes order only, not context
  });

  it("ignores timeline moves on non-events [us-00010 scope]", () => {
    const ctx = get().addContext("c");
    const cmd = get().addNode("command", ctx);
    get().setEventOrder(cmd, 3);
    get().nudgeEvent(cmd, 1);
    expect(node(cmd)?.data.order).toBeUndefined();
  });

  it("relayouts to collapse hidden bands when the Level changes [issue-00009]", () => {
    const ctx = get().addContext("Ordering");
    const a = get().addNode("actor", ctx);
    const c = get().addNode("command", ctx);
    const e = get().addNode("domainEvent", ctx);
    get().connect({ source: a, target: c, sourceHandle: null, targetHandle: null }); // issues
    get().connect({ source: c, target: e, sourceHandle: null, targetHandle: null }); // produces
    // Design (default): Command/Constraint/Aggregate bands sit between the Actor
    // band and the Domain Event band, so its event is 4 band-steps below it.
    expect(node(e)!.position.y - node(a)!.position.y).toBe(4 * BAND_H);
    // Big Picture hides those three bands; the layout must reflow so the visible
    // Domain Event band collapses up to sit one step below the Actor band.
    get().setLevel("big-picture");
    expect(node(e)!.position.y - node(a)!.position.y).toBe(BAND_H);
  });
});

describe("discovery mode [spec-00002]", () => {
  const events = () => get().nodes.filter((n) => n.type === "domainEvent");
  // converged events in timeline order, as their labels
  const timelineLabels = () =>
    events()
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
      .map((n) => n.data.label);

  it("enters only at Big Picture; toggles off cleanly [us-00016-AC-1.1/1.2]", () => {
    get().enterDiscovery(); // default level is design → no-op
    expect(get().discovery.active).toBe(false);
    get().setLevel("big-picture");
    get().enterDiscovery();
    expect(get().discovery.active).toBe(true);
    get().exitDiscovery();
    expect(get().discovery.active).toBe(false);
  });

  it("adds unordered events at free positions without touching the model [us-00016-AC-2.1]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    const a = get().addDiscoveryItem(50, 10, "A");
    const b = get().addDiscoveryItem(200, 90, "B");
    expect(get().discovery.items).toHaveLength(2);
    expect(get().discovery.items.find((i) => i.id === a)).toMatchObject({ x: 50, y: 10, label: "A" });
    // the structured model is untouched: no nodes, no orders
    expect(get().nodes).toHaveLength(0);
    expect(node(b)).toBeUndefined();
  });

  it("drags a wall event without reordering structured events [us-00016-AC-3.1]", () => {
    get().setLevel("big-picture");
    const e = get().addNode("domainEvent"); // structured, order 0
    const beforeX = node(e)!.position.x;
    get().enterDiscovery();
    const d = get().addDiscoveryItem(50, 10, "d");
    get().moveDiscoveryItem(d, 400, 120);
    expect(get().discovery.items[0]).toMatchObject({ x: 400, y: 120 });
    expect(node(e)!.data.order).toBe(0); // structured order unchanged
    expect(node(e)!.position.x).toBe(beforeX);
  });

  it("renames and deletes wall events only [us-00016-AC-4.1]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    const a = get().addDiscoveryItem(0, 0, "a");
    const b = get().addDiscoveryItem(10, 0, "b");
    get().addDiscoveryItem(20, 0, "c");
    get().updateDiscoveryItem(a, "renamed");
    get().removeDiscoveryItem(b);
    expect(get().discovery.items.map((i) => i.label)).toEqual(["renamed", "c"]);
    expect(get().nodes).toHaveLength(0); // model untouched
  });

  it("converges left→right x into Ungrouped ordered events, clearing the wall [us-00017-AC-1.1/2.1/3.1]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    get().addDiscoveryItem(300, 0, "C"); // right-most
    get().addDiscoveryItem(50, 0, "A"); // left-most
    get().addDiscoveryItem(150, 0, "B");
    get().converge();
    expect(timelineLabels()).toEqual(["A", "B", "C"]); // by x position
    expect(events().every((n) => n.data.context === undefined)).toBe(true); // Ungrouped
    expect(get().discovery).toEqual({ active: false, items: [] }); // wall cleared, mode off
  });

  it("appends the converged block after existing events [us-00017-AC-2.2]", () => {
    get().setLevel("big-picture");
    get().addNode("domainEvent", undefined, { label: "existing0" }); // order 0
    get().addNode("domainEvent", undefined, { label: "existing1" }); // order 1
    get().enterDiscovery();
    get().addDiscoveryItem(10, 0, "new-left");
    get().addDiscoveryItem(99, 0, "new-right");
    get().converge();
    expect(timelineLabels()).toEqual(["existing0", "existing1", "new-left", "new-right"]);
  });

  it("converging an empty wall is a no-op that leaves the mode [us-00017-AC-5.1]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    get().converge();
    expect(get().nodes).toHaveLength(0);
    expect(get().discovery).toEqual({ active: false, items: [] });
  });

  it("exits discovery when leaving Big Picture but keeps the wall items [spec-00002 §5]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    get().addDiscoveryItem(0, 0, "kept");
    get().setLevel("process");
    expect(get().discovery.active).toBe(false);
    expect(get().discovery.items.map((i) => i.label)).toEqual(["kept"]);
  });

  it("resets the discovery wall on clear [spec-00002]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    get().addDiscoveryItem(0, 0, "x");
    get().clear();
    expect(get().discovery).toEqual({ active: false, items: [] });
  });

  it("a converged event exports with a global order and no position, like a normal event [us-00017-AC-4.1]", () => {
    get().setLevel("big-picture");
    get().enterDiscovery();
    get().addDiscoveryItem(10, 0, "X");
    get().converge();
    const json = toModel(get().nodes, get().edges, get().contexts, {
      name: "t",
      level: "big-picture",
    });
    const ev = json.nodes!.find((n) => n.label === "X")!;
    expect(ev.order).toBe(0); // carries a global timeline order
    expect(ev.context).toBeUndefined(); // Ungrouped
    expect(ev).not.toHaveProperty("position"); // no free coordinates in the DSL
  });

  it("keeps grammar validation active at Design while discovery is off [spec-00002-XAC-2.1]", () => {
    // default level is Design, discovery inactive: the structured board still
    // enforces the connection grammar (Discovery Mode never relaxes it here).
    expect(get().discovery.active).toBe(false);
    const a = get().addNode("actor");
    const e = get().addNode("domainEvent");
    // actor → domainEvent is not a valid relation; it must still be rejected
    expect(get().connect({ source: a, target: e, sourceHandle: null, targetHandle: null })).toBe(
      false,
    );
    expect(get().edges).toHaveLength(0);
  });
});

describe("bounded context focus [spec-00010]", () => {
  it("focuses a context and toggles it off when re-selected [us-00024-FR-1/FR-2]", () => {
    const a = get().addContext("A");
    const b = get().addContext("B");
    get().setFocusedContext(a);
    expect(get().focusedContext).toBe(a);
    // single-select: focusing another replaces
    get().setFocusedContext(b);
    expect(get().focusedContext).toBe(b);
    // re-selecting the focused one clears (toggle)
    get().setFocusedContext(b);
    expect(get().focusedContext).toBe(null);
  });

  it("clears focus when passed null [us-00024-FR-3]", () => {
    const a = get().addContext("A");
    get().setFocusedContext(a);
    get().setFocusedContext(null);
    expect(get().focusedContext).toBe(null);
  });

  it("clears focus when the focused context is removed", () => {
    const a = get().addContext("A");
    get().setFocusedContext(a);
    get().removeContext(a);
    expect(get().focusedContext).toBe(null);
  });

  it("keeps focus when a different context is removed", () => {
    const a = get().addContext("A");
    const b = get().addContext("B");
    get().setFocusedContext(a);
    get().removeContext(b);
    expect(get().focusedContext).toBe(a);
  });

  it("resets focus on setModel and clear", () => {
    const a = get().addContext("A");
    get().setFocusedContext(a);
    get().setModel({ nodes: [], edges: [], contexts: [] });
    expect(get().focusedContext).toBe(null);
    const b = get().addContext("B");
    get().setFocusedContext(b);
    get().clear();
    expect(get().focusedContext).toBe(null);
  });

  it("focus is view-only — never written to the exported DSL [spec-00010-XAC-1.1]", () => {
    const a = get().addContext("A");
    get().addNode("domainEvent", a);
    get().setFocusedContext(a);
    const json = JSON.stringify(
      toModel(get().nodes, get().edges, get().contexts, { name: "t", level: "design" }),
    );
    expect(json).not.toContain("focusedContext");
    expect(json).not.toContain("focused");
  });
});

describe("search + filter view state [spec-00006]", () => {
  it("sets the search query without touching the model [us-00018-FR-1]", () => {
    get().addNode("domainEvent");
    get().setFilterQuery("order");
    expect(get().filter.query).toBe("order");
    expect(get().nodes).toHaveLength(1); // model untouched
  });

  it("toggles a type in and out of the type filter [us-00018-FR-3]", () => {
    get().toggleFilterType("command");
    expect(get().filter.types.has("command")).toBe(true);
    get().toggleFilterType("command");
    expect(get().filter.types.has("command")).toBe(false);
  });

  it("toggles a context, including Ungrouped (null) [us-00018-FR-4]", () => {
    get().toggleFilterContext("ord");
    get().toggleFilterContext(null);
    expect([...get().filter.contexts].sort()).toEqual([null, "ord"]);
    get().toggleFilterContext("ord");
    expect([...get().filter.contexts]).toEqual([null]);
  });

  it("clears search + filters back to show-everything", () => {
    get().setFilterQuery("x");
    get().toggleFilterType("policy");
    get().toggleFilterContext("c");
    get().clearFilter();
    expect(get().filter.query).toBe("");
    expect(get().filter.types.size).toBe(0);
    expect(get().filter.contexts.size).toBe(0);
  });

  it("resets the filter on clear and setModel [spec-00006-XFR-1]", () => {
    get().setFilterQuery("x");
    get().toggleFilterType("policy");
    get().clear();
    expect(get().filter).toEqual({ query: "", types: new Set(), contexts: new Set() });
    get().setFilterQuery("y");
    get().setModel({ nodes: [], edges: [], contexts: [] });
    expect(get().filter).toEqual({ query: "", types: new Set(), contexts: new Set() });
  });
});

describe("hotspot resolution [us-00033]", () => {
  const hotspotOn = (label: string) => {
    const ctx = get().addContext("Ordering");
    const target = get().addNode("domainEvent", ctx);
    return get().addHotspot(target, label);
  };

  it("stamps when it was resolved, and leaves the resolution text alone [us-00033-AC-2.1]", () => {
    const id = hotspotOn("Who owns stock?");
    get().updateNodeData(id, { resolution: "warehouse owns it" });
    get().setHotspotState(id, "resolved");
    const data = get().nodes.find((n) => n.id === id)?.data;
    expect(data?.state).toBe("resolved");
    expect(data?.resolvedAt).toEqual(expect.any(String));
    expect(data?.resolution).toBe("warehouse owns it");
  });

  it("keeps both when it is set back to open — it was resolved then [us-00033-AC-3.1]", () => {
    const id = hotspotOn("Who owns stock?");
    get().updateNodeData(id, { resolution: "warehouse owns it" });
    get().setHotspotState(id, "resolved");
    const resolvedAt = get().nodes.find((n) => n.id === id)?.data.resolvedAt;

    get().setHotspotState(id, "open");
    const data = get().nodes.find((n) => n.id === id)?.data;
    expect(data?.state).toBe("open");
    expect(data?.resolvedAt).toBe(resolvedAt);
    expect(data?.resolution).toBe("warehouse owns it");
  });

  it("records the latest resolving, not the first [us-00033-AC-3.2]", async () => {
    const id = hotspotOn("Who owns stock?");
    get().setHotspotState(id, "resolved");
    const first = get().nodes.find((n) => n.id === id)?.data.resolvedAt;
    get().setHotspotState(id, "open");
    await new Promise((r) => setTimeout(r, 2)); // a distinguishable instant later
    get().setHotspotState(id, "resolved");
    expect(get().nodes.find((n) => n.id === id)?.data.resolvedAt).not.toBe(first);
  });

  it("writes the resolution beside the description, never over it [us-00033-AC-1.1]", () => {
    const id = hotspotOn("Who owns stock?");
    get().updateNodeData(id, { description: "warehouse and ordering both claim it" });
    get().updateNodeData(id, { resolution: "warehouse owns it" });
    const data = get().nodes.find((n) => n.id === id)?.data;
    expect(data?.description).toBe("warehouse and ordering both claim it");
    expect(data?.resolution).toBe("warehouse owns it");
  });
});
