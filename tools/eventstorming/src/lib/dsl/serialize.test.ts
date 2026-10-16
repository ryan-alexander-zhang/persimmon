import { describe, expect, it } from "vitest";
import type { Context, Model } from "@/lib/eventstorming/grammar";
import type { ESEdge, ESNode } from "@/lib/store/types";
import { fromModel, stripCreatedAt, toModel } from "./serialize";

const META = { name: "Order flow", level: "design" as const };
const CONTEXTS: Context[] = [{ id: "ord", name: "Ordering", order: 0 }];

function sampleCanvas(): { nodes: ESNode[]; edges: ESEdge[] } {
  const nodes: ESNode[] = [
    { id: "a1", type: "actor", position: { x: 0, y: 0 }, data: { label: "Customer", context: "ord" } },
    {
      id: "c1",
      type: "command",
      position: { x: 40, y: 0 },
      data: { label: "Place Order", context: "ord" },
    },
    {
      id: "e1",
      type: "domainEvent",
      position: { x: 80, y: 0 },
      data: { label: "Order Placed", context: "ord", order: 0, pivotal: true, description: "exists" },
    },
  ];
  const edges: ESEdge[] = [
    { id: "r1", source: "a1", target: "c1", data: { relation: "issues" }, label: "issues" },
  ];
  return { nodes, edges };
}

