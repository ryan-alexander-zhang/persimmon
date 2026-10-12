import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Position,
} from "@xyflow/react";
import { X } from "lucide-react";
import { memo } from "react";
import { EDGE_LABEL_Z, RELATION_STYLE } from "@/lib/eventstorming/edge-style";
import { offsetOrthogonalPath } from "@/lib/layout/edge-path";
import { useESStore } from "@/lib/store/store";
import type { ESEdge } from "@/lib/store/types";

const FOCUS_WIDTH_BOOST = 1.5;
const HOVER_WIDTH_BOOST = 3;
const CORNER_RADIUS = 8;

/** Semantic edge: an orthogonal (right-angle, rounded-corner) connector coloured
 *  and weighted by relation type, thickened when it is in the focused/hovered set,
 *  and labelled only then — so the un-focused board stays label-free
 *  (design-00003 Tier A/B). Dimming the edges *outside* that set is the board's job,
 *  not this component's (issue-00019). */
function RelationEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<ESEdge>) {
  const removeEdge = useESStore((s) => s.removeEdge);
  const setHoveredEdge = useESStore((s) => s.setHoveredEdge);
  // Edges sharing a corridor get a small center offset so they bump apart. A
  // straight/aligned smoothstep ignores a center offset, so offset edges use a
  // manually jogged orthogonal path instead (issue-00003).
  const offset = data?.pathOffset ?? 0;
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

  const relation = data?.relation;
  const style = relation ? RELATION_STYLE[relation] : undefined;
  const focusState = data?.focusState ?? "none";
  const color = style?.color ?? "#94a3b8";
  const baseWidth = style?.width ?? 1.5;

  // Edge-hover isolation wins over focus: the hovered edge is emphasised (thicker
  // + glow + label). Dimming the *others* is not decided here — the board dims the
  // whole layer with one rule and lifts the emphasised ids back out (issue-00019),
  // so an edge that is merely dim never re-renders.
  const hover = data?.hover;
  const emphasised = hover === "on";
  const focused = hover === undefined && focusState === "on";
  const showLabel = emphasised || focused;
  const strokeWidth = emphasised
    ? baseWidth + HOVER_WIDTH_BOOST
    : focused
      ? baseWidth + FOCUS_WIDTH_BOOST
      : baseWidth;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          // Flowing dashes come from the `animated` flag (stroke-dashoffset);
          // a hovered edge also gets a soft glow so it reads above the rest.
          strokeWidth,
          ...(emphasised ? { filter: `drop-shadow(0 0 4px ${color})` } : {}),
        }}
      />
      {showLabel && relation && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan absolute flex items-center gap-1 rounded bg-white/85 px-1 py-0.5 text-[10px] font-medium text-zinc-600 shadow-sm ${emphasised ? "pointer-events-auto" : "pointer-events-none"}`}
            // Labels render only for the emphasised set here, so each one that exists
            // is lifted above the stickies it crosses (issue-00034).
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: EDGE_LABEL_Z,
            }}
            // While the pointer sits on the label (a separate overlay layer), keep
            // this edge emphasised so the hover-revealed delete stays reachable —
            // otherwise onEdgeMouseLeave would unmount it before the click lands.
            onMouseEnter={emphasised ? () => setHoveredEdge(id) : undefined}
            onMouseLeave={emphasised ? () => setHoveredEdge(null) : undefined}
          >
            {relation}
            {emphasised && (
              <button
                type="button"
                aria-label="Delete relation"
                className="text-zinc-400 hover:text-red-600"
                // The label renders through EdgeLabelRenderer's portal, which sits
                // inside this edge in the React tree — so an un-stopped click
                // bubbles into React Flow's edge click and selects the edge we
                // just removed, leaving a stale selection (issue-00018).
                onClick={(e) => {
                  e.stopPropagation();
                  removeEdge(id);
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Memoised for the same reason as ElementNode: an edge whose decoration did not
 *  change keeps its object identity and skips re-rendering its path (issue-00019). */
export const RelationEdge = memo(RelationEdgeInner);
