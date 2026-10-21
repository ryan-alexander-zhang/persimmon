// The products of the project and how they talk (37-progress.md, Products): a node per Prd, an edge per external system
// naming another product. Read from the store's Prds and each product's latest storming; a product opens its map.
import { Background, Controls, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { externalSystemsOf, type Product, type ProductNode, productGraph } from "./lib/products";

const PRD = "prds.sdd.persimmon.ai";
const STORMING = "eventstormings.sdd.persimmon.ai";
const COL = 300;
const ROW = 150;
const PER_ROW = 3;

export function Products({ onOpen }: { onOpen: (product: string) => void }) {
  const [products, setProducts] = useState<Product[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const prds = await api.artifacts(PRD);
        const read = await Promise.all(
          prds.map(async ({ namespace, id }) => {
            const prd = (await api.latest(PRD, namespace, id)) as { title?: string; subdomains?: { id: string; type?: string }[] } | undefined;
            // the storming is named after its Prd (event-storm's output id, 26-domain-discovery.md)
            const model = await api.latest(STORMING, namespace, `${id}-storming`);
            return { id, title: prd?.title, subdomains: prd?.subdomains, externalSystems: externalSystemsOf(model) } as Product;
          }),
        );
        if (live) setProducts(read);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const graph = useMemo(() => productGraph(products ?? []), [products]);
  const nodes = useMemo<Node<ProductNode>[]>(
    () => graph.nodes.map((n, i) => ({ id: n.id, type: "product", position: { x: (i % PER_ROW) * COL, y: Math.floor(i / PER_ROW) * ROW }, data: n, draggable: false })),
    [graph],
  );
  const edges = useMemo<Edge[]>(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-ink-2)" }, style: { stroke: "var(--color-ink-2)", strokeWidth: 1.5 }, labelStyle: { fill: "var(--color-ink-2)", fontSize: 12 } })),
    [graph],
  );

  if (error) return <p className="p-8 text-sm text-bad">{error}</p>;
  if (products && products.length === 0) return <p className="p-8 text-ink-2">No Prd yet: a product appears here once its Prd is published.</p>;
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={{ product: ProductStation }}
      onNodeClick={(_, n) => !(n.data as unknown as ProductNode).missing && onOpen(n.id)}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
    >
      <Background color="var(--color-line)" gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

function ProductStation({ data }: NodeProps<Node<ProductNode>>) {
  return (
    <div
      className={`w-[236px] rounded-xl border-[1.5px] bg-surface px-3.5 py-3 ${data.missing ? "border-dashed border-bad/60" : "cursor-pointer border-line hover:shadow-md"}`}
      title={data.missing ? `${data.id}: named by another product's storming, no Prd of that id` : `Open ${data.title}`}
    >
      <Handle type="target" position={Position.Top} className="!border-0 !bg-transparent" />
      <span className="block text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{data.missing ? "No Prd" : "Product"}</span>
      <span className={`block text-[15px] font-semibold ${data.missing ? "text-ink-2" : "text-ink"}`}>{data.title}</span>
      {data.subdomains.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {data.subdomains.map((s) => (
            <span key={s.id} className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] text-ink-2">
              {s.id}
              {s.type ? ` · ${s.type}` : ""}
            </span>
          ))}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-transparent" />
    </div>
  );
}
