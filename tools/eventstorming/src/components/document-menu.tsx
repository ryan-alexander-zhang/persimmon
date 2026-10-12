import { Download, FolderOpen, FolderPlus, Menu, Save, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { currentModel, exportFile, parseImport, save } from "@/lib/document";
import { fromModel } from "@/lib/dsl/serialize";
import { useESStore } from "@/lib/store/store";

/** Save, and the low-frequency document actions folded into one popover so the top
 *  bar stays lean. Save publishes the next revision; Export and Import move the same
 *  model through a Resource file. */
export function DocumentMenu() {
  const doc = useESStore((s) => s.doc);
  const contexts = useESStore((s) => s.contexts);
  const addContext = useESStore((s) => s.addContext);
  const setModel = useESStore((s) => s.setModel);
  const openPicker = useESStore((s) => s.openPicker);
  const setSaveError = useESStore((s) => s.setSaveError);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onSave = async () => {
    setSaving(true);
    try {
      await save();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The model was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const onExport = () => {
    const file = exportFile(doc?.id ?? "event-storming", doc?.revision ?? null, currentModel());
    const url = URL.createObjectURL(new Blob([file.yaml], { type: "application/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  // Read into the open artifact: the board changes, nothing is written until Save.
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setModel(fromModel(parseImport(await file.text())));
      useESStore.getState().markDirty();
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "That file could not be read.");
    }
    setOpen(false);
  };

  const onAddContext = () => {
    addContext(`Context ${contexts.length + 1}`);
    setOpen(false);
  };

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        disabled={saving || doc?.readOnly}
        title={doc?.readOnly ? "An older revision is read-only — edit it as a new revision" : undefined}
        onClick={() => void onSave()}
      >
        <Save size={14} /> {saving ? "Saving…" : "Save"}
      </button>

      <div className="relative">
        <button
          type="button"
          aria-label="File"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          onClick={() => setOpen((o) => !o)}
        >
          <Menu size={14} /> File
        </button>

        {open && (
          <div
            className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-zinc-200 bg-white p-1 shadow-lg"
            data-testid="file-menu"
          >
            <button
              type="button"
              className={item}
              onClick={() => {
                openPicker();
                setOpen(false);
              }}
            >
              <FolderOpen size={14} /> Models…
            </button>
            <button type="button" className={item} onClick={onAddContext}>
              <FolderPlus size={14} /> Add context
            </button>
            <button type="button" className={item} onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Import file…
            </button>
            <button type="button" className={item} onClick={onExport}>
              <Download size={14} /> Export
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml,.json,application/json"
          className="hidden"
          onChange={(e) => void onImport(e)}
        />
      </div>
    </div>
  );
}
