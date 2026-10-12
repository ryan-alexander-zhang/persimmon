import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { MUD_STYLE, SUBDOMAIN_STYLE, type Subdomain } from "@/lib/eventstorming/context-color";

// A Bounded Context as a node in the Context Map (spec-00004 FR5): its name, its
// identity tint, and its subdomain classification badge. Four connection handles
// so a relationship can be drawn in any direction.
export type ContextFlowNode = Node<
  { name: string; tint?: string; classification?: Subdomain; bigBallOfMud?: boolean },
  "context"
>;

const HANDLE = { width: 8, height: 8, background: "#94a3b8", border: "1px solid #fff" } as const;

// Handle id suffixes match the router in lib/layout/context-map.ts (issue-00012):
// s-left / t-left / s-right / … so edges bind to the geometry-correct side.
const SIDES = [
  { id: "left", position: Position.Left },
  { id: "right", position: Position.Right },
  { id: "top", position: Position.Top },
  { id: "bottom", position: Position.Bottom },
] as const;

export function ContextNode({ data, selected }: NodeProps<ContextFlowNode>) {
  const cls = data.classification;
  return (
    <div
      data-testid="context-node"
      className="min-w-[150px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm"
      style={{ borderColor: data.tint ?? "#d4d4d8", outline: selected ? "2px solid #111827" : "none" }}
    >
      {SIDES.map((s) => (
        <div key={s.id}>
          {/* target rendered first, source on top: a drag starts on the source
              handle so the drag-start node becomes the edge's source (issue-00013). */}
          <Handle type="target" id={`t-${s.id}`} position={s.position} style={HANDLE} />
          <Handle type="source" id={`s-${s.id}`} position={s.position} style={HANDLE} />
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: data.tint ?? "#d4d4d8" }} />
        <span className="text-sm font-semibold text-zinc-800">{data.name}</span>
      </div>
      {cls && (
        <span
          className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ background: SUBDOMAIN_STYLE[cls].color }}
        >
          {SUBDOMAIN_STYLE[cls].label}
        </span>
      )}
      {data.bigBallOfMud && (
        <span
          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white${cls ? " ml-1" : ""}`}
          style={{ background: MUD_STYLE.color }}
        >
          {MUD_STYLE.label}
        </span>
      )}
    </div>
  );
}
