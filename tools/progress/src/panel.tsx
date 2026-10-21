// One phase opened beside the map (37-progress.md): its runs round by round, an artifact as a document, the review waiting on you.
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Place, View } from "./lib/route";
import * as api from "./api";
import { DocView, type Jump, Linked } from "./doc";
import { type RevisionRef, type Schema, words } from "./lib/document";
import { type PhaseView, roundOf, runView, type State } from "./lib/flow";
import { useMemo } from "react";
import { Glyph } from "./map";
import { ChangesSwitch, countOf, Review } from "./review";

export function Panel({ view, place, go, onClose, onAnswered }: { view: PhaseView; place: Place; go: (r: Place) => void; onClose: () => void; onAnswered: () => void }) {
  const run = view.runs.find((r) => r.name === place.run) ?? view.runs[0];
  const parked = run?.parked.find((p) => p.verdict) ?? run?.parked[0];
  // a phase waiting on you opens on the review: that is why you clicked it
  const mode: View = place.view ?? (parked ? { t: "review", taskRun: parked.taskRun } : { t: "rounds" });
  const at = (v: View): Place => ({ product: place.product, phase: place.phase, run: run?.name, view: v });
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
        <button type="button" onClick={() => go(at({ t: "rounds" }))} className="flex items-center gap-1.5 px-7 pt-4 pb-1 text-[14px] font-medium text-ink-2 hover:text-ink">
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
            task={run.parked.find((p) => p.taskRun === mode.taskRun)?.task ?? ""}
            onAnswered={(passed) => {
              setNotice(passed ? "Approved. The run continues." : "Changes requested. The next round starts with your findings.");
              go(at({ t: "rounds" }));
              onAnswered();
            }}
          />
        ) : mode.t === "artifact" ? (
          <Artifact ref_={mode.ref} namespace={run.namespace} anchor={mode.anchor} onRevision={(n) => go(at({ t: "artifact", ref: { ...mode.ref, revision: n } }))} />
        ) : (
          <div className="px-7 py-5">
            {view.runs.length > 1 && (
              <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Runs">
                {view.runs.map((r) => (
                  <button key={r.name} role="tab" aria-selected={r === run} onClick={() => go({ product: place.product, phase: place.phase, run: r.name })} className={`flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1.5 text-[13px] ${r === run ? "bg-ink text-white" : "bg-line-2 text-ink-2 hover:text-ink"}`}>
                    <Glyph state={runView(r).state} size={14} />
                    {runView(r).detail}
                    <span className={r === run ? "text-white/70" : "text-ink-3"}>{new Date(r.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                ))}
              </div>
            )}
            <Rounds namespace={run.namespace} name={run.name} round={roundOf(run)} onReview={(taskRun) => go(at({ t: "review", taskRun }))} onArtifact={(ref, anchor) => go(at({ t: "artifact", ref, ...(anchor ? { anchor } : {}) }))} />
          </div>
        )}
      </div>
    </aside>
  );
}

/** One revision read as a document, marked with what changed since the revision before it, and the way to its neighbours. */
function Artifact({ ref_, namespace, anchor, onRevision }: { ref_: RevisionRef; namespace: string; anchor?: string; onRevision: (n: number) => void }) {
  const jump = useMemo<Jump | undefined>(() => (anchor ? { anchor } : undefined), [anchor]);
  const [content, setContent] = useState<unknown>();
  const [schema, setSchema] = useState<Schema | undefined>();
  const [revs, setRevs] = useState<number[]>([]);
  const [prev, setPrev] = useState<{ revision: number; content: unknown } | undefined>();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    setContent(undefined);
    setPrev(undefined);
    api.revision(ref_, namespace).then(setContent, (e) => setError((e as Error).message));
    void api.schemaOf(ref_).then(setSchema);
    void api.revisions(ref_, namespace).then(setRevs, () => undefined);
    if (ref_.revision > 1) void api.previous(ref_, namespace).then(setPrev, () => undefined);
  }, [ref_, namespace]);
  const before = revs.filter((r) => r < ref_.revision).at(-1);
  const after = revs.find((r) => r > ref_.revision);
  const step = (n: number | undefined, label: string) => (
    <button type="button" disabled={n === undefined} onClick={() => n !== undefined && onRevision(n)} className="rounded px-1 font-medium text-ink-2 hover:text-ink disabled:opacity-30" aria-label={`${label} revision`} title={n === undefined ? undefined : `Revision ${n}`}>
      {label === "Previous" ? "‹" : "›"}
    </button>
  );
  return (
    <article className="px-7 pt-4 pb-10">
      <p className="mb-4 flex flex-wrap items-center gap-x-1 text-[13px] text-ink-3">
        <span>
          {ref_.kind} <span className="font-medium text-ink-2">{ref_.id}</span>,
        </span>
        {step(before, "Previous")}
        <span>
          revision {ref_.revision}
          {revs.length > 1 ? ` of ${revs.at(-1)}` : ""}
        </span>
        {step(after, "Next")}
        {prev && content !== undefined && <ChangesSwitch on={!hidden} onChange={(on) => setHidden(!on)} since={prev.revision} count={countOf(prev.content, content, schema, ref_.id, ref_.kind)} />}
        {ref_.kind === "EventStorming" && (
          <a className="ml-3 font-medium text-run hover:underline" href={`/tools/eventstorming/?${new URLSearchParams({ ns: ref_.namespace ?? namespace, id: ref_.id, rev: String(ref_.revision) })}`} target="_blank" rel="noreferrer">
            Open the board
          </a>
        )}
      </p>
      {error ? <p className="text-bad">{error}</p> : content === undefined ? <p className="text-ink-2">Loading…</p> : <DocView content={content} schema={schema} base={ref_.id} kind={ref_.kind} jump={jump} {...(prev && !hidden ? { prev: prev.content } : {})} />}
    </article>
  );
}

