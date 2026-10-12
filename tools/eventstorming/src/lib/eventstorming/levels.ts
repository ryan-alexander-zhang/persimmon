// The three Event Storming levels. A level is a view filter over the same model:
// switching level shows/hides element types (and their bands), it never deletes
// anything. Types are cumulative Big Picture ⊂ Process ⊂ Design.

import { type ElementType, type Level, levelRank, levels } from "./grammar";

export type { Level };

/** Big Picture ⊂ Process ⊂ Design, in that order — the grammar's rank. */
export const LEVELS = (Object.keys(levelRank) as Level[]).sort(
  (a, b) => levelRank[a] - levelRank[b],
);

export const LEVEL_LABEL: Record<Level, string> = {
  "big-picture": "Big Picture",
  process: "Process",
  design: "Design",
};

export const LEVEL_TYPES = levels;

export const isVisibleAt = (level: Level, type: ElementType): boolean =>
  LEVEL_TYPES[level].includes(type);

// Semantic zoom: as the board is zoomed out, level of detail drops to the
// Domain Event backbone, then rises back to full detail on zoom-in — but never
// beyond the user's current Level (design-00003 §3 Tier C). Thresholds are on
// React Flow's zoom (1 = 100%).
// Only genuinely zoomed-out views reduce detail, so a normal fitView of a small
// board (which lands around zoom 0.5–0.6) still shows full detail.
/** The zoom at and above which full detail is shown. Camera moves that frame a
 *  chosen subset (Isolate) must not land below it, or the framing drops the very
 *  detail it was opened to read. */
export const FULL_DETAIL_ZOOM = 0.45;

const ZOOM_DETAIL: Array<[min: number, level: Level]> = [
  [FULL_DETAIL_ZOOM, "design"],
  [0.28, "process"],
  [0, "big-picture"],
];

/** The element types to show at `zoom`, bounded by `level`: the less-detailed of
 *  the zoom tier and the current Level (levels are nested Big Picture ⊂ Process
 *  ⊂ Design, so the intersection is the coarser one). */
export function typesForZoom(zoom: number, level: Level): readonly ElementType[] {
  const zoomLevel = ZOOM_DETAIL.find(([min]) => zoom >= min)?.[1] ?? "big-picture";
  const effective = LEVELS.indexOf(zoomLevel) < LEVELS.indexOf(level) ? zoomLevel : level;
  return LEVEL_TYPES[effective];
}
