import { describe, expect, it } from "vitest";
import type { ESEdge } from "@/lib/store/types";
import { computeEdgeOffsets } from "./edge-spread";
import type { RelationType } from "@/lib/eventstorming/relations";

// One column at x = 100, bands stacked top→bottom.
const pos = new Map<string, { x: number; y: number }>([
  ["actor", { x: 100, y: 0 }],
  ["cmd", { x: 100, y: 132 }],
  ["agg", { x: 100, y: 264 }],
  ["event", { x: 100, y: 396 }],
  ["rm", { x: 100, y: 660 }],
  ["hot", { x: 100, y: 792 }],
]);

const e = (id: string, source: string, target: string, relation: RelationType): ESEdge => ({
  id,
  source,
  target,
  data: { relation },
});

const off = (m: Map<string, number>, id: string) => m.get(id) ?? 0;

describe("computeEdgeOffsets (issue-00003: corridor lanes)", () => {
  it("leaves a lone edge untouched", () => {
    expect(computeEdgeOffsets([e("hb", "cmd", "agg", "handledBy")], pos).size).toBe(0);
  });

  it("keeps a touching causal chain on the centre line", () => {
    const out = computeEdgeOffsets(
      [e("hb", "cmd", "agg", "handledBy"), e("em", "agg", "event", "emits")],
      pos,
    );
    expect(off(out, "hb")).toBe(0);
    expect(off(out, "em")).toBe(0);
  });

  it("pushes an annotation edge off the chain it overlaps", () => {
    const out = computeEdgeOffsets(
      [e("hb", "cmd", "agg", "handledBy"), e("an", "hot", "cmd", "annotates")],
      pos,
    );
    expect(off(out, "hb")).toBe(0); // spine centred
    expect(out.get("an")).toBeDefined();
    expect(off(out, "an")).not.toBe(0);
  });

  it("separates two overlapping back-edges from the chain and from each other", () => {
    const out = computeEdgeOffsets(
      [
        e("hb", "cmd", "agg", "handledBy"),
        e("an", "hot", "cmd", "annotates"),
        e("in", "rm", "actor", "informs"),
      ],
      pos,
    );
    expect(off(out, "hb")).toBe(0);
    expect(off(out, "an")).not.toBe(0);
    expect(off(out, "in")).not.toBe(0);
    expect(off(out, "an")).not.toBe(off(out, "in")); // different lanes
  });

  it("separates a fan-out to stacked targets", () => {
    const p = new Map(pos);
    p.set("rm2", { x: 100, y: 730 });
    const out = computeEdgeOffsets(
      [e("u1", "event", "rm", "updates"), e("u2", "event", "rm2", "updates")],
      p,
    );
    expect(off(out, "u1")).not.toBe(off(out, "u2"));
  });

  it("does not offset edges in different columns against each other", () => {
    const p = new Map(pos);
    p.set("cmd2", { x: 400, y: 132 });
    p.set("agg2", { x: 400, y: 264 });
    const out = computeEdgeOffsets(
      [e("hb", "cmd", "agg", "handledBy"), e("hb2", "cmd2", "agg2", "handledBy")],
      p,
    );
    expect(off(out, "hb")).toBe(0);
    expect(off(out, "hb2")).toBe(0);
  });

  it("separates a cross-column edge from the same-column edge it overlaps (issue-00004)", () => {
    // arrived → autostart (down, within the column) then autostart → start
    // (up and across to a different column). getSmoothStepPath runs the invokes
    // edge's long vertical segment out of autostart's handle — down autostart's
    // column — where it overlaps the triggers edge. They must be separated even
    // though invokes' far endpoint (start) sits in another column.
    const p = new Map<string, { x: number; y: number }>([
      ["arrived", { x: 100, y: 400 }],
      ["autostart", { x: 100, y: 600 }],
      ["start", { x: 400, y: 100 }],
    ]);
    const out = computeEdgeOffsets(
      [e("trg", "arrived", "autostart", "triggers"), e("inv", "autostart", "start", "invokes")],
      p,
    );
    expect(off(out, "trg")).toBe(0); // shorter, stays centred
    expect(off(out, "inv")).not.toBe(0); // pushed off the shared column
  });

  it("clears the hit-zone when a corridor's nodes differ in width (issue-00005)", () => {
    // Mirror the ride-hailing column: triggers (arrived→autostart, narrow, lane 0),
    // invokes (autostart→start, cross-column, lane +1), annotates (gps→arrived,
    // from a WIDE hotspot, lane −1). The wide node drifts annotates' rendered
    // centre-midpoint right, so a raw −GAP lane cancels against the drift.
    const p = new Map<string, { x: number; y: number; w?: number }>([
      ["arrived", { x: 100, y: 400, w: 130 }],
      ["autostart", { x: 100, y: 600, w: 130 }],
      ["start", { x: 400, y: 100, w: 130 }],
      ["gps", { x: 100, y: 1000, w: 200 }], // wider → centre drifts right
    ]);
    const out = computeEdgeOffsets(
      [
        e("trg", "arrived", "autostart", "triggers"),
        e("inv", "autostart", "start", "invokes"),
        e("ann", "gps", "arrived", "annotates"),
      ],
      p,
    );
    // Rendered vertical-run x = centre-midpoint + returned offset (offsetOrthogonalPath).
    const cx = (id: string) => (p.get(id)!.x + (p.get(id)!.w ?? 0) / 2);
    const runX = (id: string, s: string, t: string) => (cx(s) + cx(t)) / 2 + off(out, id);
    const xs = [
      runX("trg", "arrived", "autostart"),
      runX("inv", "autostart", "start"),
      runX("ann", "gps", "arrived"),
    ];
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++)
        expect(Math.abs(xs[i] - xs[j])).toBeGreaterThanOrEqual(26); // GAP
  });

  it("is deterministic across input order", () => {
    const es = [
      e("hb", "cmd", "agg", "handledBy"),
      e("an", "hot", "cmd", "annotates"),
      e("in", "rm", "actor", "informs"),
    ];
    const a = computeEdgeOffsets(es, pos);
    const b = computeEdgeOffsets([...es].reverse(), pos);
    expect(a.get("an")).toBe(b.get("an"));
    expect(a.get("in")).toBe(b.get("in"));
  });
});
