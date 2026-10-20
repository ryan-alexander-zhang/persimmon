// The Inbox (37-inbox.md): the TaskRuns parked on you, the Reading of one rendered as a page, findings on its items, the verdict.
import { Check, ExternalLink, Inbox as InboxIcon, MessageSquarePlus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Finding, type Item, type RevisionRef, type Schema, toItem, verdict } from "./lib/content";

interface Parked {
  namespace: string;
  taskRun: string;
  task: string;
  deadline?: string;
  form: boolean;
  verdict: boolean;
}

interface ReadingEntry {
  kind: string;
  name?: string;
  ref?: RevisionRef;
  content?: unknown;
  error?: string;
}

interface Form {
  instructions: string;
  reading?: ReadingEntry[];
  inputs?: Record<string, { kind: string; value?: unknown }>;
  outputs: Record<string, unknown>;
  verdict: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `${res.status} ${res.statusText}`);
  return body as T;
}

/** Content schemas by `apiVersion/kind`, fetched once: field descriptions only, so a miss renders without them. */
const schemas = new Map<string, Promise<Schema | undefined>>();
let kindNames: Promise<{ name: string; apiVersion: string; kind: string }[]> | undefined;
function schemaOf(ref: RevisionRef): Promise<Schema | undefined> {
  const key = `${ref.apiVersion}/${ref.kind}`;
  if (!schemas.has(key)) {
    kindNames ??= call("/api/kinds");
    schemas.set(
      key,
      kindNames
        .then((ks) => ks.find((k) => k.apiVersion === ref.apiVersion && k.kind === ref.kind))
        .then((k) => (k ? call<{ schema: Schema }>(`/api/kinds/${k.name}`).then((r) => r.schema) : undefined))
        .catch(() => undefined),
    );
  }
  return schemas.get(key)!;
}

const until = (deadline?: string) => {
  if (!deadline) return "";
  const h = Math.round((Date.parse(deadline) - Date.now()) / 3_600_000);
  return h >= 0 ? `due in ${h}h` : `overdue ${-h}h`;
};

