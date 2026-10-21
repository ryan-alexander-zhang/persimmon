// A human gate answered in the panel (37-progress.md): the Reading as documents, findings, Approve or Reject.
import { ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { DocView } from "./doc";
import { countChanges, diffDoc } from "./lib/diff";
import { type Finding, message, type Schema, toDoc, verdict, words } from "./lib/document";
import { decisionTasks } from "./lib/flow";

export function Review({ namespace, taskRun, task, onAnswered }: { namespace: string; taskRun: string; task: string; onAnswered: (passed: boolean) => void }) {
  const [form, setForm] = useState<api.Form | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [general, setGeneral] = useState("");
  const [sending, setSending] = useState(false);
  const [schemas, setSchemas] = useState<Record<number, Schema | undefined>>({});
  // the revision each document had in the round before: what this round changed is the reviewer's first question
  const [prevs, setPrevs] = useState<Record<number, { revision: number; content: unknown } | undefined>>({});
  const [hidden, setHidden] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.form(namespace, taskRun).then(setForm, (e) => setError((e as Error).message));
  }, [namespace, taskRun]);
  useEffect(() => {
    form?.reading?.forEach((r, i) => r.ref && void api.schemaOf(r.ref).then((s) => setSchemas((m) => ({ ...m, [i]: s }))));
    form?.reading?.forEach((r, i) => r.ref && r.ref.revision > 1 && void api.previous(r.ref, namespace).then((p) => setPrevs((m) => ({ ...m, [i]: p })), () => undefined));
  }, [form, namespace]);

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
        {!form.verdict && (decisionTasks.includes(task) ? <DecisionsWanted taskRun={taskRun} outputs={form.outputs} /> : <WorkWanted taskRun={taskRun} outputs={form.outputs} />)}
        <Instructions text={form.instructions} title={form.verdict ? "What to judge" : "What this step asks"} />
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
              {prevs[i] && <ChangesSwitch on={!hidden[i]} onChange={(on) => setHidden((h) => ({ ...h, [i]: !on }))} since={prevs[i]!.revision} count={countOf(prevs[i]!.content, r.content, schemas[i], r.ref!.id, r.ref!.kind)} />}
              {r.ref?.kind === "EventStorming" && (
                <a className="ml-3 font-medium text-run hover:underline" href={`/tools/eventstorming/?${new URLSearchParams({ ns: namespace, id: r.ref.id, rev: String(r.ref.revision) })}`} target="_blank" rel="noreferrer">
                  Open the board
                </a>
              )}
            </p>
            {r.error ? <p className="text-bad">Could not read it: {r.error}</p> : <DocView content={r.content} schema={schemas[i]} base={r.ref?.id ?? r.name ?? r.kind} kind={r.ref?.kind} noting={noting} {...(prevs[i] && !hidden[i] ? { prev: prevs[i]!.content } : {})} />}
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
      ) : null}
    </div>
  );
}

export const countOf = (prev: unknown, next: unknown, schema: Schema | undefined, base: string, kind: string) => {
  const d = diffDoc(toDoc(prev, schema, base, kind), toDoc(next, schema, base, kind));
  return countChanges(d.blocks) + d.meta.filter((m) => m.change).length;
};

export function ChangesSwitch({ on, onChange, since, count }: { on: boolean; onChange: (on: boolean) => void; since: number; count: number }) {
  return (
    <label className="relative ml-3 inline-flex cursor-pointer items-center gap-2 align-middle text-[13px] text-ink-2">
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-[18px] w-8 rounded-full bg-line transition-colors peer-checked:bg-done peer-focus-visible:outline-2 peer-focus-visible:outline-run" aria-hidden>
        <span className={`absolute top-[2px] size-[14px] rounded-full bg-white transition-[left] ${on ? "left-[16px]" : "left-[2px]"}`} />
      </span>
      {count === 0 ? `No changes since revision ${since}` : `Show ${count} change${count > 1 ? "s" : ""} since revision ${since}`}
    </label>
  );
}

/** A parked step that is not a gate: it asks for work (a draft, code), which a click cannot give. */
function WorkWanted({ taskRun, outputs }: { taskRun: string; outputs: Record<string, unknown> }) {
  const wanted = Object.entries(outputs).map(([port, o]) => {
    const t = (o as { type?: { kind?: string; artifactKind?: { kind?: string } } }).type;
    return t?.artifactKind?.kind ? `${t.artifactKind.kind} (${port})` : port;
  });
  return (
    <div className="mb-4 rounded-xl border border-persimmon/40 bg-persimmon-soft px-4 py-3 text-[14px] leading-relaxed text-ink">
      <p className="font-semibold">This step asks you to write {wanted.join(" and ")}, not to approve.</p>
      <p className="mt-1 text-ink-2">
        There is nothing to approve here: the review comes after the draft. Write the answer as a file, stop <code>persimmon ui</code>, then run{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-[13px]">persimmon complete {taskRun} --file answer.yaml</code>. In the pack's own setup an agent writes this draft, and you only see the review.
      </p>
      <p className="mt-1 text-ink-2">Below is what the step reads.</p>
    </div>
  );
}

/** A Rewrite pack decision: the human's own, a typed value written as a file; the form's schema names its fields. */
function DecisionsWanted({ taskRun, outputs }: { taskRun: string; outputs: Record<string, unknown> }) {
  const ports = Object.entries(outputs).map(([port, o]) => ({ port, schema: (o as { type?: { schema?: Schema } }).type?.schema }));
  return (
    <div className="mb-4 rounded-xl border border-persimmon/40 bg-persimmon-soft px-4 py-3 text-[14px] leading-relaxed text-ink">
      <p className="font-semibold">This step asks for your decisions, not a click.</p>
      <p className="mt-1 text-ink-2">
        Read what is below, write the answer as a file, stop <code>persimmon ui</code>, then run{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-[13px]">persimmon complete {taskRun} --file answer.yaml</code> with{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-[13px]">{`{outputs: {${ports.map((p) => `${p.port}: {kind: value, value: ...}`).join(", ")}}}`}</code>.
      </p>
      {ports.map(({ port, schema }) => (
        <dl key={port} className="mt-2 space-y-1">
          {Object.entries((schema?.properties ?? {}) as Record<string, Schema>).map(([k, s]) => (
            <div key={k}>
              <dt className="inline font-semibold">{words(k)}</dt>
              {typeof s.description === "string" && <dd className="inline text-ink-2">: {s.description}</dd>}
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}

const isVerdict = (v: unknown) => !!v && typeof v === "object" && "passed" in v && "findings" in v;

function Instructions({ text, title }: { text: string; title: string }) {
  const [open, setOpen] = useState(false);
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ")); // a pack's YAML block wraps its lines
  return (
    <div className="rounded-xl bg-line-2/70 px-4 py-3 text-[14px] leading-relaxed text-ink-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left font-semibold text-ink" aria-expanded={open}>
        {title}
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
