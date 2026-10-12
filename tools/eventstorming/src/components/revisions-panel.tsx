import { History, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getHistory } from "@/lib/api";
import { navigate } from "@/lib/document";
import { useESStore } from "@/lib/store/store";

/** The open artifact's revisions (05-revisioned-kind.md). A revision is immutable:
 *  opening an older one reads it, and saving from there publishes a new newest one
 *  with it as the base. */
export function RevisionsPanel() {
  const doc = useESStore((s) => s.doc);
  const toggleRevisions = useESStore((s) => s.toggleRevisions);
  const [revisions, setRevisions] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const namespace = doc?.namespace;
  const id = doc?.id;
  const current = doc?.revision;
  useEffect(() => {
    if (!namespace || !id) return;
    let alive = true;
    void getHistory(namespace, id)
      .then((h) => alive && setRevisions([...h.revisions].sort((a, b) => b - a)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // `current` is in the deps so a save refreshes the list.
  }, [namespace, id, current]);

  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col border-l border-zinc-200 bg-white"
      data-testid="revisions-panel"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <span className="text-sm font-semibold text-zinc-800">Revisions</span>
        <button
          type="button"
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="Close revisions"
          onClick={toggleRevisions}
        >
          <X size={15} />
        </button>
      </div>

      {error && (
        <p className="m-3 rounded bg-red-50 px-2 py-1 text-[11px] text-red-600" role="alert">
          {error}
        </p>
      )}
      {revisions.length === 0 && !error ? (
        <p className="px-3 py-4 text-xs text-zinc-500">Not saved yet.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {revisions.map((n) => (
            <li key={n}>
              <button
                type="button"
                aria-label={`Open revision ${n}`}
                aria-current={n === current}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 ${
                  n === current ? "font-semibold text-zinc-900" : "text-zinc-700"
                }`}
                onClick={() => doc && navigate(doc.namespace, doc.id, n)}
              >
                <History size={13} className="shrink-0 text-zinc-400" />r{n}
                {n === revisions[0] && (
                  <span className="ml-auto text-[11px] font-normal text-zinc-400">latest</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
