// One phase opened beside the map (37-progress.md): its runs round by round, an artifact as a document, the review waiting on you.
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { DocView } from "./doc";
import { type RevisionRef, type Schema, words } from "./lib/document";
import { type PhaseView, roundOf, sliceOf, type State } from "./lib/flow";
import { Glyph } from "./map";
import { Review } from "./review";

type Mode = { t: "rounds" } | { t: "review"; taskRun: string; task: string } | { t: "artifact"; ref: RevisionRef };

export function Panel({ view, onClose, onAnswered }: { view: PhaseView; onClose: () => void; onAnswered: () => void }) {
  const [runIndex, setRunIndex] = useState(0);
  const run = view.runs[runIndex];
  const parked = run?.parked.find((p) => p.verdict) ?? run?.parked[0];
  // a phase waiting on you opens on the review: that is why you clicked it
  const [mode, setMode] = useState<Mode>(parked ? { t: "review", taskRun: parked.taskRun, task: parked.task } : { t: "rounds" });
  const [notice, setNotice] = useState<string | undefined>();

  return (
    <aside className="flex w-[min(760px,58vw)] shrink-0 flex-col border-l border-line bg-surface shadow-[-12px_0_32px_-24px_rgba(27,35,51,0.35)]" aria-label={`${view.phase.title} phase`}>
      <header className="flex items-start gap-3 border-b border-line px-7 pt-5 pb-4">
        <Glyph state={view.state} size={30} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[21px] leading-tight font-semibold">{view.phase.title}</h2>
          <p className={`text-[14px] ${view.state === "needs-you" ? "font-medium text-persimmon" : "text-ink-2"}`}>{view.detail}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-line-2 hover:text-ink" aria-label="Close">
          <X className="size-5" aria-hidden />
        </button>
      </header>
      {notice && (
        <p className="border-b border-done/20 bg-done-soft px-7 py-2.5 text-[14px] text-done" role="status">
          {notice}
        </p>
      )}
      {mode.t !== "rounds" && (
        <button type="button" onClick={() => setMode({ t: "rounds" })} className="flex items-center gap-1.5 px-7 pt-4 pb-1 text-[14px] font-medium text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> All rounds
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!run ? (
          <p className="px-7 py-6 text-ink-2">Nothing has run here yet. It starts once the phases before it are approved and you run its workflow.</p>
        ) : mode.t === "review" ? (
          <Review
            namespace={run.namespace}
            taskRun={mode.taskRun}
            task={mode.task}
            onAnswered={(passed) => {
              setNotice(passed ? "Approved. The run continues." : "Changes requested. The next round starts with your findings.");
              setMode({ t: "rounds" });
              onAnswered();
            }}
          />
        ) : mode.t === "artifact" ? (
          <Artifact ref_={mode.ref} namespace={run.namespace} />
        ) : (
          <div className="px-7 py-5">
            {view.runs.length > 1 && (
              <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Runs">
                {view.runs.map((r, i) => (
                  <button key={r.name} role="tab" aria-selected={i === runIndex} onClick={() => setRunIndex(i)} className={`rounded-full px-3 py-1 text-[13px] ${i === runIndex ? "bg-ink text-white" : "bg-line-2 text-ink-2 hover:text-ink"}`}>
                    {sliceOf(r) ? `${sliceOf(r)}, ` : ""}
                    {new Date(r.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            )}
            <Rounds namespace={run.namespace} name={run.name} round={roundOf(run)} onReview={(taskRun, task) => setMode({ t: "review", taskRun, task })} onArtifact={(ref) => setMode({ t: "artifact", ref })} />
          </div>
        )}
      </div>
    </aside>
  );
}

function Artifact({ ref_, namespace }: { ref_: RevisionRef; namespace: string }) {
  const [content, setContent] = useState<unknown>();
  const [schema, setSchema] = useState<Schema | undefined>();
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    api.revision(ref_, namespace).then(setContent, (e) => setError((e as Error).message));
    void api.schemaOf(ref_).then(setSchema);
  }, [ref_, namespace]);
  return (
    <article className="px-7 pt-4 pb-10">
      <p className="mb-4 text-[13px] text-ink-3">
        {ref_.kind} <span className="font-medium text-ink-2">{ref_.id}</span>, revision {ref_.revision}
      </p>
      {error ? <p className="text-bad">{error}</p> : content === undefined ? <p className="text-ink-2">Loading…</p> : <DocView content={content} schema={schema} base={ref_.id} kind={ref_.kind} />}
    </article>
  );
}

function Rounds({ namespace, name, round, onReview, onArtifact }: { namespace: string; name: string; round?: number; onReview: (taskRun: string, task: string) => void; onArtifact: (ref: RevisionRef) => void }) {
  const [root, setRoot] = useState<api.Node | undefined>();
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(() => api.tree(namespace, name).then(setRoot, (e) => setError((e as Error).message)), [namespace, name]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load, round]);
  if (!root) return <p className="text-ink-2">{error ?? "Loading…"}</p>;
  const rounds = root.children.filter((c) => /^rounds-\d+$/.test(c.label));
  const act = { onReview, onArtifact };
  if (rounds.length === 0)
    return (
      <ol className="space-y-1">
        {root.children.map((c) => (
          <Step key={c.name} node={c} {...act} />
        ))}
        {root.error && <ErrorLine error={root.error} />}
      </ol>
    );
  return (
    <ol className="space-y-3">
      {[...rounds].reverse().map((r, i) => (
        <li key={r.name}>
          <details open={i === 0} className="group rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <ChevronRight className="size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
              <Glyph state={stateOf(r)} size={20} />
              <span className="font-semibold">Round {r.label.slice("rounds-".length)}</span>
              <span className="text-[14px] text-ink-2">{roundSummary(r)}</span>
            </summary>
            <ol className="space-y-1 border-t border-line-2 px-4 py-3">
              {r.children.map((c) => (
                <Step key={c.name} node={c} {...act} />
              ))}
              {r.error && <ErrorLine error={r.error} />}
            </ol>
          </details>
        </li>
      ))}
    </ol>
  );
}

/** One run in a round, in words: a draft and what it made, a review and each check's verdict, a step waiting on you. */
function Step({ node, onReview, onArtifact, depth = 0 }: { node: api.Node; onReview: (taskRun: string, task: string) => void; onArtifact: (ref: RevisionRef) => void; depth?: number }) {
  const parkedTask = node.kind === "TaskRun" ? (node.parked ? node : undefined) : node.children.find((c) => c.kind === "TaskRun" && c.parked);
  const artifacts = Object.values(node.outputs ?? {}).flatMap((o) => (o.kind === "artifact" && o.ref ? [o.ref] : o.kind === "artifacts" ? (o.refs ?? []) : []));
  const v = verdictOf(node);
  // a check's own TaskRun (the auditor, the human) reads as the check itself
  const kids = node.kind === "ValidationRun" ? [] : node.children;
  return (
    <li style={{ paddingLeft: depth * 18 }}>
      <div className="flex items-center gap-3 py-1.5">
        <Glyph state={parkedTask ? "needs-you" : stateOf(node)} size={18} />
        <span className="font-medium">{nameOf(node)}</span>
        <span className="text-[14px] text-ink-2">{parkedTask ? (parkedTask.verdict ? "waiting for your review" : "waiting for your input") : describe(node, v)}</span>
        {parkedTask && (
          <button type="button" onClick={() => onReview(parkedTask.name, parkedTask.task ?? "")} className="ml-auto rounded-lg bg-persimmon px-3.5 py-1.5 text-[14px] font-semibold text-white hover:brightness-95">
            {parkedTask.verdict ? "Review" : "Open"}
          </button>
        )}
      </div>
      {artifacts.length > 0 && (
        <div className="mb-1.5 ml-[30px] flex flex-wrap gap-1.5">
          {artifacts.map((a) => (
            <button key={`${a.kind}/${a.id}/${a.revision}`} type="button" onClick={() => onArtifact(a)} className="rounded-md border border-line px-2.5 py-1 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
              {a.kind} <span className="font-semibold text-ink">{a.id}</span> r{a.revision}
            </button>
          ))}
        </div>
      )}
      {v && (v.findings ?? []).length > 0 && (
        <ul className="mb-1.5 ml-[30px] space-y-1 text-[14px]">
          {v.findings!.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${f.severity === "error" ? "bg-bad" : f.severity === "warning" ? "bg-[#c08a1e]" : "bg-ink-3"}`} aria-label={f.severity} />
              <span className="text-ink-2">{f.message}</span>
            </li>
          ))}
        </ul>
      )}
      {node.error && <ErrorLine error={node.error} />}
      {kids.length > 0 && (
        <ol>
          {kids.map((c) => (
            <Step key={c.name} node={c} onReview={onReview} onArtifact={onArtifact} depth={depth + 1} />
          ))}
        </ol>
      )}
    </li>
  );
}

function ErrorLine({ error }: { error: { code: string; message: string } }) {
  return (
    <p className="ml-[30px] text-[14px] text-bad">
      {error.code}: {error.message}
    </p>
  );
}

const verdictOf = (n: api.Node): api.Verdict | undefined => (n.kind === "ValidationRun" ? n.result : n.kind === "GateRun" ? (n.outputs?.result?.value as api.Verdict | undefined) : undefined);

function stateOf(n: api.Node): State {
  if (n.phase === "Failed" || n.phase === "Cancelled") return "failed";
  if (n.phase !== "Succeeded") return n.phase === "Pending" ? "idle" : "running";
  const v = verdictOf(n) ?? (n.kind === "WorkflowRun" ? ({ passed: n.outputs?.passed?.value !== false } as api.Verdict) : undefined);
  return v && !v.passed ? "rejected" : "done";
}

const nameOf = (n: api.Node) => (n.kind === "TaskRun" ? words(n.task ?? n.label) : n.kind === "GateRun" ? "Review" : words(n.label));

function describe(n: api.Node, v: api.Verdict | undefined): string {
  if (n.phase === "Waiting") return n.waitingReason === "human" ? "waiting on a reviewer" : `waiting (${n.waitingReason ?? "?"})`;
  if (n.phase !== "Succeeded") return n.phase === "Pending" ? "not started" : n.phase === "Running" ? "running" : n.phase.toLowerCase();
  if (!v) return "done";
  const counts = (s: string) => (v.findings ?? []).filter((f) => f.severity === s).length;
  const extra = [counts("error") && `${counts("error")} blocking`, counts("warning") && `${counts("warning")} warning${counts("warning") > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  return `${v.passed ? "passed" : "refused"}${extra ? `, ${extra}` : ""}`;
}

const hasParked = (n: api.Node): boolean => !!n.parked || n.children.some(hasParked);
const hasReview = (n: api.Node): boolean => (!!n.parked && !!n.verdict) || n.children.some(hasReview);

function roundSummary(r: api.Node): string {
  const gate = r.children.find((c) => c.kind === "GateRun");
  if (hasParked(r)) return hasReview(r) ? "waiting for your review" : "waiting for your input";
  if (r.phase !== "Succeeded") return gate ? "in review" : "drafting";
  const v = gate && verdictOf(gate);
  return v ? (v.passed ? "approved" : "changes requested") : "done";
}