export function Inbox() {
  const [directory, setDirectory] = useState("");
  const [parked, setParked] = useState<Parked[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>(() => decodeURIComponent(location.hash.slice(1)) || undefined); // `#<ns>/<taskRun>` survives a reload
  const [listError, setListError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      const r = await call<{ directory: string; parked: Parked[] }>("/api/inbox");
      setDirectory(r.directory);
      setParked(r.parked);
      setListError(undefined);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // the next gate a drain parks shows up without a reload
    return () => clearInterval(t);
  }, [refresh]);

  // open the first parked TaskRun when nothing is open, or the open one was answered
  useEffect(() => {
    if (!parked) return;
    if (!selected || !parked.some((p) => key(p) === selected)) setSelected(parked[0] ? key(parked[0]) : undefined);
  }, [parked, selected]);

  useEffect(() => {
    if (selected) history.replaceState(null, "", `#${selected}`);
  }, [selected]);

  const current = parked?.find((p) => key(p) === selected);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <InboxIcon className="size-5 text-orange-600" aria-hidden />
        <h1 className="font-semibold">Inbox</h1>
        <span className="truncate font-mono text-xs text-stone-500" title="project directory">
          {directory}
        </span>
        <button className="ml-auto rounded p-1 text-stone-500 hover:bg-stone-100" onClick={() => void refresh()} title="Refresh">
          <RefreshCw className="size-4" aria-hidden />
          <span className="sr-only">Refresh</span>
        </button>
      </header>
      {notice && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-sm text-emerald-900" role="status">
          {notice}
          <button className="ml-auto" onClick={() => setNotice(undefined)} aria-label="Dismiss">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="w-72 shrink-0 overflow-y-auto border-r border-stone-200 bg-white" aria-label="Parked tasks">
          {listError && <p className="p-4 text-sm text-rose-700">{listError}</p>}
          {parked?.length === 0 && (
            <p className="p-4 text-sm text-stone-500">
              Nothing waits on you. A run that parks on a human shows up here.
            </p>
          )}
          <ul>
            {parked?.map((p) => (
              <li key={key(p)}>
                <button
                  className={`w-full border-l-4 px-4 py-3 text-left hover:bg-stone-50 ${key(p) === selected ? "border-orange-500 bg-orange-50/60" : "border-transparent"}`}
                  onClick={() => setSelected(key(p))}
                  aria-current={key(p) === selected}
                >
                  <div className="font-medium">{p.task}</div>
                  <div className="truncate font-mono text-xs text-stone-500">{p.taskRun}</div>
                  <div className="mt-1 flex gap-2 text-xs text-stone-500">
                    <span>{p.namespace}</span>
                    <span>{until(p.deadline)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {current ? (
            <Review
              key={key(current)}
              parked={current}
              onAnswered={(passed) => {
                setNotice(`${passed ? "Approved" : "Rejected"} ${current.task}. The run continues in persimmon ui.`);
                void refresh();
              }}
            />
          ) : (
            parked && parked.length > 0 && <p className="p-8 text-stone-500">Pick a task.</p>
          )}
        </main>
      </div>
    </div>
  );
}

const key = (p: Parked) => `${p.namespace}/${p.taskRun}`;

function Review({ parked, onAnswered }: { parked: Parked; onAnswered: (passed: boolean) => void }) {
  const [form, setForm] = useState<Form | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [editing, setEditing] = useState<string | undefined>(); // `<entry>:<pointer>`
  const [general, setGeneral] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!parked.form) return;
    call<Form>(`/api/inbox/${parked.namespace}/${parked.taskRun}`).then(setForm, (e) => setError((e as Error).message));
  }, [parked]);

  const evidence = useMemo(() => (form?.reading ?? []).filter((r) => r.ref && !r.error).map((r) => r.ref!), [form]); // only what was shown

  async function send(passed: boolean) {
    if (!form) return;
    const all = general.trim() ? [...findings, { anchor: "", text: general.trim() }] : findings;
    const value = verdict(passed, all, evidence);
    setSending(true);
    setError(undefined);
    try {
      await call(`/api/inbox/${parked.namespace}/${parked.taskRun}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outputs: Object.fromEntries(Object.keys(form.outputs).map((port) => [port, { kind: "value", value }])) }),
      });
      onAnswered(passed);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  if (!parked.form) return <p className="p-8 text-stone-600">No inbox form for {parked.taskRun}. Answer it with <code className="font-mono">persimmon complete {parked.taskRun} --file</code>.</p>;
  if (!form) return <p className="p-8 text-stone-500">{error ?? "Loading…"}</p>;

  const count = findings.length + (general.trim() ? 1 : 0);
  const notes = {
    findings,
    editing,
    setEditing,
    add: (f: Finding) => setFindings((fs) => [...fs, f]),
    remove: (i: number) => setFindings((fs) => fs.filter((_, j) => j !== i)),
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
        <h2 className="text-xl font-semibold">{parked.task}</h2>
        <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-700">
          {form.instructions
            .split(/\n\s*\n/)
            .map((p, i) => (
              <p key={i}>{p.replace(/\s*\n\s*/g, " ")}</p> // a pack's YAML block wraps its lines; a blank line is a paragraph
            ))}
        </div>
        {Object.entries(form.inputs ?? {})
          .filter(([, v]) => v.kind === "value")
          .map(([port, v]) => (
            <section key={port} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <h3 className="mb-2 font-medium text-amber-900">Input {port}</h3>
              <ItemView item={toItem(v.value, undefined, {}, port)} entry={-1} notes={undefined} />
            </section>
          ))}
        {(form.reading ?? []).map((r, i) => (
          <ReadingSection key={i} entry={i} reading={r} namespace={parked.namespace} notes={form.verdict ? notes : undefined} />
        ))}
      </div>
      {form.verdict ? (
        <footer className="sticky bottom-0 z-20 border-t border-stone-200 bg-white/95 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {findings.length > 0 && (
              <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-center gap-1 rounded-full bg-orange-100 py-0.5 pr-1 pl-2.5 text-xs text-orange-950">
                    <span className="font-mono">{f.anchor}</span>
                    <span className="max-w-64 truncate">{f.text}</span>
                    <button onClick={() => notes.remove(i)} aria-label={`Remove finding on ${f.anchor}`} className="rounded-full p-0.5 hover:bg-orange-200">
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <input
                value={general}
                onChange={(e) => setGeneral(e.target.value)}
                placeholder="A finding no item holds (optional)"
                className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                aria-label="General finding"
              />
              <button
                disabled={sending || count === 0}
                onClick={() => void send(false)}
                title={count === 0 ? "Hover an item and click it to note what must change" : undefined}
                className="flex items-center gap-1.5 rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="size-4" aria-hidden /> Reject{count ? ` (${count})` : ""}
              </button>
              <button
                disabled={sending}
                onClick={() => void send(true)}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Check className="size-4" aria-hidden /> Approve
              </button>
            </div>
            {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          </div>
        </footer>
      ) : (
        <footer className="border-t border-stone-200 bg-white px-6 py-3 text-sm text-stone-600">
          This task answers more than approve or reject. Stop <code className="font-mono">persimmon ui</code>, then run <code className="font-mono">persimmon complete {parked.taskRun}</code>.
        </footer>
      )}
    </div>
  );
}

interface Notes {
  findings: Finding[];
  editing: string | undefined;
  setEditing: (k: string | undefined) => void;
  add: (f: Finding) => void;
  remove: (i: number) => void;
}

function ReadingSection({ entry, reading, namespace, notes }: { entry: number; reading: ReadingEntry; namespace: string; notes: Notes | undefined }) {
  const [schema, setSchema] = useState<Schema | undefined>();
  useEffect(() => {
    if (reading.ref) void schemaOf(reading.ref).then(setSchema);
  }, [reading.ref]);
  const title = reading.ref ? `${reading.kind} · ${reading.ref.id} · r${reading.ref.revision}` : `${reading.kind}${reading.name ? ` · ${reading.name}` : ""}`;
  const item = useMemo(() => (reading.error ? undefined : toItem(reading.content, schema, schema ?? {}, reading.ref?.id ?? reading.name ?? reading.kind)), [reading, schema]);
  return (
    <section className="mt-8">
      <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 py-2 text-sm font-semibold text-stone-600 backdrop-blur">
        {title}
        {reading.ref?.kind === "EventStorming" && (
          <a
            className="ml-auto flex items-center gap-1 text-xs font-medium text-orange-700 hover:underline"
            href={`/tools/eventstorming/?${new URLSearchParams({ ns: namespace, id: reading.ref.id, rev: String(reading.ref.revision) })}`}
            target="_blank"
            rel="noreferrer"
          >
            Open the board <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </h3>
      {reading.error ? <p className="mt-2 text-sm text-rose-700">Unavailable: {reading.error}</p> : <div className="mt-3">{item && <ItemView item={item} entry={entry} notes={notes} root />}</div>}
    </section>
  );
}

/** One item; with `notes`, hovering outlines it and a click notes a finding on it. */
function ItemView({ item, entry, notes, root }: { item: Item; entry: number; notes: Notes | undefined; root?: boolean }) {
  const k = `${entry}:${item.pointer}`;
  const mine = notes?.findings.map((f, i) => [f, i] as const).filter(([f]) => f.anchor === item.anchor) ?? [];
  // the content's title, a card's or an object's title, or a field's label
  const style = root ? "text-lg font-semibold text-stone-900" : item.shape === "fields" ? "text-sm font-semibold text-stone-900" : "text-xs font-semibold tracking-wide text-stone-500 uppercase";
  const label = item.label && (
    <div className={`${item.shape === "text" || item.shape === "empty" ? "" : "mb-1"} ${style}`} title={item.description}>
      {item.label}
      {item.description && <span className="ml-1 cursor-help font-normal text-stone-400">ⓘ</span>}
    </div>
  );
  const body = (() => {
    switch (item.shape) {
      case "empty":
        return <span className="text-sm text-stone-400 italic">none</span>;
      case "text":
        return <p className="text-sm leading-relaxed whitespace-pre-wrap text-stone-800">{item.text}</p>;
      case "bullets":
        return (
          <ul className="list-disc space-y-1 pl-5">
            {item.children!.map((c) => (
              <li key={c.pointer}>
                <ItemView item={c} entry={entry} notes={notes} />
              </li>
            ))}
          </ul>
        );
      case "cards":
        return (
          <div className="space-y-2">
            {item.children!.map((c) => (
              <div key={c.pointer} className="rounded-lg border border-stone-200 bg-white p-3 shadow-xs">
                <ItemView item={c} entry={entry} notes={notes} />
              </div>
            ))}
          </div>
        );
      case "fields":
        return (
          <div className="space-y-3">
            {item.children!.map((c) => (
              <ItemView key={c.pointer} item={c} entry={entry} notes={notes} />
            ))}
          </div>
        );
    }
  })();
  const row = item.label && (item.shape === "text" || item.shape === "empty") && !root; // a labelled value: label and value side by side
  const noted = (
    <>
      {mine.map(([f, i]) => (
        <div key={i} className="my-2 flex items-start gap-2 rounded-md bg-orange-50 px-2 py-1 text-sm text-orange-950">
          <MessageSquarePlus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="flex-1 whitespace-pre-wrap">{f.text}</span>
          <button onClick={() => notes!.remove(i)} aria-label="Remove finding" className="rounded p-0.5 hover:bg-orange-100">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
      {notes && notes.editing === k && <NoteEditor anchor={item.anchor} onKeep={(text) => (notes.add({ anchor: item.anchor, text }), notes.setEditing(undefined))} onDrop={() => notes.setEditing(undefined)} />}
    </>
  );
  // a value's findings follow it; a card's or a list's sit under its title, next to the button that made them
  return (
    <div className={`${notes ? "item" : ""} relative pr-8`}>
      {row ? (
        <>
          <div className="grid grid-cols-[10rem_1fr] items-baseline gap-3">
            {label}
            {body}
          </div>
          {noted}
        </>
      ) : label ? (
        <>
          {label}
          {noted}
          {body}
        </>
      ) : (
        <>
          {body}
          {noted}
        </>
      )}
      {notes && (
        <button
          className="note-button absolute top-0 right-0 rounded-md p-1 text-orange-600 hover:bg-orange-100"
          onClick={(e) => {
            e.stopPropagation();
            notes.setEditing(k);
          }}
          title={`Note a finding on ${item.anchor}`}
          aria-label={`Note a finding on ${item.anchor}`}
        >
          <MessageSquarePlus className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

function NoteEditor({ anchor, onKeep, onDrop }: { anchor: string; onKeep: (text: string) => void; onDrop: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="my-2 scroll-mb-40 rounded-md border border-orange-300 bg-white p-2 shadow-sm">
      <div className="mb-1 font-mono text-xs text-orange-700">{anchor}</div>
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) onKeep(text.trim());
          }
          if (e.key === "Escape") onDrop();
        }}
        placeholder="What must change? Enter keeps it, Shift+Enter a new line, Esc drops it."
        className="w-full resize-y scroll-mb-40 text-sm focus:outline-none"
        aria-label={`Finding on ${anchor}`}
      />
    </div>
  );
}
