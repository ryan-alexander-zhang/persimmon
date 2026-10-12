import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { DiscoveryNode, type DiscoveryFlowNode } from "@/components/nodes/discovery-node";
import { useESStore } from "@/lib/store/store";

const nodeTypes: NodeTypes = { discovery: DiscoveryNode };

// The chaotic-exploration surface (spec-00002 / decision-00004): unordered
// Domain Events at free positions, with NO layout engine, NO edges, and NO
// grammar validation. Positions live in the discovery buffer, never the model.
function DiscoverySurface() {
  const items = useESStore((s) => s.discovery.items);
  const moveDiscoveryItem = useESStore((s) => s.moveDiscoveryItem);

  // React Flow needs a controlled node array with change handling to render
  // drags; the buffer stays the source of truth and is written back on drop.
  const [nodes, setNodes, onNodesChange] = useNodesState<DiscoveryFlowNode>([]);
  useEffect(() => {
    setNodes(
      items.map((it) => ({
        id: it.id,
        type: "discovery",
        position: { x: it.x, y: it.y },
        data: { label: it.label },
      })),
    );
  }, [items, setNodes]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: DiscoveryFlowNode) =>
      moveDiscoveryItem(node.id, node.position.x, node.position.y),
    [moveDiscoveryItem],
  );

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      nodesConnectable={false}
      deleteKeyCode={null}
      minZoom={0.2}
      fitView
      fitViewOptions={{ padding: 0.3 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} />
      <Controls showInteractive={false} />
      {items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="rounded-md bg-white/80 px-4 py-2 text-sm text-zinc-500 shadow-sm">
            Add a Domain Event with <strong>+ Event</strong>, arrange them left→right, then{" "}
            <strong>Converge</strong>
          </p>
        </div>
      )}
    </ReactFlow>
  );
}

/** Discovery Mode surface, isolated in its own React Flow provider so its
 *  viewport and interaction state never touch the structured board's. */
export function DiscoveryCanvas() {
  return (
    <ReactFlowProvider>
      <DiscoverySurface />
    </ReactFlowProvider>
  );
}