const refsOf = (n: api.Node): RevisionRef[] => Object.values(n.outputs ?? {}).flatMap((o) => (o.kind === "artifact" && o.ref ? [o.ref] : o.kind === "artifacts" ? (o.refs ?? []) : []));
const refKey = (r: RevisionRef) => `${r.kind}/${r.id}/${r.revision}`;
/** Every artifact a run and the runs it owns made, each once. */
const madeBy = (n: api.Node): RevisionRef[] => {
  const seen = new Map<string, RevisionRef>();
  const walk = (x: api.Node) => {
    for (const r of refsOf(x)) seen.set(refKey(r), r);
    x.children.forEach(walk);
  };
  walk(n);
  return [...seen.values()];
};

function Rounds({ namespace, name, round, onReview, onArtifact }: { namespace: string; name: string; round?: number; onReview: (taskRun: string) => void; onArtifact: (ref: RevisionRef, anchor?: string) => void }) {
  const [root, setRoot] = useState<api.Node | undefined>();
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(() => api.tree(namespace, name).then(setRoot, (e) => setError((e as Error).message)), [namespace, name]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load, round]);
  if (!root) return <p className="text-ink-2">{error ?? "Loading…"}</p>;
  // a finding names an element by id; the artifact of this round that holds it opens there
  const jump = (made: RevisionRef[]) => async (id: string) => {
    for (const ref of made) {
      const text = JSON.stringify(await api.revision(ref, namespace).catch(() => undefined));
      if (text?.includes(`"id":"${id}"`) || text?.includes(`"ref":"${id}"`)) return onArtifact(ref, id);
    }
    if (made[0]) onArtifact(made[0]);
  };
  return <Tree node={root} act={{ onReview, onArtifact, jump }} />;
}

interface Act {
  onReview: (taskRun: string) => void;
  onArtifact: (ref: RevisionRef, anchor?: string) => void;
  /** The jump for findings under `made`: the artifacts of the round they judge. */
  jump: (made: RevisionRef[]) => (id: string) => void;
}

const isRound = (n: api.Node) => /^rounds-\d+$/.test(n.label);

/** The runs a run owns: a review loop's as folded rounds, newest open; anything else as steps. */
function Tree({ node, act }: { node: api.Node; act: Act }) {
  const rounds = node.children.filter(isRound);
  if (rounds.length === 0)
    return (
      <ol className="space-y-1">
        {node.children.map((c) => (
          <Step key={c.name} node={c} act={act} onJump={act.jump(madeBy(node))} />
        ))}
        {node.error && <ErrorLine error={node.error} />}
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
                <Step key={c.name} node={c} act={act} onJump={act.jump(madeBy(r))} />
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
function Step({ node, act, onJump, depth = 0 }: { node: api.Node; act: Act; onJump: (id: string) => void; depth?: number }) {
  const { onReview, onArtifact } = act;
  const parkedTask = node.kind === "TaskRun" ? (node.parked ? node : undefined) : node.children.find((c) => c.kind === "TaskRun" && c.parked);
  // an artifact is listed where it was made, not again on every run that passed it up
  const below = new Set(node.children.flatMap(madeBy).map(refKey));
  const artifacts = refsOf(node).filter((r) => !below.has(refKey(r)));
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
          <button type="button" onClick={() => onReview(parkedTask.name)} className="ml-auto rounded-lg bg-persimmon px-3.5 py-1.5 text-[14px] font-semibold text-white hover:brightness-95">
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
              <span className="text-ink-2">
                <Linked text={f.message} onId={onJump} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {node.error && <ErrorLine error={node.error} />}
      {kids.some(isRound) ? (
        <div className="mt-1.5 mb-2 ml-[30px]">
          <Tree node={node} act={act} />
        </div>
      ) : (
        kids.length > 0 && (
          <ol>
            {kids.map((c) => (
              <Step key={c.name} node={c} act={act} onJump={onJump} depth={depth + 1} />
            ))}
          </ol>
        )
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
