import { describe, expect, it } from "vitest";
import { externalSystemsOf, productGraph } from "./products";

describe("productGraph", () => {
  it("draws a node per product and an edge per external system naming another product", () => {
    const g = productGraph([
      { id: "crm-prd", title: "CreatorCRM", subdomains: [{ id: "messaging", type: "core" }], externalSystems: [{ label: "Ari", product: "ari-prd" }, { label: "OnlyFans" }] },
      { id: "ari-prd", title: "Ari", externalSystems: [{ label: "CreatorCRM", product: "crm-prd" }] },
    ]);
    expect(g.nodes.map((n) => [n.id, n.title, n.missing])).toEqual([
      ["crm-prd", "CreatorCRM", false],
      ["ari-prd", "Ari", false],
    ]);
    expect(g.edges.map((e) => [e.source, e.target, e.label])).toEqual([
      ["crm-prd", "ari-prd", "Ari"],
      ["ari-prd", "crm-prd", "CreatorCRM"],
    ]);
  });

  it("adds a missing node for a product named but not in the project, titled by its stem", () => {
    const g = productGraph([{ id: "crm-prd", externalSystems: [{ label: "Billing", product: "billing-prd" }] }]);
    expect(g.nodes).toEqual([
      { id: "crm-prd", title: "crm", subdomains: [], missing: false },
      { id: "billing-prd", title: "billing", subdomains: [], missing: true },
    ]);
    expect(g.edges).toHaveLength(1);
  });
});

describe("externalSystemsOf", () => {
  it("reads the external systems of a model and the product each names; nothing from what is no model", () => {
    const model = { nodes: [{ type: "externalSystem", label: "Ari", properties: { product: "ari-prd" } }, { type: "externalSystem", label: "Garage", properties: {} }, { type: "actor", label: "Employee", properties: { product: "x" } }] };
    expect(externalSystemsOf(model)).toEqual([
      { label: "Ari", product: "ari-prd" },
      { label: "Garage", product: undefined },
    ]);
    expect(externalSystemsOf(null)).toEqual([]);
    expect(externalSystemsOf({ nodes: "nope" })).toEqual([]);
  });
});
