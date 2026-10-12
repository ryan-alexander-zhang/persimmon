import { useViewport } from "@xyflow/react";
import { Check, Crosshair, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BAND_ORDER,
  type Band,
  ELEMENT_BAND,
  ELEMENT_DEFINITIONS,
} from "@/lib/eventstorming/elements";
import { contextTint, MUD_STYLE, SUBDOMAIN_STYLE } from "@/lib/eventstorming/context-color";
import { LEVEL_TYPES } from "@/lib/eventstorming/levels";
import { computeBandTops } from "@/lib/layout/layout";
import { useESStore } from "@/lib/store/store";
import type { ESNode } from "@/lib/store/types";

const BAND_LABEL: Record<Band, string> = {
  actorSystem: "Actors / Systems",
  command: "Commands",
  constraint: "Constraints",
  aggregate: "Aggregates",
  domainEvent: "Domain Events",
  policy: "Policies",
  readModel: "Read Models",
  hotspot: "Hot Spots",
  opportunity: "Opportunities",
};

const BAND_COLOR: Record<Band, string> = {
  actorSystem: ELEMENT_DEFINITIONS.actor.color,
  command: ELEMENT_DEFINITIONS.command.color,
  constraint: ELEMENT_DEFINITIONS.constraint.color,
  aggregate: ELEMENT_DEFINITIONS.aggregate.color,
  domainEvent: ELEMENT_DEFINITIONS.domainEvent.color,
  policy: ELEMENT_DEFINITIONS.policy.color,
  readModel: ELEMENT_DEFINITIONS.readModel.color,
  hotspot: ELEMENT_DEFINITIONS.hotspot.color,
  opportunity: ELEMENT_DEFINITIONS.opportunity.color,
};

/** Band rail (left, y-aligned) and context headers (top, x-aligned) that track
 *  the React Flow viewport so they stay aligned to nodes under pan/zoom.
 *  While Isolate reflows the board the rail must read *that* layout, so the
 *  isolated nodes and their band tops are handed in (issue-00021). */
