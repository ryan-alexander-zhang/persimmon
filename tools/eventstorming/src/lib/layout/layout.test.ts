import { describe, expect, it } from "vitest";
import type { Context } from "@/lib/eventstorming/grammar";
import { bandIndex } from "@/lib/eventstorming/elements";
import type { RelationType } from "@/lib/eventstorming/relations";
import type { ESEdge, ESNode } from "@/lib/store/types";
import {
  BAND_H,
  COL_W,
  computeIsolateLayout,
  computeLayout,
  STACK_H,
} from "./layout";

const contexts: Context[] = [
  { id: "A", name: "Ordering", order: 0 },
  { id: "B", name: "Payment", order: 1 },
];

// A → issues → command → handledBy → aggregate → emits → event → triggers → policy
//                                                     event → updates → readModel
function sliceModel(): { nodes: ESNode[]; edges: ESEdge[] } {
  const n = (id: string, type: ESNode["type"], ctx: string, order?: number): ESNode => ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, context: ctx, ...(order !== undefined ? { order } : {}) },
  });
  const nodes: ESNode[] = [
    n("act", "actor", "A"),
    n("cmd", "command", "A"),
    n("agg", "aggregate", "A"),
    n("ev", "domainEvent", "A", 0),
    n("pol", "policy", "A"),
    n("rm", "readModel", "A"),
    n("hot", "hotspot", "A"),
    n("ev2", "domainEvent", "B", 1),
  ];
  const e = (id: string, s: string, t: string, relation: RelationType): ESEdge => ({
    id,
    source: s,
    target: t,
    data: { relation },
  });
  const edges: ESEdge[] = [
    e("1", "act", "cmd", "issues"),
    e("2", "cmd", "agg", "handledBy"),
    e("3", "agg", "ev", "emits"),
    e("4", "ev", "pol", "triggers"),
    e("5", "ev", "rm", "updates"),
    e("6", "hot", "ev", "annotates"),
  ];
  return { nodes, edges };
}

