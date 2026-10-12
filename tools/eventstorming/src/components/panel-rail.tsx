import { Activity, Footprints, History } from "lucide-react";
import { useESStore } from "@/lib/store/store";

// Right-edge icon rail for the board's panels/tools. Health and Revisions dock into
// the shared column (mutually exclusive via the store); Walk is a board overlay mode.
export function PanelRail() {
  const healthOpen = useESStore((s) => s.healthOpen);
  const toggleHealth = useESStore((s) => s.toggleHealth);
  const revisionsOpen = useESStore((s) => s.revisionsOpen);
  const toggleRevisions = useESStore((s) => s.toggleRevisions);
  const walkActive = useESStore((s) => s.walk.active);
  const startWalkthrough = useESStore((s) => s.startWalkthrough);
  const stopWalkthrough = useESStore((s) => s.stopWalkthrough);

  const btn = (on: boolean) =>
    `flex items-center justify-center rounded-md border p-1.5 ${
      on
        ? "border-zinc-800 bg-zinc-800 text-white"
        : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
    }`;

  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-l border-zinc-200 bg-white py-2">
      <button
        type="button"
        aria-label="Health"
        aria-pressed={healthOpen}
        className={btn(healthOpen)}
        onClick={toggleHealth}
        title="Model health"
      >
        <Activity size={16} />
      </button>
      <button
        type="button"
        aria-label="Revisions"
        aria-pressed={revisionsOpen}
        className={btn(revisionsOpen)}
        onClick={toggleRevisions}
        title="Revisions"
      >
        <History size={16} />
      </button>
      <button
        type="button"
        aria-label="Walk"
        aria-pressed={walkActive}
        className={btn(walkActive)}
        onClick={() => (walkActive ? stopWalkthrough() : startWalkthrough())}
        title="Walkthrough"
      >
        <Footprints size={16} />
      </button>
    </aside>
  );
}
