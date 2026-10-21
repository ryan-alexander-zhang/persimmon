// The product's phases as a graph (37-progress.md): a fixed layout, a station per phase, state as a glyph.
import { Background, Controls, type Edge, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { Check, X } from "lucide-react";
import { useMemo } from "react";
import { edges as flowEdges, type PhaseView, type State } from "./lib/flow";

const LANE = 270;
const STEP = 108;

type StationData = { view: PhaseView; selected: boolean };

export function Map({ views, selected, onSelect }: { views: PhaseView[]; selected?: string; onSelect: (id: string) => void }) {
  const nodes = useMemo<Node<StationData>[]>(
    () => views.map((v) => ({ id: v.phase.id, type: "station", position: { x: v.phase.lane * LANE, y: v.phase.step * STEP }, data: { view: v, selected: v.phase.id === selected }, draggable: false })),
    [views, selected],
  );
  const state = (id: string) => views.find((v) => v.phase.id === id)?.state;
  const edges = useMemo<Edge[]>(
    () =>
      flowEdges
        .filter(([from, to]) => state(from) && state(to)) // a rewrite's map and an idea's draw different stations
        .map(([from, to]) => {
          const reached = state(from) === "done";
          return { id: `${from}-${to}`, source: from, target: to, type: "smoothstep", style: { stroke: reached ? "var(--color-ink-2)" : "var(--color-line)", strokeWidth: 1.5, strokeDasharray: reached ? undefined : "5 5" } };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={{ station: Station }}
      onNodeClick={(_, n) => onSelect(n.id)}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1.15 }}
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

const ring: Record<State, string> = {
  idle: "border-line bg-surface",
  running: "border-run/40 bg-surface",
  "needs-you": "border-persimmon bg-surface waiting",
  done: "border-line bg-surface",
  rejected: "border-bad/40 bg-surface",
  failed: "border-bad/40 bg-surface",
};

function Station({ data }: NodeProps<Node<StationData>>) {
  const { view, selected } = data;
  return (
    <button
      type="button"
      className={`flex w-[236px] cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-shadow ${ring[view.state]} ${selected ? "shadow-[0_0_0_3px_var(--color-ink)]" : "hover:shadow-md"}`}
      aria-label={`${view.phase.title}: ${view.detail}`}
    >
      <Handle type="target" position={Position.Top} className="!border-0 !bg-transparent" />
      <Glyph state={view.state} />
      <span className="min-w-0">
        <span className={`block text-[15px] font-semibold ${view.state === "idle" ? "text-ink-2" : "text-ink"}`}>{view.phase.title}</span>
        <span className={`block truncate text-[13px] ${view.state === "needs-you" ? "font-medium text-persimmon" : "text-ink-2"}`}>{view.detail}</span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-transparent" />
    </button>
  );
}

export function Glyph({ state, size = 26 }: { state: State; size?: number }) {
  const box = { width: size, height: size };
  switch (state) {
    case "done":
      return (
        <span style={box} className="grid shrink-0 place-items-center rounded-full bg-done text-white">
          <Check className="size-[60%]" strokeWidth={3} aria-hidden />
        </span>
      );
    case "rejected":
    case "failed":
      return (
        <span style={box} className="grid shrink-0 place-items-center rounded-full bg-bad text-white">
          <X className="size-[60%]" strokeWidth={3} aria-hidden />
        </span>
      );
    case "needs-you":
      return (
        <span style={box} className="grid shrink-0 place-items-center rounded-full bg-persimmon">
          <span className="size-[34%] rounded-full bg-white" />
        </span>
      );
    case "running":
      // half filled: under way, nothing for you yet
      return <span style={{ ...box, background: "conic-gradient(var(--color-run) 0 50%, transparent 50% 100%)" }} className="shrink-0 rounded-full border-2 border-run" />;
    default:
      return <span style={box} className="shrink-0 rounded-full border-2 border-dashed border-ink-3" />;
  }
}