describe("layout engine (RT2)", () => {
  it("places each element type in its own band (y = bandIndex * BAND_H)", () => {
    const { nodes, edges } = sliceModel();
    const out = computeLayout(nodes, edges, contexts);
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    for (const id of ["act", "cmd", "agg", "ev", "pol", "rm", "hot"]) {
      expect(byId[id].position.y).toBe(bandIndex(byId[id].type) * BAND_H);
    }
  });

  it("aligns a whole slice in one column (same x)", () => {
    const { nodes, edges } = sliceModel();
    const out = computeLayout(nodes, edges, contexts);
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    for (const id of ["act", "cmd", "agg", "ev", "pol", "rm", "hot"]) {
      expect(x[id]).toBe(x.ev);
    }
  });

  it("orders events on one global timeline regardless of context [us-00015-AC-1.1]", () => {
    const { nodes, edges } = sliceModel();
    const out = computeLayout(nodes, edges, contexts);
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.ev2).toBeGreaterThan(x.ev); // ev2 (global order 1) sits after ev (order 0)
  });

  it("places one context's event strictly between two of another [us-00015-AC-1.1]", () => {
    const ev = (id: string, ctx: string, order: number): ESNode => ({
      id,
      type: "domainEvent",
      position: { x: 0, y: 0 },
      data: { label: id, context: ctx, order },
    });
    const out = computeLayout([ev("a", "A", 0), ev("b", "B", 1), ev("c", "A", 2)], [], contexts);
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.c); // b (context B) sits between a and c (context A)
  });

  it("makes events of different contexts at the same order concurrent (one column) [us-00015-AC-4.1]", () => {
    const ev = (id: string, ctx: string, order: number): ESNode => ({
      id,
      type: "domainEvent",
      position: { x: 0, y: 0 },
      data: { label: id, context: ctx, order },
    });
    const out = computeLayout([ev("a", "A", 0), ev("b", "B", 0)], [], contexts);
    const by = Object.fromEntries(out.map((n) => [n.id, n.position]));
    expect(by.a.x).toBe(by.b.x); // same global order → same column, across contexts
    expect(by.a.y).not.toBe(by.b.y); // parallel sub-lanes
  });

  it("orders events within a context left→right by their order", () => {
    const { nodes, edges } = sliceModel();
    nodes.push({
      id: "ev0",
      type: "domainEvent",
      position: { x: 0, y: 0 },
      data: { label: "ev0", context: "A", order: -1 },
    });
    const out = computeLayout(nodes, edges, contexts);
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x.ev0).toBeLessThan(x.ev); // order -1 before order 0
  });

  it("stacks concurrent events (same order) in one column, different lanes", () => {
    const ev = (id: string, order: number): ESNode => ({
      id,
      type: "domainEvent",
      position: { x: 0, y: 0 },
      data: { label: id, context: "A", order },
    });
    const nodes = [ev("p1", 0), ev("p2", 0), ev("later", 1)];
    const out = computeLayout(nodes, [], contexts);
    const by = Object.fromEntries(out.map((n) => [n.id, n.position]));
    // p1 and p2 are concurrent → same column (x), different lane (y)
    expect(by.p1.x).toBe(by.p2.x);
    expect(by.p1.y).not.toBe(by.p2.y);
    // the order-1 event sits in a later column
    expect(by.later.x).toBeGreaterThan(by.p1.x);
  });

  it("grows the band so concurrent lanes do not overlap the next band (issue-00002)", () => {
    const ev = (id: string, order: number): ESNode => ({
      id,
      type: "domainEvent",
      position: { x: 0, y: 0 },
      data: { label: id, context: "A", order },
    });
    const pol = (id: string): ESNode => ({
      id,
      type: "policy",
      position: { x: 0, y: 0 },
      data: { label: id, context: "A" },
    });
    // three concurrent events (order 0), each triggering its own policy
    const nodes = [ev("e0", 0), ev("e1", 0), ev("e2", 0), pol("p0"), pol("p1"), pol("p2")];
    const e = (id: string, s: string, t: string): ESEdge => ({
      id,
      source: s,
      target: t,
      data: { relation: "triggers" },
    });
    const edges = [e("t0", "e0", "p0"), e("t1", "e1", "p1"), e("t2", "e2", "p2")];
    const out = computeLayout(nodes, edges, contexts);
    const y = Object.fromEntries(out.map((n) => [n.id, n.position.y]));
    const lowestEvent = Math.max(y.e0, y.e1, y.e2);
    const highestPolicy = Math.min(y.p0, y.p1, y.p2);
    // the lowest event sticky must clear a full sub-row before the policy band
    expect(lowestEvent + STACK_H).toBeLessThanOrEqual(highestPolicy);
  });

  it("handles nodes missing order/context and unattached hotspots without throwing", () => {
    const n = (id: string, type: ESNode["type"], ctx?: string, order?: number): ESNode => ({
      id,
      type,
      position: { x: 0, y: 0 },
      data: {
        label: id,
        ...(ctx ? { context: ctx } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    const out = computeLayout(
      [
        n("e", "domainEvent", "A"), // event with no order
        n("h", "hotspot", "A"), // hotspot with no annotates target
        n("orphan", "actor"), // node with no context
      ],
      [],
      contexts,
    );
    expect(out).toHaveLength(3);
    expect(out.every((x) => Number.isFinite(x.position.x) && Number.isFinite(x.position.y))).toBe(true);
  });

  it("tiles unrelated same-type free nodes side by side, not stacked [issue-00007]", () => {
    const actor = (id: string): ESNode => ({
      id,
      type: "actor",
      position: { x: 0, y: 0 },
      data: { label: id, context: "A" },
    });
    const out = computeLayout([actor("a1"), actor("a2")], [], contexts);
    const xs = out.map((n) => n.position.x);
    const ys = out.map((n) => n.position.y);
    // free (unconnected) nodes have no timeline slot and are not concurrent:
    // distinct columns, one shared band row — never stacked (issue-00007).
    expect(xs[0]).not.toBe(xs[1]);
    expect(ys[0]).toBe(ys[1]);
  });

  it("collapses bands hidden at a coarse level so visible bands sit adjacent [issue-00009]", () => {
    const { nodes, edges } = sliceModel();
    // Design shows every band, so the Domain Event sits 4 band-steps below the Actor.
    const design = computeLayout(nodes, edges, contexts, "design");
    const dy = Object.fromEntries(design.map((n) => [n.id, n.position.y]));
    expect(dy.ev - dy.act).toBe(bandIndex("domainEvent") * BAND_H);

    // Big Picture hides Command/Constraint/Aggregate; those bands reserve no
    // height, so the Domain Event band collapses to one step below the Actor.
    const bp = computeLayout(nodes, edges, contexts, "big-picture");
    const by = Object.fromEntries(bp.map((n) => [n.id, n.position.y]));
    expect(by.ev - by.act).toBe(BAND_H);
  });

  it("defaults to the full-band (design) layout when no level is given", () => {
    const { nodes, edges } = sliceModel();
    const withDefault = computeLayout(nodes, edges, contexts);
    const explicit = computeLayout(nodes, edges, contexts, "design");
    expect(withDefault.map((n) => n.position)).toEqual(explicit.map((n) => n.position));
  });

  it("is deterministic (same model → identical layout)", () => {
    const { nodes, edges } = sliceModel();
    const a = computeLayout(nodes, edges, contexts);
    const b = computeLayout(nodes, edges, contexts);
    expect(a.map((n) => n.position)).toEqual(b.map((n) => n.position));
  });
});

// A six-column timeline where one chain skips from the first event to the last:
// ev0 -triggers-> pol -invokes-> cmd -produces-> ev5, with ev1..ev4 filling the
// columns in between.
function gapModel(): { nodes: ESNode[]; edges: ESEdge[] } {
  const ev = (id: string, order: number): ESNode => ({
    id,
    type: "domainEvent",
    position: { x: 0, y: 0 },
    data: { label: id, context: "A", order },
  });
  const nodes: ESNode[] = [
    ev("ev0", 0),
    ev("ev1", 1),
    ev("ev2", 2),
    ev("ev3", 3),
    ev("ev4", 4),
    ev("ev5", 5),
    { id: "pol", type: "policy", position: { x: 0, y: 0 }, data: { label: "pol", context: "A" } },
    { id: "cmd", type: "command", position: { x: 0, y: 0 }, data: { label: "cmd", context: "A" } },
  ];
  const e = (id: string, s: string, t: string, relation: RelationType): ESEdge => ({
    id,
    source: s,
    target: t,
    data: { relation },
  });
  const edges: ESEdge[] = [
    e("t", "ev0", "pol", "triggers"),
    e("i", "pol", "cmd", "invokes"),
    e("p", "cmd", "ev5", "produces"),
  ];
  return { nodes, edges };
}

describe("isolate relayout [issue-00021]", () => {
  it("reclaims the height of a band with no surviving node", () => {
    const { nodes, edges } = sliceModel();
    // On the full board the Policy band sits empty between the event and its
    // read model, so they are two band-steps apart.
    const full = computeLayout(nodes, edges, contexts, "design");
    const fy = Object.fromEntries(full.map((n) => [n.id, n.position.y]));
    expect(fy.rm - fy.ev).toBe(2 * BAND_H);

    // Isolated to just those two, the bands above and between them reserve no
    // height: the event is at the top and the read model one step below.
    const iso = computeIsolateLayout(nodes, edges, contexts, "design", new Set(["ev", "rm"]));
    const y = Object.fromEntries(iso.nodes.map((n) => [n.id, n.position.y]));
    expect(iso.nodes).toHaveLength(2);
    expect(y.ev).toBe(0);
    expect(y.rm - y.ev).toBe(BAND_H);
  });

  it("reclaims the lanes its hidden elements vacated [issue-00033]", () => {
    // Three concurrent events (one order → one column, three lanes), each produced
    // by its own Command. A walkthrough keeps every event but only one slice, so the
    // Commands band is left holding a single command that belongs to the last lane.
    const n = (id: string, type: ESNode["type"], order?: number): ESNode => ({
      id,
      type,
      position: { x: 0, y: 0 },
      data: { label: id, context: "A", ...(order !== undefined ? { order } : {}) },
    });
    const nodes: ESNode[] = [
      n("ev0", "domainEvent", 0),
      n("ev1", "domainEvent", 0),
      n("ev2", "domainEvent", 0),
      n("cmd0", "command"),
      n("cmd1", "command"),
      n("cmd2", "command"),
    ];
    const edges: ESEdge[] = [0, 1, 2].map((i) => ({
      id: `p${i}`,
      source: `cmd${i}`,
      target: `ev${i}`,
      data: { relation: "produces" as RelationType },
    }));

    // On the full board cmd2 sits in its event's lane, two stack steps down, and
    // the Commands band is three lanes tall.
    const full = computeLayout(nodes, edges, contexts, "design");
    const fy = Object.fromEntries(full.map((x) => [x.id, x.position.y]));
    expect(fy.cmd2 - fy.cmd0).toBe(2 * STACK_H);
    // Commands band height + the two bands it holds away from the events (Constraints
    // and Aggregates, empty but never collapsed on the full board).
    expect(fy.ev0 - fy.cmd0).toBe(2 * STACK_H + 3 * BAND_H);

    // Keeping every event but only cmd2, its lane is the only one the Commands band
    // occupies: it sits at the band's top, and that band is one lane tall rather than
    // three. The events band keeps all three lanes — they are all still real.
    const keep = new Set(["ev0", "ev1", "ev2", "cmd2"]);
    const iso = computeIsolateLayout(nodes, edges, contexts, "design", keep);
    const y = Object.fromEntries(iso.nodes.map((x) => [x.id, x.position.y]));
    expect(y.cmd2).toBe(0);
    expect(y.ev0).toBe(BAND_H);
    expect(y.ev2 - y.ev0).toBe(2 * STACK_H);
  });

  it("re-ranks the columns over the surviving events so the chain sits adjacent", () => {
    const { nodes, edges } = gapModel();
    // On the full board ev5 is the sixth column, five steps from ev0.
    const full = computeLayout(nodes, edges, contexts, "design");
    const fx = Object.fromEntries(full.map((n) => [n.id, n.position.x]));
    expect(fx.ev5 - fx.ev0).toBe(5 * COL_W);

    // Isolated to the chain, the four vacated columns are reclaimed.
    const keep = new Set(["ev0", "pol", "cmd", "ev5"]);
    const iso = computeIsolateLayout(nodes, edges, contexts, "design", keep);
    const x = Object.fromEntries(iso.nodes.map((n) => [n.id, n.position.x]));
    expect(iso.nodes).toHaveLength(4);
    expect(x.ev5 - x.ev0).toBe(COL_W);
    expect(x.pol).toBe(x.ev0); // still in its event's column
    expect(x.cmd).toBe(x.ev5);
  });

  it("reports band tops that match the relaid nodes, for the band rail", () => {
    const { nodes, edges } = sliceModel();
    const iso = computeIsolateLayout(nodes, edges, contexts, "design", new Set(["ev", "rm"]));
    const y = Object.fromEntries(iso.nodes.map((n) => [n.id, n.position.y]));
    expect(iso.bandTops[bandIndex("domainEvent")]).toBe(y.ev);
    expect(iso.bandTops[bandIndex("readModel")]).toBe(y.rm);
  });

  it("drops nodes hidden at the level, so their band is reclaimed too", () => {
    const { nodes, edges } = sliceModel();
    // Big Picture hides Command; isolating actor+command+event keeps only the two
    // the level allows, and they sit adjacent.
    const keep = new Set(["act", "cmd", "ev"]);
    const iso = computeIsolateLayout(nodes, edges, contexts, "big-picture", keep);
    expect(iso.nodes.map((n) => n.id).sort()).toEqual(["act", "ev"]);
    const y = Object.fromEntries(iso.nodes.map((n) => [n.id, n.position.y]));
    expect(y.ev - y.act).toBe(BAND_H);
  });
});
