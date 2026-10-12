import { useReactFlow } from "@xyflow/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { computeNeighborhood } from "@/lib/store/focus";
import { useESStore, WALK_SCOPE_MAX } from "@/lib/store/store";
import { timelineOrder } from "@/lib/store/timeline";

/** Narrative walkthrough overlay (spec-00005): steps through the Domain Event
 *  timeline. Read-only — it moves the selection (so the board dims to the current
 *  event's slice) and frames it; it never edits the model. */
export function Walkthrough() {
  const nodes = useESStore((s) => s.nodes);
  const edges = useESStore((s) => s.edges);
  const index = useESStore((s) => s.walk.index);
  const walkStep = useESStore((s) => s.walkStep);
  const stop = useESStore((s) => s.stopWalkthrough);
  const scope = useESStore((s) => s.walk.scope);
  const setWalkScope = useESStore((s) => s.setWalkScope);
  const { fitView } = useReactFlow();

  const order = timelineOrder(nodes);
  const total = order.length;
  const currentId = order[index];
  const label = nodes.find((n) => n.id === currentId)?.data.label ?? "—";

  // Frame the Current Step's own slice — the event and what directly serves it —
  // rather than the event alone, which left its own Command off screen on a board
  // deep enough to separate the bands (issue-00032). Deliberately one hop whatever
  // the Reading Scope: a wide scope reaches events far along the timeline, and
  // fitting *that* shrinks the board to an unreadable strip and pulls the frame's
  // centre away from the step. The wider scope is context to pan into, and moving
  // the slider no longer throws the camera.
  const frame = useMemo(() => {
    if (!currentId) return null;
    const { nodeIds } = computeNeighborhood(currentId, edges, { depth: 1, direction: "both" });
    return [...nodeIds].map((id) => ({ id }));
  }, [currentId, edges]);

  useEffect(() => {
    if (frame) void fitView({ nodes: frame, padding: 0.25, duration: 300, maxZoom: 1.2 });
  }, [frame, fitView]);

  // ←/→ step the cursor (us-00028-FR-5). The editor's arrow handler returns while
  // a walkthrough is active, so the same keys never also nudge the timeline
  // (spec-00005-XFR-1). Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      walkStep(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walkStep]);

  const nav =
    "flex items-center rounded-md border border-zinc-300 p-1 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40";

  return (
    <div
      className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 overflow-hidden rounded-lg border border-zinc-200 bg-white px-3 pb-3 pt-2 shadow-lg"
      data-testid="walkthrough"
    >
      <button
        type="button"
        aria-label="Previous event"
        aria-keyshortcuts="ArrowLeft"
        className={nav}
        disabled={index <= 0}
        onClick={() => walkStep(-1)}
      >
        <ChevronLeft size={16} />
      </button>
      {/* The event's name is what the story is told with, so it leads; the counter
          is the supporting detail, not the only signal of where the cursor is. */}
      <div className="min-w-40 max-w-60 text-center">
        <div
          className="truncate text-sm font-semibold text-zinc-900"
          data-testid="walkthrough-label"
        >
          {label}
        </div>
        <div
          className="mt-0.5 font-mono text-[11px] text-zinc-500"
          data-testid="walkthrough-counter"
        >
          {total === 0 ? "0 / 0" : `${index + 1} / ${total}`}
        </div>
      </div>
      <button
        type="button"
        aria-label="Next event"
        aria-keyshortcuts="ArrowRight"
        className={nav}
        disabled={total === 0 || index >= total - 1}
        onClick={() => walkStep(1)}
      >
        <ChevronRight size={16} />
      </button>
      {/* How much of the board around the Current Step stays visible (us-00029-FR-4).
          One hop is the event's own slice; wider reaches into the neighbouring
          events' slices, which is context rather than a bigger slice. */}
      <label className="flex items-center gap-1.5 border-l border-zinc-200 pl-3 text-[11px] text-zinc-500">
        Scope
        <input
          type="range"
          min={1}
          max={WALK_SCOPE_MAX}
          step={1}
          value={scope}
          aria-label="Reading scope"
          aria-valuetext={`${scope} ${scope === 1 ? "hop" : "hops"}`}
          className="w-16 accent-violet-700"
          onChange={(e) => setWalkScope(Number(e.target.value))}
        />
        <span className="w-2 font-mono tabular-nums text-zinc-700">{scope}</span>
      </label>
      <button
        type="button"
        aria-label="Exit walkthrough"
        className="flex items-center rounded-md border border-zinc-300 p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
        onClick={stop}
      >
        <X size={15} />
      </button>
      {/* How far along the timeline the cursor is, in the same violet as the Step
          Ring on the board. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-zinc-100">
        <div
          className="h-full bg-violet-700 transition-[width] duration-200"
          style={{ width: `${total === 0 ? 0 : ((index + 1) / total) * 100}%` }}
          data-testid="walkthrough-progress"
        />
      </div>
    </div>
  );
}
