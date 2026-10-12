import { useReactFlow } from "@xyflow/react";
import { CircleCheck, X } from "lucide-react";
import { useMemo } from "react";
import { currentModel } from "@/lib/document";
import { check, type Finding } from "@/lib/eventstorming/grammar";
import { useESStore } from "@/lib/store/store";

const DOT: Record<Finding["severity"], string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

// A node finding is written `node <id>: …` by the grammar, which is how the panel
// knows what to frame. Findings about edges, contexts or the model as a whole have
// nothing single to point at and are read-only lines.
const NODE_OF = /^node (\S+):/;

/** Model health: the grammar's findings over the live board (24-eventstorming.md),
 *  the same list the `eventstorming/v1` Validator answers at a Gate. Selecting a
 *  finding selects and frames the element it concerns. Advisory — it never blocks
 *  editing; only a save is refused, and by the engine. */
export function HealthPanel() {
  const nodes = useESStore((s) => s.nodes);
  const edges = useESStore((s) => s.edges);
  const contexts = useESStore((s) => s.contexts);
  const contextRelationships = useESStore((s) => s.contextRelationships);
  const level = useESStore((s) => s.level);
  const setSelected = useESStore((s) => s.setSelected);
  const toggleHealth = useESStore((s) => s.toggleHealth);
  const { fitView } = useReactFlow();

  // Findings are a pure function of the model, recomputed whenever it changes.
  const findings = useMemo(
    () => check(currentModel()),
    [nodes, edges, contexts, contextRelationships, level],
  );

  const focus = (id: string) => {
    setSelected(id);
    void fitView({ nodes: [{ id }], padding: 0.3, duration: 300, maxZoom: 1.5 });
  };

  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col border-l border-zinc-200 bg-white"
      data-testid="health-panel"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <span className="text-sm font-semibold text-zinc-800">Model health</span>
        <button
          type="button"
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="Close model health"
          onClick={toggleHealth}
        >
          <X size={15} />
        </button>
      </div>

      {findings.length === 0 ? (
        <div
          className="flex items-center gap-2 px-3 py-4 text-xs text-zinc-500"
          data-testid="health-empty"
        >
          <CircleCheck size={15} className="text-emerald-500" />
          No issues found.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {findings.map((f, i) => {
            const target = NODE_OF.exec(f.message)?.[1];
            return (
              <li key={`${f.code}:${i}`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs text-zinc-700 enabled:hover:bg-zinc-100"
                  data-testid="health-finding"
                  title={f.code}
                  disabled={!target}
                  onClick={() => target && focus(target)}
                >
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${DOT[f.severity]}`} />
                  <span>{f.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
