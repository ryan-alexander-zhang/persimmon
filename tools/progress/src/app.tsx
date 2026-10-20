// Progress (37-progress.md): the product picker, the map, and the panel of the phase you open.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { products, phases, type Run, view } from "./lib/flow";
import { Map } from "./map";
import { Panel } from "./panel";

/** `#<product>/<phase>`: what is open survives a reload and can be linked. */
const fromHash = () => {
  const [product, phase] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { product: product || undefined, phase: phase || undefined };
};

export function App() {
  const [runs, setRuns] = useState<Run[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [product, setProduct] = useState(fromHash().product);
  const [phase, setPhase] = useState(fromHash().phase);

  const refresh = useCallback(async () => {
    try {
      setRuns((await api.runs()).runs);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000); // a drain moves a run within seconds
    return () => clearInterval(t);
  }, [refresh]);

  const all = useMemo(() => (runs ? products(runs) : []), [runs]);
  useEffect(() => {
    if (all.length && (!product || !all.includes(product))) setProduct(all[0]);
  }, [all, product]);
  useEffect(() => {
    if (product) history.replaceState(null, "", `#${product}${phase ? `/${phase}` : ""}`);
  }, [product, phase]);

  const views = useMemo(() => (runs && product ? phases.map((p) => view(p, product, runs)) : []), [runs, product]);
  const waiting = useMemo(() => all.map((p) => ({ product: p, phase: phases.map((ph) => view(ph, p, runs ?? [])).find((v) => v.state === "needs-you") })).filter((w) => w.phase), [all, runs]);
  const reviews = waiting.every((w) => w.phase!.runs.every((r) => r.parked.every((t) => t.verdict)));
  const open = views.find((v) => v.phase.id === phase);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="size-3 rounded-full bg-persimmon" aria-hidden />
          Persimmon
        </span>
        {all.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <span className="sr-only">Product</span>
            <select
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setPhase(undefined);
              }}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[15px] font-medium text-ink"
            >
              {all.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/-prd$/, "")}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="ml-auto" />
        {error && <span className="text-sm text-bad">{error}</span>}
        {waiting.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setProduct(waiting[0]!.product);
              setPhase(waiting[0]!.phase!.phase.id);
            }}
            className="rounded-full bg-persimmon px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-95"
          >
            {waiting.length === 1 ? `1 ${reviews ? "review waits" : "step waits"} on you` : `${waiting.length} ${reviews ? "reviews" : "steps"} wait on you`}
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1" aria-label="Phases">
          {runs && all.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center text-ink-2">
              <div className="max-w-md">
                <p className="text-lg font-medium text-ink">No product yet</p>
                <p className="mt-2">
                  Start one with <code className="rounded bg-line-2 px-1.5 py-0.5 text-[13px]">persimmon run author-prd --input productId=&lt;id&gt; --input brief=@brief.md</code>. Its phases appear here as they run.
                </p>
              </div>
            </div>
          ) : (
            <Map key={open ? "beside" : "alone"} views={views} selected={phase} onSelect={setPhase} /> // remounted to fit the space left beside the panel
          )}
        </section>
        {open && <Panel key={`${product}/${open.phase.id}`} view={open} onClose={() => setPhase(undefined)} onAnswered={() => void refresh()} />}
      </div>
    </div>
  );
}
