import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  Box,
  Clock,
  Eye,
  Flame,
  Lightbulb,
  Lock,
  type LucideIcon,
  Server,
  Star,
  Terminal,
  User,
  Workflow,
  Zap,
} from "lucide-react";
import { type CSSProperties, memo, useEffect, useRef, useState } from "react";
import { contextTint } from "@/lib/eventstorming/context-color";
import { ELEMENT_DEFINITIONS, type ElementType } from "@/lib/eventstorming/elements";
import { useESStore } from "@/lib/store/store";
import type { ESNode } from "@/lib/store/types";

export const ICONS: Record<ElementType, LucideIcon> = {
  domainEvent: Zap,
  command: Terminal,
  actor: User,
  constraint: Lock,
  aggregate: Box,
  policy: Workflow,
  readModel: Eye,
  externalSystem: Server,
  hotspot: Flame,
  opportunity: Lightbulb,
};

export const HANDLE_STYLE = {
  width: 7,
  height: 7,
  background: "#94a3b8",
  border: "1px solid #fff",
  opacity: 0.5,
} as const;

export const HANDLES = [
  { id: "s-top", type: "source", position: Position.Top },
  { id: "t-top", type: "target", position: Position.Top },
  { id: "s-bottom", type: "source", position: Position.Bottom },
  { id: "t-bottom", type: "target", position: Position.Bottom },
  { id: "s-left", type: "source", position: Position.Left },
  { id: "t-left", type: "target", position: Position.Left },
  { id: "s-right", type: "source", position: Position.Right },
  { id: "t-right", type: "target", position: Position.Right },
] as const;

/** Pick the handle pair matching the relation's geometry: vertical slice chains
 *  connect bottom↔top, timeline / cross-column relations connect left↔right. */
export function routeHandles(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
      : { sourceHandle: "s-top", targetHandle: "t-bottom" };
  }
  return dx >= 0
    ? { sourceHandle: "s-right", targetHandle: "t-left" }
    : { sourceHandle: "s-left", targetHandle: "t-right" };
}

function ElementNodeInner({ id, type, data, selected }: NodeProps<ESNode>) {
  const def = ELEMENT_DEFINITIONS[type];
  const Icon = ICONS[type];
  const resolved = type === "hotspot" && data.state === "resolved";
  const tint = contextTint(data.context);
  const updateNodeData = useESStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(data.label);
    setEditing(true);
  };

  const commit = () => {
    updateNodeData(id, { label: draft.trim() || def.label });
    setEditing(false);
  };

  return (
    <div
      data-testid="node-body"
      data-resolved={resolved ? "true" : undefined}
      data-context-tint={tint}
      className={`es-sticky relative rounded-md px-3 py-2 text-sm text-zinc-900 shadow-sm ${
        type === "externalSystem" ? "min-w-[168px] max-w-[230px]" : "min-w-[120px] max-w-[200px]"
      }`}
      // The sticky's own colours are also published as custom properties: Tier-A
      // dimming repaints a muted mix of them rather than making the node
      // translucent, and needs the source colour to mix from (issue-00029).
      style={
        {
          background: def.color,
          "--es-fill": def.color,
          ...(tint ? { "--es-tint": tint } : {}),
          outline: selected ? "2px solid #111827" : "none",
          opacity: resolved ? 0.55 : undefined,
          borderLeft: tint ? `5px solid ${tint}` : undefined,
        } as CSSProperties
      }
    >
      {/* Anchor points on all four sides; edges pick the pair that matches the
          slice direction (vertical chain top↔bottom, timeline left↔right). The
          source and target handle on each side overlap, so the source is lifted
          above the target: a drag from a node begins an outgoing (source)
          connection, making a manual link follow the arrow direction (issue-00017). */}
      {HANDLES.map(({ id, type, position }) => (
        <Handle
          key={id}
          id={id}
          type={type}
          position={position}
          style={type === "source" ? { ...HANDLE_STYLE, zIndex: 1 } : HANDLE_STYLE}
        />
      ))}
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="shrink-0 opacity-70" />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
          {def.label}
        </span>
        {type === "domainEvent" && data.pivotal && (
          <Star size={12} className="ml-auto fill-current opacity-80" aria-label="pivotal" />
        )}
        {type === "domainEvent" && data.temporal && (
          <Clock
            size={12}
            className={data.pivotal ? "opacity-80" : "ml-auto opacity-80"}
            aria-label="temporal"
          />
        )}
      </div>
      {editing ? (
        <input
          ref={inputRef}
          className="mt-1 w-full rounded bg-white/60 px-1 text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        // The label is clamped to two lines so the sticky cannot grow past the
        // layout's stacking pitch and cover the sticky below it (issue-00036); the
        // full text stays one hover (title) or one click (property panel) away.
        <div
          className="mt-1 line-clamp-2 cursor-text break-words font-medium"
          title={data.label}
          onDoubleClick={startEditing}
        >
          {data.label}
        </div>
      )}
      {type === "hotspot" && (data.kind || data.priority) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {data.kind && (
            <span className="rounded bg-white/50 px-1 text-[9px] font-semibold uppercase tracking-wide">
              {data.kind}
            </span>
          )}
          {data.priority && (
            <span className="rounded bg-white/50 px-1 text-[9px] font-semibold uppercase tracking-wide">
              {data.priority}
            </span>
          )}
        </div>
      )}
      {type === "policy" && data.execution && (
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded bg-white/50 px-1 text-[9px] font-semibold uppercase tracking-wide">
            {data.execution}
          </span>
        </div>
      )}
      {/* Membership of an Alternative Set: this happens instead of its siblings. The set's
          key is the tooltip rather than the chip — the chip has one line to say what it
          means, and the sticky has a height ceiling (issue-00036). */}
      {data.alternativeSet && (
        <div className="mt-1 flex flex-wrap gap-1">
          <span
            title={`one of: ${data.alternativeSet}`}
            className="rounded bg-white/50 px-1 text-[9px] font-semibold uppercase tracking-wide"
          >
            one of
          </span>
        </div>
      )}
    </div>
  );
}

/** React Flow re-renders a node whenever its record changes; memo keeps that from
 *  cascading into the body (and its 8 handles) when only the wrapper's style moved
 *  — the difference between one node re-rendering and all of them (issue-00019). */
export const ElementNode = memo(ElementNodeInner);
