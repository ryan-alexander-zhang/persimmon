import { describe, expect, it } from "vitest";
import { format, parse, PRODUCTS } from "./route";

describe("route", () => {
  it("round-trips every place", () => {
    const places = [
      {},
      { product: "claims-prd" },
      { product: "claims-prd", phase: "inventory" },
      { product: "claims-prd", phase: "inventory", run: "inventory-796e1a", view: { t: "rounds" as const } },
      { product: "claims-prd", phase: "recover", run: "recover-prd-852453", view: { t: "review" as const, taskRun: "recover-prd-852453.rounds-2.review.decided.task" } },
      { product: "claims-prd", phase: "inventory", run: "inventory-796e1a", view: { t: "artifact" as const, ref: { apiVersion: "", kind: "SourceInventory", id: "claims-inventory", revision: 9 } } },
      { product: "claims-prd", phase: "inventory", run: "inventory-796e1a", view: { t: "artifact" as const, ref: { apiVersion: "", kind: "SourceInventory", id: "claims-inventory", revision: 9 }, anchor: "GD-14" } },
    ];
    for (const p of places) expect(parse(format(p))).toEqual(p);
    expect(parse(format(PRODUCTS))).toBe(PRODUCTS);
  });

  it("drops a view it cannot read", () => {
    expect(parse("#claims-prd/inventory/run-1/artifact/Prd")).toEqual({ product: "claims-prd", phase: "inventory", run: "run-1" });
    expect(parse("#claims-prd/inventory/run-1/artifact/Prd/x/nine")).toEqual({ product: "claims-prd", phase: "inventory", run: "run-1" });
  });
});
