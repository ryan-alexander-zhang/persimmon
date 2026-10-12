import { useReactFlow } from "@xyflow/react";
import { Filter as FilterIcon, Search } from "lucide-react";
import { useState } from "react";
import { ELEMENT_DEFINITIONS, ELEMENT_TYPES } from "@/lib/eventstorming/elements";
import { isShownByFilter, matchesQuery } from "@/lib/store/filter";
import { useESStore } from "@/lib/store/store";

// Search + filter controls (spec-00006 / us-00018). Search highlights matches (the
// ring is drawn in the editor) and Enter fits the view to them; the Filter popover
// picks which types/contexts to show (none selected = show all). View-only.
export function FilterControls() {
  const nodes = useESStore((s) => s.nodes);
  const contexts = useESStore((s) => s.contexts);
  const filter = useESStore((s) => s.filter);
  const setFilterQuery = useESStore((s) => s.setFilterQuery);
  const toggleFilterType = useESStore((s) => s.toggleFilterType);
  const toggleFilterContext = useESStore((s) => s.toggleFilterContext);
  const clearFilter = useESStore((s) => s.clearFilter);
  const { fitView } = useReactFlow();
  const [open, setOpen] = useState(false);

  // Match count = elements passing the type/context filter that also match the
  // query; Enter fits the view to them.
  const matched = nodes.filter((n) => isShownByFilter(n, filter) && matchesQuery(n, filter.query));
  const onSubmit = () => {
    if (matched.length > 0) {
      fitView({ nodes: matched.map((n) => ({ id: n.id })), duration: 300, padding: 0.3 });
    }
  };

  const filterActive = filter.types.size > 0 || filter.contexts.size > 0;
  const chip = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[11px] ${
      active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
    }`;

  return (
    <div className="relative flex items-center gap-1.5">
      <div className="flex items-center rounded-md border border-zinc-300 pl-1.5">
        <Search size={13} className="text-zinc-400" />
        <input
          type="search"
          value={filter.query}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Search…"
          aria-label="Search elements"
          className="w-36 bg-transparent px-1.5 py-1 text-xs outline-none"
        />
        {filter.query.trim() && (
          <span className="pr-2 text-[11px] tabular-nums text-zinc-500" data-testid="search-count">
            {matched.length}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label="Filter"
        aria-pressed={filterActive}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
          filterActive
            ? "border-blue-400 bg-blue-50 text-blue-700"
            : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        <FilterIcon size={14} /> Filter
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-3 shadow-lg"
          data-testid="filter-popover"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Type</p>
          <div className="flex flex-wrap gap-1">
            {ELEMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={chip(filter.types.has(t))}
                aria-pressed={filter.types.has(t)}
                onClick={() => toggleFilterType(t)}
              >
                {ELEMENT_DEFINITIONS[t].label}
              </button>
            ))}
          </div>

          <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Bounded Context
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={chip(filter.contexts.has(null))}
              aria-pressed={filter.contexts.has(null)}
              onClick={() => toggleFilterContext(null)}
            >
              Ungrouped
            </button>
            {contexts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={chip(filter.contexts.has(c.id))}
                aria-pressed={filter.contexts.has(c.id)}
                onClick={() => toggleFilterContext(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-zinc-400">Nothing selected = show all.</p>
          {(filterActive || filter.query) && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-blue-600 hover:underline"
              onClick={clearFilter}
            >
              Clear search &amp; filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
