import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
} from "lucide-react";
import { type ComponentProps, type RefObject, useLayoutEffect, useRef } from "react";
import { ELEMENT_DEFINITIONS, ELEMENT_TYPES, type ElementType } from "@/lib/eventstorming/elements";
import { isVisibleAt } from "@/lib/eventstorming/levels";
import { useESStore } from "@/lib/store/store";

// Contextual slice actions per selected element type. `dir` says whether the new
// node is the source ("from") or target ("to") of the relation with the selection;
// the relation itself is resolved from the two types by the store.
type SliceAction = { label: string; type: ElementType; dir: "from" | "to" };

// Grammar-correct next steps per element, following the causal flow
// (decision-00003). Design-only steps (Constraint, Aggregate) are filtered out
// below their level by `isVisibleAt`, so the same table serves every level.
const SLICE: Partial<Record<ElementType, SliceAction[]>> = {
  domainEvent: [
    { label: "+ Command (produces)", type: "command", dir: "from" },
    { label: "+ Policy (triggers)", type: "policy", dir: "to" },
    { label: "+ Read Model (updates)", type: "readModel", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  command: [
    { label: "+ Actor (issues)", type: "actor", dir: "from" },
    { label: "+ External System (issues)", type: "externalSystem", dir: "from" },
    { label: "+ Domain Event (produces)", type: "domainEvent", dir: "to" },
    { label: "+ Constraint (constrains)", type: "constraint", dir: "to" },
    { label: "+ Aggregate (handled by)", type: "aggregate", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  actor: [
    { label: "+ Command (issues)", type: "command", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  policy: [
    { label: "+ Command (invokes)", type: "command", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  readModel: [
    { label: "+ Actor (informs)", type: "actor", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  constraint: [
    { label: "+ Command (constrains)", type: "command", dir: "from" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  aggregate: [
    { label: "+ Command (handled by)", type: "command", dir: "from" },
    { label: "+ Domain Event (emits)", type: "domainEvent", dir: "to" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
  externalSystem: [
    { label: "+ Domain Event (emits)", type: "domainEvent", dir: "to" },
    // Both directions, and they mean different things: `issues` is the outside
    // system asking us to act, `handled by` is us calling it (issue-00037).
    { label: "+ Command (issues)", type: "command", dir: "to" },
    { label: "+ Command (handled by)", type: "command", dir: "from" },
    { label: "+ Hotspot", type: "hotspot", dir: "from" },
    { label: "+ Opportunity", type: "opportunity", dir: "from" },
  ],
};

// Every long-text field here is read far more often than it is edited, so the box
// grows to its content instead of hiding the tail behind an inner scrollbar or a
// drag handle. It is a component rather than a helper so a field added later cannot
// forget to fit. `scrollHeight` excludes the border, which `offsetHeight -
// clientHeight` adds back.
function FitTextarea({
  boxRef,
  className,
  value,
  ...props
}: ComponentProps<"textarea"> & {
  // Only for a caller that also needs the element itself — the Resolution field
  // takes the cursor when a Hotspot is resolved.
  boxRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = boxRef ?? own;
  // Refits on mount (a conditionally shown field arrives already filled) and on
  // every value change, including ones this panel did not make — undo, or a load.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [ref, value]);
  return (
    <textarea
      ref={ref}
      className={`${className} min-h-16 resize-none overflow-hidden`}
      value={value}
      {...props}
    />
  );
}

export function PropertyPanel() {
  const selectedId = useESStore((s) => s.selectedId);
  const node = useESStore((s) => s.nodes.find((n) => n.id === s.selectedId) ?? null);
  const level = useESStore((s) => s.level);
  const contexts = useESStore((s) => s.contexts);
  const addNode = useESStore((s) => s.addNode);
  const connect = useESStore((s) => s.connect);
  const updateNodeData = useESStore((s) => s.updateNodeData);
  const setHotspotState = useESStore((s) => s.setHotspotState);
  const removeNode = useESStore((s) => s.removeNode);
  const nudgeEvent = useESStore((s) => s.nudgeEvent);
  const moveEventToEnd = useESStore((s) => s.moveEventToEnd);
  const reassignContext = useESStore((s) => s.reassignContext);
  const setSelected = useESStore((s) => s.setSelected);
  const isolate = useESStore((s) => s.isolate);
  const walkActive = useESStore((s) => s.walk.active);
  const toggleIsolate = useESStore((s) => s.toggleIsolate);
  const setIsolateDirection = useESStore((s) => s.setIsolateDirection);
  const setIsolateDepth = useESStore((s) => s.setIsolateDepth);

  const resolutionRef = useRef<HTMLTextAreaElement>(null);

  const wrap = "w-64 shrink-0 overflow-y-auto border-l border-zinc-200 bg-zinc-50 p-3";

  if (!node) {
    // Nothing selected → the panel is the element palette: place any element the
    // current level allows as a free (Ungrouped) sticky. This is what makes e.g.
    // an Actor creatable at Big Picture without a Command (decision-00003).
    const paletteTypes = ELEMENT_TYPES.filter((t) => isVisibleAt(level, t));
    return (
      <aside className={wrap}>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Add element
        </div>
        <div className="flex flex-col gap-1.5">
          {paletteTypes.map((t) => (
            <button
              key={t}
              type="button"
              aria-label={`Add ${ELEMENT_DEFINITIONS[t].label}`}
              className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              onClick={() => setSelected(addNode(t))}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: ELEMENT_DEFINITIONS[t].color }}
              />
              {ELEMENT_DEFINITIONS[t].label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Pick an element to place it (Ungrouped), or add a Domain Event from a context
          header. Select an element to edit it and build its slice.
        </p>
      </aside>
    );
  }

  const def = ELEMENT_DEFINITIONS[node.type];
  const isHotspot = node.type === "hotspot";
  // Hotspot and Opportunity are free-text annotations: they use "Text", not a
  // "Label"/"Description" pair.
  const isAnnotation = isHotspot || node.type === "opportunity";
  const field = "mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm";
  const ctx = node.data.context; // slice children inherit the selection's context (incl. Ungrouped)

  const runSlice = (a: SliceAction) => {
    const newId = addNode(
      a.type,
      ctx,
      a.type === "hotspot"
        ? { label: "Hotspot?" }
        : a.type === "opportunity"
          ? { label: "Opportunity!" }
          : undefined,
    );
    const conn =
      a.dir === "from"
        ? { source: newId, target: node.id }
        : { source: node.id, target: newId };
    connect({ ...conn, sourceHandle: null, targetHandle: null });
    setSelected(newId);
  };

  const actions = (SLICE[node.type] ?? []).filter((a) => isVisibleAt(level, a.type));

  // Policy parameters (spec-00011): a flat name/value list, replaced whole on edit.
  const params = node.data.parameters ?? [];
  const setParams = (next: { name: string; value: string }[]) =>
    updateNodeData(node.id, { parameters: next.length ? next : undefined });

  return (
    <aside className={wrap} key={selectedId}>
      <div className="mb-3 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: def.color }} />
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {def.label}
        </span>
      </div>

      <label className="block text-xs font-medium text-zinc-600">
        {isAnnotation ? "Text" : "Label"}
        <input
          className={field}
          value={node.data.label}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
        />
      </label>

      {/* An Alternative Set is the fork this board has no room to draw: members happen
          instead of each other. Only the two elements that represent something happening
          at a moment can belong to one (decision-00013). */}
      {(node.type === "domainEvent" || node.type === "command") && (
        <label className="mt-3 block text-xs font-medium text-zinc-600">
          Alternative set
          <input
            className={field}
            placeholder="shared key, e.g. charge-outcome"
            value={node.data.alternativeSet ?? ""}
            onChange={(e) =>
              updateNodeData(node.id, { alternativeSet: e.target.value.trim() || undefined })
            }
          />
        </label>
      )}

      {isHotspot && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={node.data.state === "resolved"}
              onChange={(e) => {
                setHotspotState(node.id, e.target.checked ? "resolved" : "open");
                // Prompted, never blocking: resolving puts the cursor in the
                // Resolution field, which the same click has just revealed.
                if (e.target.checked) {
                  requestAnimationFrame(() => resolutionRef.current?.focus());
                }
              }}
            />
            Resolved
          </label>
          {/* Shown once there is anything to show, so a Hotspot set back to `open`
              still carries what closed it last time (us-00033-FR-4). */}
          {(node.data.state === "resolved" || node.data.resolution || node.data.resolvedAt) && (
            <div>
              <label className="block text-xs font-medium text-zinc-600">
                Resolution
                <FitTextarea
                  boxRef={resolutionRef}
                  className={field}
                  placeholder="What closed it — the answer, the decision, the mitigation"
                  value={node.data.resolution ?? ""}
                  onChange={(e) =>
                    updateNodeData(node.id, { resolution: e.target.value || undefined })
                  }
                />
              </label>
              {/* Outside the label on purpose: inside, the timestamp becomes part of
                  the field's accessible name ("Resolution resolved 8/17/2026"). */}
              {node.data.resolvedAt && (
                <p className="mt-1 text-[11px] text-zinc-400" data-testid="resolved-at">
                  {node.data.state === "resolved" ? "Resolved" : "Last resolved"}{" "}
                  {new Date(node.data.resolvedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
          <label className="block text-xs font-medium text-zinc-600">
            Kind
            <select
              className={field}
              value={node.data.kind ?? ""}
              onChange={(e) =>
                updateNodeData(node.id, {
                  kind: (e.target.value || undefined) as
                    | "conflict"
                    | "question"
                    | "risk"
                    | undefined,
                })
              }
            >
              <option value="">—</option>
              <option value="conflict">Conflict</option>
              <option value="question">Question</option>
              <option value="risk">Risk</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-zinc-600">
            Priority
            <select
              className={field}
              value={node.data.priority ?? ""}
              onChange={(e) =>
                updateNodeData(node.id, {
                  priority: (e.target.value || undefined) as "low" | "medium" | "high" | undefined,
                })
              }
            >
              <option value="">—</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
      )}

      {!isAnnotation && (
        <label className="mt-3 block text-xs font-medium text-zinc-600">
          Description
          <FitTextarea
            className={field}
            value={node.data.description ?? ""}
            onChange={(e) => updateNodeData(node.id, { description: e.target.value })}
          />
        </label>
      )}

      {node.type === "constraint" && (
        <label className="mt-3 block text-xs font-medium text-zinc-600">
          Rule
          <FitTextarea
            className={field}
            placeholder="The invariant that must hold"
            value={node.data.rule ?? ""}
            onChange={(e) => updateNodeData(node.id, { rule: e.target.value || undefined })}
          />
        </label>
      )}

      {node.type === "policy" && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="block text-xs font-medium text-zinc-600">
            Condition
            <input
              className={field}
              placeholder="The guard (if …)"
              value={node.data.condition ?? ""}
              onChange={(e) => updateNodeData(node.id, { condition: e.target.value || undefined })}
            />
          </label>
          <label className="block text-xs font-medium text-zinc-600">
            Execution
            <select
              className={field}
              value={node.data.execution ?? ""}
              onChange={(e) =>
                updateNodeData(node.id, {
                  execution: (e.target.value || undefined) as "automatic" | "manual" | undefined,
                })
              }
            >
              <option value="">—</option>
              <option value="automatic">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <div className="text-xs font-medium text-zinc-600">
            Parameters
            <div className="mt-1 flex flex-col gap-1">
              {params.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, edited in place
                <div key={i} className="flex items-center gap-1">
                  <input
                    className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    aria-label={`Parameter ${i + 1} name`}
                    placeholder="name"
                    value={p.name}
                    onChange={(e) =>
                      setParams(params.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))
                    }
                  />
                  <input
                    className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    aria-label={`Parameter ${i + 1} value`}
                    placeholder="value"
                    value={p.value}
                    onChange={(e) =>
                      setParams(params.map((q, j) => (j === i ? { ...q, value: e.target.value } : q)))
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove parameter ${i + 1}`}
                    className="shrink-0 rounded border border-zinc-300 px-1.5 py-1 text-zinc-500 hover:bg-zinc-100"
                    onClick={() => setParams(params.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="mt-0.5 self-start rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                onClick={() => setParams([...params, { name: "", value: "" }])}
              >
                + Add parameter
              </button>
            </div>
          </div>
        </div>
      )}

      {contexts.length > 0 && (
        <label className="mt-3 block text-xs font-medium text-zinc-600">
          Bounded context
          <select
            className={field}
            value={node.data.context ?? ""}
            onChange={(e) => reassignContext(node.id, e.target.value)}
          >
            <option value="">Ungrouped</option>
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {node.type === "domainEvent" && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={!!node.data.pivotal}
              onChange={(e) => updateNodeData(node.id, { pivotal: e.target.checked })}
            />
            Pivotal event
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={!!node.data.temporal}
              onChange={(e) => updateNodeData(node.id, { temporal: e.target.checked })}
            />
            Temporal event (raised by time)
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Timeline</span>
            <button
              type="button"
              aria-label="Move to start"
              className="flex items-center rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => moveEventToEnd(node.id, -1)}
              title="Move to start"
            >
              <ChevronsLeft size={13} />
            </button>
            <button
              type="button"
              aria-label="Move earlier"
              className="flex items-center rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => nudgeEvent(node.id, -1)}
              title="Move earlier"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              aria-label="Move later"
              className="flex items-center rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => nudgeEvent(node.id, 1)}
              title="Move later"
            >
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              aria-label="Move to end"
              className="flex items-center rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100"
              onClick={() => moveEventToEnd(node.id, 1)}
              title="Move to end"
            >
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Build slice
          </div>
          <div className="flex flex-col gap-1.5">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="flex items-center gap-2 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                onClick={() => runSlice(a)}
              >
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: ELEMENT_DEFINITIONS[a.type].color }}
                />
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* A walkthrough brings its own Reading Scope, on the stepping card, and does
          not share the board with Isolate (us-00029-FR-5) — so Isolate is not offered
          while one is running. */}
      {!walkActive && (
      <div className="mt-4 border-t border-zinc-200 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Isolate
          </span>
          <button
            type="button"
            aria-pressed={isolate.active}
            title="Isolate (i)"
            onClick={toggleIsolate}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              isolate.active
                ? "bg-zinc-800 text-white"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {isolate.active ? "On" : "Off"}
          </button>
        </div>
        {/* Direction and depth walk an element's relations, so they are meaningless
            while the view is anchored on a whole Bounded Context. */}
        {isolate.active && isolate.anchor?.kind !== "context" && (
          <div className="mt-2 space-y-2">
            <div
              className="flex items-center rounded-md border border-zinc-300 p-0.5"
              role="group"
              aria-label="Isolate direction"
            >
              {(
                [
                  ["up", "Upstream"],
                  ["both", "Both"],
                  ["down", "Downstream"],
                ] as const
              ).map(([d, lbl]) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={isolate.direction === d}
                  className={`flex-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    isolate.direction === d ? "bg-zinc-800 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                  onClick={() => setIsolateDirection(d)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <span>Depth</span>
              <button
                type="button"
                aria-label="Decrease depth"
                className="rounded border border-zinc-300 px-1.5 hover:bg-zinc-100"
                onClick={() => setIsolateDepth(isolate.depth - 1)}
              >
                −
              </button>
              <span className="tabular-nums">{isolate.depth}</span>
              <button
                type="button"
                aria-label="Increase depth"
                className="rounded border border-zinc-300 px-1.5 hover:bg-zinc-100"
                onClick={() => setIsolateDepth(isolate.depth + 1)}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      <button
        type="button"
        className="mt-4 flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        onClick={() => removeNode(node.id)}
      >
        <Trash2 size={14} /> Delete
      </button>
    </aside>
  );
}
