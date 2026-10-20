// A human gate answered in the panel (37-progress.md): the Reading as documents, findings, Approve or Reject.
import { ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { DocView } from "./doc";
import { type Finding, message, type Schema, verdict } from "./lib/document";

export function Review({ namespace, taskRun, onAnswered }: { namespace: string; taskRun: string; onAnswered: (passed: boolean) => void }) {
  const [form, setForm] = useState<api.Form | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [general, setGeneral] = useState("");
  const [sending, setSending] = useState(false);
  const [schemas, setSchemas] = useState<Record<number, Schema | undefined>>({});

  useEffect(() => {
    api.form(namespace, taskRun).then(setForm, (e) => setError((e as Error).message));
  }, [namespace, taskRun]);
  useEffect(() => {
    form?.reading?.forEach((r, i) => r.ref && void api.schemaOf(r.ref).then((s) => setSchemas((m) => ({ ...m, [i]: s }))));
  }, [form]);

  const evidence = useMemo(() => (form?.reading ?? []).filter((r) => r.ref && !r.error).map((r) => r.ref!), [form]); // only what was shown
  const all = general.trim() ? [...findings, { anchor: "", text: general.trim() }] : findings;

  async function send(passed: boolean) {
    if (!form) return;
    setSending(true);
    setError(undefined);
    try {
      const value = verdict(passed, all, evidence);
      await api.answer(namespace, taskRun, Object.fromEntries(Object.keys(form.outputs).map((port) => [port, { kind: "value", value }])));
      onAnswered(passed);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  if (!form) return <p className="p-6 text-ink-2">{error ?? "Loading the review…"}</p>;
  const noting = form.verdict ? { findings, add: (f: Finding) => setFindings((fs) => [...fs, f]) } : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-7 pt-5 pb-10">
        <Instructions text={form.instructions} />
        {Object.entries(form.inputs ?? {})
          .filter(([, v]) => v.kind === "value" && isVerdict(v.value))
          .map(([port, v]) => (
            <Prior key={port} port={port} verdict={v.value as api.Verdict} />
          ))}
        {noting && <p className="mt-5 text-[13px] text-ink-3">Select any passage to add a finding on it, or use the button beside a heading.</p>}
        {(form.reading ?? []).map((r, i) => (
          <article key={i} className="mt-8 border-t border-line pt-6">
            <p className="mb-4 text-[13px] text-ink-3">
              {r.kind}
              {r.ref && (
                <>
                  {" "}
                  <span className="font-medium text-ink-2">{r.ref.id}</span>, revision {r.ref.revision}
                </>
              )}
              {r.ref?.kind === "EventStorming" && (
                <a className="ml-3 font-medium text-run hover:underline" href={`/tools/eventstorming/?${new URLSearchParams({ ns: namespace, id: r.ref.id, rev: String(r.ref.revision) })}`} target="_blank" rel="noreferrer">
                  Open the board
                </a>
              )}
            </p>
            {r.error ? <p className="text-bad">Could not read it: {r.error}</p> : <DocView content={r.content} schema={schemas[i]} base={r.ref?.id ?? r.name ?? r.kind} noting={noting} />}
          </article>
        ))}
      </div>
      {form.verdict ? (
        <footer className="sticky bottom-0 z-30 border-t border-line bg-surface/95 px-7 py-4 backdrop-blur">
          {findings.length > 0 && (
            <ol className="mb-3 max-h-40 space-y-1.5 overflow-y-auto">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[14px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-persimmon" aria-hidden />
                  <span className="min-w-0 flex-1 text-ink">{message(f)}</span>
                  <button type="button" onClick={() => setFindings((fs) => fs.filter((_, j) => j !== i))} className="rounded p-0.5 text-ink-3 hover:bg-line-2 hover:text-ink" aria-label="Remove this finding">
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-2.5">
            <input
              value={general}
              onChange={(e) => setGeneral(e.target.value)}
              placeholder="A finding about the whole document (optional)"
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[14px] focus:border-ink-3 focus:outline-none"
              aria-label="Finding about the whole document"
            />
            <button
              type="button"
              disabled={sending || all.length === 0}
              onClick={() => void send(false)}
              title={all.length === 0 ? "Add a finding first: say what must change" : undefined}
              className="rounded-lg border border-bad/50 px-4 py-2 text-[14px] font-semibold text-bad hover:bg-bad-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              Request changes{all.length ? ` (${all.length})` : ""}
            </button>
            <button type="button" disabled={sending} onClick={() => void send(true)} className="rounded-lg bg-done px-5 py-2 text-[14px] font-semibold text-white hover:brightness-95 disabled:opacity-40">
              Approve
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[14px] text-bad" role="alert">
              {error}
            </p>
          )}
        </footer>
      ) : (
        <footer className="border-t border-line bg-surface px-7 py-4 text-[14px] text-ink-2">
          This step needs more than approve or request changes. Stop <code>persimmon ui</code>, then run <code>persimmon complete {taskRun}</code>.
        </footer>
      )}
    </div>
  );
}

const isVerdict = (v: unknown) => !!v && typeof v === "object" && "passed" in v && "findings" in v;

function Instructions({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ")); // a pack's YAML block wraps its lines
  return (
    <div className="rounded-xl bg-line-2/70 px-4 py-3 text-[14px] leading-relaxed text-ink-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left font-semibold text-ink" aria-expanded={open}>
        What to judge
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className={open ? "mt-2 space-y-2" : "mt-1 line-clamp-2"}>
        {paras.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  );
}

/** The auditor's verdict on this draft, read before the human (23-pack-sdlc.md). */
function Prior({ port, verdict: v }: { port: string; verdict: api.Verdict }) {
  const findings = v.findings ?? [];
  return (
    <div className="mt-3 rounded-xl border border-line px-4 py-3 text-[14px]">
      <p className="font-semibold text-ink">
        {port === "audit" ? "The auditor" : port} {v.passed ? "passed this draft" : "refused this draft"}
        {findings.length ? `, with ${findings.length} doubt${findings.length > 1 ? "s" : ""} for you to judge` : ""}
      </p>
      {findings.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-ink-2">
          {findings.map((f, i) => (
            <li key={i}>{f.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
