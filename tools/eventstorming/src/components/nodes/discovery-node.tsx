import type { Node, NodeProps } from "@xyflow/react";
import { X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ELEMENT_DEFINITIONS } from "@/lib/eventstorming/elements";
import { useESStore } from "@/lib/store/store";

// A discovery-wall sticky: an unordered Domain Event at a free position. Styled
// like a Domain Event but with no connection handles (relaxed grammar), inline
// rename, and a delete affordance. Its data lives in the discovery buffer only.
export type DiscoveryFlowNode = Node<{ label: string }, "discovery">;

export function DiscoveryNode({ id, data, selected }: NodeProps<DiscoveryFlowNode>) {
  const def = ELEMENT_DEFINITIONS.domainEvent;
  const updateDiscoveryItem = useESStore((s) => s.updateDiscoveryItem);
  const removeDiscoveryItem = useESStore((s) => s.removeDiscoveryItem);
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
    updateDiscoveryItem(id, draft.trim() || def.label);
    setEditing(false);
  };

  return (
    <div
      data-testid="discovery-node"
      className="relative min-w-[120px] max-w-[200px] rounded-md px-3 py-2 text-sm text-zinc-900 shadow-sm"
      style={{ background: def.color, outline: selected ? "2px solid #111827" : "none" }}
    >
      <button
        type="button"
        aria-label="Delete event"
        className="absolute -right-2 -top-2 rounded-full bg-white p-0.5 text-zinc-500 shadow hover:text-red-600 nodrag"
        onClick={() => removeDiscoveryItem(id)}
      >
        <X size={12} />
      </button>
      <div className="flex items-center gap-1.5">
        <Zap size={14} className="shrink-0 opacity-70" />
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
          {def.label}
        </span>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          className="mt-1 w-full rounded bg-white/60 px-1 text-sm outline-none nodrag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <div className="mt-1 cursor-text break-words font-medium" onDoubleClick={startEditing}>
          {data.label}
        </div>
      )}
    </div>
  );
}
