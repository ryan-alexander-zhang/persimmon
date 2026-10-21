import type { Node, NodeProps } from "@xyflow/react";
import { SUBDOMAIN_STYLE, type Subdomain } from "@/lib/eventstorming/context-color";

// A subdomain on the Context Map (DSL 4.1): the Prd's problem space drawn as a
// dashed box around the Bounded Contexts that realise it, headed by its id and
// its type. Sits behind the context nodes; never dragged, never connected.
export type SubdomainFlowNode = Node<
  { subdomain?: string; classification?: Subdomain; w: number; h: number },
  "subdomain"
>;

export function SubdomainNode({ data }: NodeProps<SubdomainFlowNode>) {
  const cls = data.classification;
  return (
    <div
      data-testid="subdomain-node"
      className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50/60"
      style={{ width: data.w, height: data.h }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Subdomain
        </span>
        <span className="text-sm font-semibold text-zinc-700">{data.subdomain ?? "unassigned"}</span>
        {cls && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ background: SUBDOMAIN_STYLE[cls].color }}
          >
            {SUBDOMAIN_STYLE[cls].label}
          </span>
        )}
      </div>
    </div>
  );
}
