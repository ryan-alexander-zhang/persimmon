import { Combine, Crosshair, Network, Plus, Sparkles, X } from "lucide-react";
import { DocumentMenu } from "@/components/document-menu";
import { FilterControls } from "@/components/filter-controls";
import { LEVEL_LABEL, LEVELS } from "@/lib/eventstorming/levels";
import { useESStore } from "@/lib/store/store";

export function Toolbar() {
  const level = useESStore((s) => s.level);
  const setLevel = useESStore((s) => s.setLevel);
  const discoveryActive = useESStore((s) => s.discovery.active);
  const enterDiscovery = useESStore((s) => s.enterDiscovery);
  const exitDiscovery = useESStore((s) => s.exitDiscovery);
  const converge = useESStore((s) => s.converge);
  const addDiscoveryItem = useESStore((s) => s.addDiscoveryItem);
  const contextMapOpen = useESStore((s) => s.contextMapOpen);
  const toggleContextMap = useESStore((s) => s.toggleContextMap);
  const isolate = useESStore((s) => s.isolate);
  const toggleIsolate = useESStore((s) => s.toggleIsolate);
  const doc = useESStore((s) => s.doc);
  const saveError = useESStore((s) => s.saveError);

  // Drop a wall event in a light left→right cascade so freshly added events are
  // spatially ordered out of the box; the modeller then drags them where they want.
  const onAddDiscoveryEvent = () => {
    const n = useESStore.getState().discovery.items.length;
    addDiscoveryItem(40 + (n % 5) * 180, 40 + Math.floor(n / 5) * 120);
  };

  const btn =
    "flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100";

  // The three canvases (Board / Context Map / Discovery) are mutually exclusive
  // (editor.tsx: boardView = !contextMap && !discovery). One segmented switcher
  // selects between them; each segment still toggles back to Board when re-clicked.
  const view = discoveryActive ? "discovery" : contextMapOpen ? "contextMap" : "board";
  const goBoard = () => {
    if (contextMapOpen) toggleContextMap();
    if (discoveryActive) exitDiscovery();
  };
  const goContextMap = () => {
    if (discoveryActive) exitDiscovery();
    toggleContextMap();
  };
  const goDiscover = () => {
    if (contextMapOpen) toggleContextMap();
    if (discoveryActive) exitDiscovery();
    else enterDiscovery();
  };
  const seg = (on: boolean) =>
    `flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${
      on ? "bg-zinc-800 text-white" : "text-zinc-600 hover:bg-zinc-100"
    }`;

  return (
    <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
      {/* Which revision of which artifact the board is, and whether it has moved on
          from it (25-ui.md). */}
      <span
        className="flex max-w-[20rem] shrink-0 items-baseline gap-1.5 text-sm"
        data-testid="status-line"
        title={`${doc?.namespace}/${doc?.id}`}
      >
        <span className="truncate font-semibold text-zinc-800">{doc?.id}</span>
        <span className="shrink-0 text-[11px] text-zinc-400">{doc?.namespace}</span>
        <span className="shrink-0 text-[11px] text-zinc-500">
          {doc?.revision === null ? "unsaved" : `r${doc?.revision}`}
        </span>
        {doc?.readOnly ? (
          <span className="shrink-0 rounded bg-amber-50 px-1 text-[11px] text-amber-700">
            older revision
          </span>
        ) : doc && doc.base !== doc.revision ? (
          // Taken on with "edit as new revision": the board is the older revision,
          // the save goes onto the latest.
          <span className="shrink-0 rounded bg-amber-50 px-1 text-[11px] text-amber-700">
            forks from r{doc.revision}
          </span>
        ) : null}
        {doc?.dirty && (
          <span
            className="shrink-0 rounded bg-blue-50 px-1 text-[11px] text-blue-700"
            data-testid="dirty"
          >
            unsaved changes
          </span>
        )}
      </span>
      <div className="ml-3 flex items-center rounded-md border border-zinc-300 p-0.5" role="group" aria-label="View">
        <button type="button" className={seg(view === "board")} aria-pressed={view === "board"} onClick={goBoard}>
          Board
        </button>
        <button
          type="button"
          className={seg(view === "contextMap")}
          aria-pressed={view === "contextMap"}
          onClick={goContextMap}
        >
          <Network size={14} /> Context Map
        </button>
        {/* Discovery Mode: Big-Picture only (decision-00004). Switching Level off
            Big Picture exits the mode and drops this segment. */}
        {level === "big-picture" && (
          <button
            type="button"
            className={seg(view === "discovery")}
            aria-pressed={view === "discovery"}
            onClick={goDiscover}
            data-testid="discovery-controls"
          >
            <Sparkles size={14} /> Discover
          </button>
        )}
      </div>
      <div className="flex items-center rounded-md border border-zinc-300 p-0.5" role="group" aria-label="Level">
        {LEVELS.map((lv) => (
          <button
            key={lv}
            type="button"
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              level === lv ? "bg-zinc-800 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
            aria-pressed={level === lv}
            onClick={() => setLevel(lv)}
          >
            {LEVEL_LABEL[lv]}
          </button>
        ))}
      </div>
      {/* Isolate is sticky across the clearing click, and its On/Off control lives
          in the selected element's panel — so with nothing selected the mode would
          be on but invisible. This chip is the always-visible read-out and exit. */}
      {isolate.active && !discoveryActive && !contextMapOpen && (
        <button
          type="button"
          aria-label="Exit Isolate"
          title="Isolate is on — Esc to exit"
          className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700"
          onClick={toggleIsolate}
        >
          <Crosshair size={14} /> Isolate
          <X size={13} className="text-zinc-400" />
        </button>
      )}
      {discoveryActive && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btn}
            aria-label="Add wall event"
            onClick={onAddDiscoveryEvent}
          >
            <Plus size={14} /> Event
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700"
            onClick={converge}
          >
            <Combine size={14} /> Converge
          </button>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {/* A refused save is the one failure the Modeler has to know about: the board
            keeps working, but this revision did not land. */}
        {saveError && (
          <span
            className="max-w-[16rem] truncate rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600"
            role="alert"
            data-testid="save-error"
            title={saveError}
          >
            {saveError}
          </span>
        )}
        {/* Search + filter target the structured board; hidden in the alternate views. */}
        {!discoveryActive && !contextMapOpen && <FilterControls />}
        <DocumentMenu />
      </div>
    </header>
  );
}
