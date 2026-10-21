// The products of a project and how they talk (37-progress.md, Products): one node per Prd, an edge for every external
// system of a product's storming that names another product (DSL 4.2 `properties.product`). Pure: no DOM, no fetch.

export interface Product {
  /** The Prd id. */
  id: string;
  title?: string;
  subdomains?: { id: string; type?: string }[];
  /** The external systems of its latest storming model, with the product each names, if any. */
  externalSystems: { label: string; product?: string }[];
}

/** A type, not an interface: React Flow's node data wants an index signature. */
export type ProductNode = {
  id: string;
  title: string;
  subdomains: { id: string; type?: string }[];
  /** Named by another product's storming, but no Prd of that id exists. */
  missing: boolean;
};

export interface ProductEdge {
  id: string;
  source: string;
  target: string;
  /** The external system's label in the source product's storming. */
  label: string;
}

/** The graph: the products given, plus a missing node per product id named and not given; one edge per naming. */
export function productGraph(products: Product[]): { nodes: ProductNode[]; edges: ProductEdge[] } {
  const known = new Map(products.map((p) => [p.id, p]));
  const nodes: ProductNode[] = products.map((p) => ({ id: p.id, title: p.title ?? p.id.replace(/-prd$/, ""), subdomains: p.subdomains ?? [], missing: false }));
  const edges: ProductEdge[] = [];
  for (const p of products)
    for (const x of p.externalSystems) {
      if (!x.product) continue;
      if (!known.has(x.product) && !nodes.some((n) => n.id === x.product)) nodes.push({ id: x.product, title: x.product.replace(/-prd$/, ""), subdomains: [], missing: true });
      edges.push({ id: `${p.id}->${x.product}:${x.label}`, source: p.id, target: x.product, label: x.label });
    }
  return { nodes, edges };
}

/** The external systems of a storming model's content, as `productGraph` reads them; `[]` for anything that is no model. */
export function externalSystemsOf(model: unknown): Product["externalSystems"] {
  const nodes = (model as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => n && typeof n === "object" && (n as { type?: string }).type === "externalSystem")
    .map((n) => {
      const { label, properties } = n as { label?: string; properties?: { product?: unknown } };
      const product = typeof properties?.product === "string" && properties.product ? properties.product : undefined;
      return { label: typeof label === "string" ? label : "", product };
    });
}