describe("serialize (T2/RT1)", () => {
  it("round-trips canvas -> model -> canvas preserving context and order, dropping position", () => {
    const { nodes, edges } = sampleCanvas();
    const back = fromModel(toModel(nodes, edges, CONTEXTS, META));
    expect(back.contexts).toEqual(CONTEXTS);
    // data (context/order/label/props) preserved; position is a computed placeholder
    expect(back.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data }))).toEqual(
      nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
    );
    expect(back.nodes.every((n) => n.position.x === 0 && n.position.y === 0)).toBe(true);
  });

  it("round-trips hotspot state/kind/priority [us-00012-AC-1.1/2.1]", () => {
    const nodes: ESNode[] = [
      {
        id: "h1",
        type: "hotspot",
        position: { x: 0, y: 0 },
        data: { label: "reserve when?", state: "resolved", kind: "question", priority: "high" },
      },
    ];
    const back = fromModel(toModel(nodes, [], [], META));
    expect(back.nodes[0]!.data).toMatchObject({
      state: "resolved",
      kind: "question",
      priority: "high",
    });
  });

  it("round-trips a temporal Domain Event's clock marker [issue-00039]", () => {
    const nodes: ESNode[] = [
      {
        id: "e1",
        type: "domainEvent",
        position: { x: 0, y: 0 },
        data: { label: "Billing Month Ended", order: 0, temporal: true },
      },
    ];
    const back = fromModel(toModel(nodes, [], [], META));
    expect(back.nodes[0]!.data).toMatchObject({ temporal: true });
  });

  it("round-trips a Hotspot's resolution and when it was resolved [us-00033-AC-6.1]", () => {
    const nodes: ESNode[] = [
      {
        id: "h1",
        type: "hotspot",
        position: { x: 0, y: 0 },
        data: {
          label: "who owns stock?",
          description: "warehouse and ordering both claim it",
          state: "resolved",
          resolution: "warehouse owns it; ordering asks",
          resolvedAt: "2026-08-17T09:00:00.000Z",
        },
      },
    ];
    const back = fromModel(toModel(nodes, [], [], META));
    expect(back.nodes[0]!.data).toMatchObject({
      description: "warehouse and ordering both claim it",
      resolution: "warehouse owns it; ordering asks",
      resolvedAt: "2026-08-17T09:00:00.000Z",
    });
  });

  it("reads a Hotspot written before resolutions existed [us-00033-AC-6.2]", () => {
    const model: Model = {
      version: "4.0",
      meta: META,
      contexts: [],
      contextRelationships: [],
      nodes: [{ id: "h1", type: "hotspot", label: "who owns stock?", properties: { state: "resolved" } }],
      edges: [],
    };
    const back = fromModel(model);
    expect(back.nodes[0]!.data.state).toBe("resolved");
    expect(back.nodes[0]!.data.resolution).toBeUndefined();
  });

  it("round-trips a Policy's rule fields and a Constraint's rule [us-00026-AC-4.1, us-00027-AC-2.1]", () => {
    const nodes: ESNode[] = [
      {
        id: "p1",
        type: "policy",
        position: { x: 0, y: 0 },
        data: {
          label: "Re-match on decline",
          condition: "retry count < 3",
          execution: "manual",
          parameters: [{ name: "retry", value: "3" }, { name: "radius", value: "2km" }],
        },
      },
      {
        id: "k1",
        type: "constraint",
        position: { x: 0, y: 0 },
        data: { label: "Credit limit", description: "credit check", rule: "total <= limit" },
      },
    ];
    const back = fromModel(toModel(nodes, [], [], META));
    expect(back.nodes[0]!.data).toMatchObject({
      condition: "retry count < 3",
      execution: "manual",
      parameters: [{ name: "retry", value: "3" }, { name: "radius", value: "2km" }],
    });
    expect(back.nodes[1]!.data).toMatchObject({ description: "credit check", rule: "total <= limit" });
    const out = toModel(nodes, [], [], META);
    expect(out.nodes[0]!.properties!.execution).toBe("manual");
  });

  it("round-trips an alternative set, across both member types [us-00035-AC-3.1/2.1]", () => {
    const nodes: ESNode[] = [
      {
        id: "e1",
        type: "domainEvent",
        position: { x: 0, y: 0 },
        data: { label: "Payment Captured", order: 0, alternativeSet: "charge-outcome" },
      },
      {
        id: "e2",
        type: "domainEvent",
        position: { x: 0, y: 0 },
        data: { label: "Payment Failed", order: 0, alternativeSet: "charge-outcome" },
      },
      // a mixed set is legal: the customer confirms, or the hold expires
      {
        id: "c1",
        type: "command",
        position: { x: 0, y: 0 },
        data: { label: "Confirm Booking", alternativeSet: "hold-outcome" },
      },
      {
        id: "e3",
        type: "domainEvent",
        position: { x: 0, y: 0 },
        data: { label: "Hold Expired", order: 1, alternativeSet: "hold-outcome" },
      },
    ];
    const back = fromModel(toModel(nodes, [], [], META));
    expect(back.nodes.map((n) => n.data.alternativeSet)).toEqual([
      "charge-outcome",
      "charge-outcome",
      "hold-outcome",
      "hold-outcome",
    ]);
    const out = toModel(nodes, [], [], META);
    expect(out.nodes[0]!.properties!.alternativeSet).toBe("charge-outcome");
  });

  it("omits absent rule fields on export [us-00026-AC-4.1]", () => {
    const nodes: ESNode[] = [
      { id: "p1", type: "policy", position: { x: 0, y: 0 }, data: { label: "P" } },
    ];
    const out = toModel(nodes, [], [], META);
    expect(out.nodes[0]!.properties!.condition).toBeUndefined();
    expect(out.nodes[0]!.properties!.execution).toBeUndefined();
    expect(out.nodes[0]!.properties!.parameters).toBeUndefined();
    expect(out.nodes[0]!.properties!.rule).toBeUndefined();
    // an element in no set says nothing about alternatives (us-00035-FR-4)
    expect(out.nodes[0]!.properties!.alternativeSet).toBeUndefined();
  });

  it("reads an old file without the rule fields, dropping meta.createdAt [spec-00011-XAC-1.1, 24-eventstorming.md]", () => {
    const raw = {
      version: "4.0",
      meta: { name: "old", level: "design", createdAt: "2026-01-01T00:00:00Z" },
      contexts: [],
      contextRelationships: [],
      nodes: [
        { id: "p1", type: "policy", label: "P", properties: {} },
        { id: "k1", type: "constraint", label: "K", properties: {} },
      ],
      edges: [],
    };
    const model = stripCreatedAt(raw) as Model;
    expect(model.meta).toEqual({ name: "old", level: "design" });
    const back = fromModel(model);
    expect(back.nodes[0]!.data.condition).toBeUndefined();
    expect(back.nodes[0]!.data.execution).toBeUndefined();
    expect(back.nodes[0]!.data.alternativeSet).toBeUndefined(); // us-00035-AC-3.2
    expect(back.nodes[1]!.data.rule).toBeUndefined();
  });

  it("leaves a model with no meta.createdAt alone", () => {
    const model = { version: "4.0", meta: { name: "n", level: "design" }, nodes: [], edges: [] };
    expect(stripCreatedAt(model)).toEqual(model);
    expect(stripCreatedAt(null)).toBeNull();
  });

  it("export omits position and includes contexts + order + level [us-00004]", () => {
    const { nodes, edges } = sampleCanvas();
    const out = toModel(nodes, edges, CONTEXTS, META);
    expect(out.version).toBe("4.1");
    expect(out.contexts).toEqual(CONTEXTS);
    expect(out.meta.level).toBe("design");
    expect("position" in out.nodes[0]!).toBe(false);
    expect(out.nodes[2]!.order).toBe(0);
  });

  it("round-trips a node with no context (global participant)", () => {
    const global: ESNode[] = [
      { id: "g", type: "actor", position: { x: 0, y: 0 }, data: { label: "Global" } },
    ];
    const back = fromModel(toModel(global, [], [], META));
    expect(back.nodes[0]!.data.context).toBeUndefined();
    const out = toModel(global, [], [], META);
    expect(out.nodes[0]!.context).toBeUndefined();
  });

  it("round-trips a context's subdomain classification [us-00019-AC-3.1]", () => {
    const classified: Context[] = [{ id: "ord", name: "Ordering", order: 0, classification: "core" }];
    const back = fromModel(toModel([], [], classified, META));
    expect(back.contexts).toEqual(classified);
    const out = toModel([], [], classified, META);
    expect(out.contexts[0].classification).toBe("core");
  });

  it("round-trips context relationships [us-00020-AC-6.1]", () => {
    const rels = [{ id: "cr1", source: "ord", target: "pay", type: "conformist" as const }];
    const model = toModel([], [], CONTEXTS, META, rels);
    expect(model.contextRelationships).toEqual(rels);
    const back = fromModel(model);
    expect(back.contextRelationships).toEqual(rels);
  });

});