export function BoardChrome({
  isolated,
}: {
  isolated?: { nodes: ESNode[]; bandTops: number[] } | null;
}) {
  const { y: vy, zoom } = useViewport();
  const nodes = useESStore((s) => s.nodes);
  const edges = useESStore((s) => s.edges);
  const contexts = useESStore((s) => s.contexts);
  const level = useESStore((s) => s.level);
  const addNode = useESStore((s) => s.addNode);
  const renameContext = useESStore((s) => s.renameContext);
  const setContextClassification = useESStore((s) => s.setContextClassification);
  const setContextBigBallOfMud = useESStore((s) => s.setContextBigBallOfMud);
  const removeContext = useESStore((s) => s.removeContext);
  const setSelected = useESStore((s) => s.setSelected);
  const focusedContext = useESStore((s) => s.focusedContext);
  const setFocusedContext = useESStore((s) => s.setFocusedContext);
  const isolateContext = useESStore((s) => s.isolateContext);

  // Progressive disclosure: the open `⋯` menu (id + the trigger's screen anchor,
  // so the menu can portal out of the header's horizontal scroll container and
  // not get clipped), and which chip is being renamed inline. One of each.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Isolate collapses the bands its neighbourhood does not occupy, so the rail
  // labels only the bands that are actually there and takes their tops from the
  // same relayout the board is drawn from.
  //
  // Both are memoised on the model: this component re-renders on every pan/zoom
  // frame (it tracks the viewport), while band tops are a function of the model
  // alone. Recomputing them per frame re-ran the whole placement pass — O(nodes ×
  // edges) — for a result that had not changed (issue-00026).
  const visibleBands = useMemo(
    () =>
      isolated
        ? new Set(isolated.nodes.map((n) => ELEMENT_BAND[n.type]))
        : new Set(LEVEL_TYPES[level].map((t) => ELEMENT_BAND[t])),
    [isolated, level],
  );

  const bandTops = useMemo(
    () => isolated?.bandTops ?? computeBandTops(nodes, edges, contexts, level),
    [isolated, nodes, edges, contexts, level],
  );
  const nameOf = new Map(contexts.map((c) => [c.id, c.name]));

  const addEvent = (ctxId?: string) => {
    setSelected(addNode("domainEvent", ctxId));
    setMenu(null);
  };

  const menuCtx = menu ? (contexts.find((c) => c.id === menu.id) ?? null) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* band rail — left edge, vertical position tracks the viewport */}
      {BAND_ORDER.map((band, i) => {
        if (!visibleBands.has(band)) return null;
        const top = bandTops[i] * zoom + vy;
        return (
          <div
            key={band}
            className="absolute left-2 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 shadow-sm backdrop-blur-sm"
            style={{ top: top + 6 }}
          >
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: BAND_COLOR[band] }}
            />
            {BAND_LABEL[band]}
          </div>
        );
      })}

      {/* Context legend — one compact, fixed-height row that scales to many
          contexts (spec-00010). A chip shows colour + name + subdomain badge; its
          body toggles Bounded Context Focus (dim the rest). Rename / classify /
          add-event / delete live behind the `⋯` menu (progressive disclosure). On
          the board a context is a sticky tint, not a spanning box (decision-00005);
          Ungrouped events get no chip. */}
      {contexts.length > 0 && (
        <>
          <div
            data-testid="context-legend"
            className="pointer-events-auto absolute left-1/2 top-2 z-50 flex max-w-[72%] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-lg p-1"
          >
            {contexts
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((c) => {
                const tint = contextTint(c.id);
                const focused = focusedContext === c.id;
                const badge = c.classification ? SUBDOMAIN_STYLE[c.classification] : null;
                return (
                  <div key={c.id} className="relative shrink-0">
                    <div
                      className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white/90 px-1.5 py-1 shadow-sm backdrop-blur-sm"
                      style={
                        focused ? { borderColor: tint, boxShadow: `0 0 0 2px ${tint}66` } : undefined
                      }
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: tint }}
                      />
                      {editingId === c.id ? (
                        <input
                          autoFocus
                          className="w-24 min-w-0 bg-white/60 text-xs font-semibold text-zinc-700 outline-none"
                          defaultValue={nameOf.get(c.id) ?? c.name}
                          aria-label="Context name"
                          onBlur={(e) => {
                            renameContext(c.id, e.target.value.trim() || c.name);
                            setEditingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="max-w-[128px] truncate text-xs font-semibold text-zinc-700 outline-none hover:text-zinc-900"
                          onClick={() => setFocusedContext(c.id)}
                          onDoubleClick={() => setEditingId(c.id)}
                          title="Click to focus this context · double-click to rename"
                        >
                          {nameOf.get(c.id) ?? c.name}
                        </button>
                      )}
                      {badge && (
                        <span
                          className="shrink-0 rounded border px-1 text-[9px] font-semibold uppercase tracking-wide"
                          style={{ color: badge.color, borderColor: badge.color }}
                        >
                          {badge.label}
                        </span>
                      )}
                      {c.bigBallOfMud && (
                        <span
                          className="shrink-0 rounded border px-1 text-[9px] font-semibold uppercase tracking-wide"
                          style={{ color: MUD_STYLE.color, borderColor: MUD_STYLE.color }}
                        >
                          {MUD_STYLE.label}
                        </span>
                      )}
                      {/* Primary action stays one-click and visible: adding a
                          Domain Event is the only per-context creation entry. */}
                      <button
                        type="button"
                        className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                        onClick={() => addEvent(c.id)}
                        aria-label="Add Event"
                        title="Add a Domain Event to this context"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        type="button"
                        className="flex shrink-0 items-center rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        onClick={(e) => {
                          if (menu?.id === c.id) {
                            setMenu(null);
                            return;
                          }
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu({ id: c.id, x: r.left, y: r.bottom });
                        }}
                        aria-label="Context options"
                        aria-haspopup="menu"
                        aria-expanded={menu?.id === c.id}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
          {menuCtx &&
            menu &&
            createPortal(
              <>
                {/* click-away layer */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-[60] cursor-default"
                  onClick={() => setMenu(null)}
                />
                {/* menu — fixed, anchored under the trigger, portalled to escape
                    the header's scroll container (issue: overflow-x clips it) */}
                <div
                  role="menu"
                  className="fixed z-[61] w-44 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg"
                  style={{
                    left: Math.min(menu.x, window.innerWidth - 184),
                    top: menu.y + 4,
                  }}
                >
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      setEditingId(menuCtx.id);
                      setMenu(null);
                    }}
                  >
                    <Pencil size={13} /> Rename
                  </button>
                  {/* Isolate the whole context: unlike Bounded Context Focus (which
                      the chip body toggles, and which only dims), this hides the rest
                      and relayouts the slice as its own compact board. */}
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      isolateContext(menuCtx.id);
                      setMenu(null);
                    }}
                  >
                    <Crosshair size={13} /> Isolate this context
                  </button>
                  <div className="my-1 border-t border-zinc-100" />
                  <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Subdomain
                  </div>
                  {(["core", "supporting", "generic"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        setContextClassification(
                          menuCtx.id,
                          menuCtx.classification === k ? undefined : k,
                        );
                        setMenu(null);
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: SUBDOMAIN_STYLE[k].color }}
                      />
                      {SUBDOMAIN_STYLE[k].label}
                      {menuCtx.classification === k && <Check size={13} className="ml-auto" />}
                    </button>
                  ))}
                  <div className="my-1 border-t border-zinc-100" />
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      setContextBigBallOfMud(menuCtx.id, menuCtx.bigBallOfMud ? undefined : true);
                      setMenu(null);
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: MUD_STYLE.color }} />
                    {MUD_STYLE.label}
                    {menuCtx.bigBallOfMud && <Check size={13} className="ml-auto" />}
                  </button>
                  <div className="my-1 border-t border-zinc-100" />
                  <button
                    type="button"
                    className={`${MENU_ITEM} text-red-600 hover:bg-red-50`}
                    onClick={() => {
                      removeContext(menuCtx.id);
                      setMenu(null);
                    }}
                  >
                    <Trash2 size={13} /> Delete context
                  </button>
                </div>
              </>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-zinc-700 hover:bg-zinc-100";
