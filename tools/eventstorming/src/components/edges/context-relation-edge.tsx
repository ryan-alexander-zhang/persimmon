import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Position,
} from "@xyflow/react";
import { X } from "lucide-react";
import {
  CONTEXT_RELATION_STYLE,
  CONTEXT_RELATION_TYPES,
  type ContextRelationType,
} from "@/lib/eventstorming/context-relations";
import { EDGE_LABEL_Z } from "@/lib/eventstorming/edge-style";
import { offsetOrthogonalPath } from "@/lib/layout/edge-path";
import { useESStore } from "@/lib/store/store";

const BASE_WIDTH = 2;
const HOVER_WIDTH_BOOST = 3;
const FOCUS_WIDTH_BOOST = 1.5;
const DIM_OPACITY = 0.12;
const DIM_LABEL_OPACITY = 0.3;
const CORNER_RADIUS = 8;

// A context relationship as a directed, typed edge on the Context Map. Its label
// is an inline type picker + delete, so a relationship is retyped/removed in place
// (us-00020-FR-3/FR-4). Hover isolation mirrors the board's RelationEdge
// (design-00003 Tier C): the hovered edge thickens, glows and reveals its delete,
// every other edge dims. The type picker stays visible unhovered — on this surface
// the label is the only place a relationship's type is readable.
export function ContextRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const type = (data?.type as ContextRelationType) ?? "customerSupplier";
  const style = CONTEXT_RELATION_STYLE[type];
  const setType = useESStore((s) => s.setContextRelationshipType);
  const remove = useESStore((s) => s.removeContextRelationship);
  const setHoveredEdge = useESStore((s) => s.setHoveredEdge);

  // Relationships sharing a corridor get a center offset so they bump apart; a
  // straight/aligned smoothstep ignores it, so those use a manually jogged path
  // (same mechanism as the board — issue-00003).
  const offset = (data?.pathOffset as number | undefined) ?? 0;
  const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const [path, labelX, labelY] =
    offset === 0
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: CORNER_RADIUS,
        })
      : offsetOrthogonalPath(sourceX, sourceY, targetX, targetY, vertical, offset);

  const hover = data?.hover as "on" | "dim" | undefined;
  const emphasised = hover === "on";
  const dimmed = hover === "dim";
  // In a focused context's neighbourhood without a hover: thickened and flowing,
  // but no glow and no delete — deleting stays tied to the hovered relationship.
  const focused = !hover && data?.focusState === "on";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: style.color,
          strokeWidth: emphasised
            ? BASE_WIDTH + HOVER_WIDTH_BOOST
            : focused
              ? BASE_WIDTH + FOCUS_WIDTH_BOOST
              : BASE_WIDTH,
          opacity: dimmed ? DIM_OPACITY : 1,
          ...(emphasised ? { filter: `drop-shadow(0 0 4px ${style.color})` } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded bg-white/95 px-1 py-0.5 text-[10px] shadow-sm"
          // Every relationship's label is on here, so only the hovered one is lifted
          // above the contexts: an always-on lift floats resting labels over the cards
          // they cross and hides their names (issue-00035).
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            opacity: dimmed ? DIM_LABEL_OPACITY : 1,
            ...(emphasised ? { zIndex: EDGE_LABEL_Z } : {}),
          }}
          data-testid="context-relation-label"
          // The label is a separate overlay layer, so React Flow's own
          // onEdgeMouseEnter never fires for it. Driving hover from here keeps the
          // edge emphasised while the pointer works the picker or the delete —
          // otherwise the leave would unmount the delete before the click lands.
          onMouseEnter={() => setHoveredEdge(id)}
          onMouseLeave={() => setHoveredEdge(null)}
        >
          <select
            aria-label="Relationship type"
            className="bg-transparent font-semibold outline-none"
            style={{ color: style.color }}
            value={type}
            onChange={(e) => setType(id, e.target.value as ContextRelationType)}
          >
            {CONTEXT_RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTEXT_RELATION_STYLE[t].label}
              </option>
            ))}
          </select>
          {emphasised && (
            <button
              type="button"
              aria-label="Delete relationship"
              className="text-zinc-400 hover:text-red-600"
              onClick={() => remove(id)}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
