import { FilePlus, FolderOpen, Upload, X } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { type ArtifactRef, listArtifacts } from "@/lib/api";
import { isDnsLabel, navigate, parseImport } from "@/lib/document";
import { fromModel } from "@/lib/dsl/serialize";
import { useESStore } from "@/lib/store/store";

/** Open an EventStorming artifact in the namespace, start a new model, or read one
 *  out of a file. Doubles as the empty state — with nothing open there is no board
 *  behind it, and closing is not offered. */
export function Picker({ namespace }: { namespace: string }) {
  const doc = useESStore((s) => s.doc);
  const newDocument = useESStore((s) => s.newDocument);
  const setModel = useESStore((s) => s.setModel);
  const closePicker = useESStore((s) => s.closePicker);
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]);
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void listArtifacts(namespace)
      .then((list) => alive && setArtifacts(list))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [namespace]);

  const create = () => {
    const trimmed = id.trim();
    if (!isDnsLabel(trimmed)) {
      setError("An id is a DNS label: lower-case letters, digits and dashes.");
      return;
    }
    setError(null);
    newDocument(namespace, trimmed);
    navigate(namespace, trimmed, "latest");
  };

  // The file lands on the board unsaved: nothing is written until Save publishes it
  // as a revision of whatever artifact is open.
  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const model = parseImport(await file.text());
      const target = doc?.id ?? file.name.replace(/\.(ya?ml|json)$/i, "").toLowerCase();
      if (!doc) {
        if (!isDnsLabel(target)) {
          setError(`"${target}" is not a usable id — name the model first, then import into it.`);
          return;
        }
        newDocument(namespace, target);
        navigate(namespace, target, "latest");
      }
      setModel(fromModel(model));
      useESStore.getState().markDirty();
      closePicker();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  };

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/20 p-4"
      data-testid="picker"
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">
            Event storming models
            <span className="ml-2 font-normal text-zinc-400">{namespace}</span>
          </h2>
          {doc && (
            <button
              type="button"
              aria-label="Close models"
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
              onClick={closePicker}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mb-3 flex gap-2">
          <input
            aria-label="New model id"
            placeholder="new-model-id"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            onClick={create}
          >
            <FilePlus size={14} /> New model
          </button>
        </div>

        {artifacts.length === 0 ? (
          <p className="mb-3 rounded-md bg-zinc-50 px-2 py-3 text-center text-xs text-zinc-500">
            No models in this namespace yet. Name one, or import a file.
          </p>
        ) : (
          <ul className="mb-3 max-h-64 overflow-y-auto" data-testid="artifact-list">
            {artifacts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  aria-label={`Open ${a.id}`}
                  className={item}
                  onClick={() => navigate(a.namespace, a.id, "latest")}
                >
                  <FolderOpen size={14} />
                  <span className="truncate">{a.id}</span>
                  <span className="ml-auto shrink-0 pl-2 text-[11px] font-normal text-zinc-400">
                    r{a.revision}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className={item} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Import a model file…
        </button>

        {error && (
          <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-600" role="alert">
            {error}
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml,.json,application/json"
          className="hidden"
          onChange={(e) => void importFile(e)}
        />
      </div>
    </div>
  );
}
