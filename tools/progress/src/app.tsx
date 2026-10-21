// Progress (37-progress.md): the product picker, the map, and the panel of the phase you open.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { phasesOf, products, type Run, view } from "./lib/flow";
import { format, parse, type Place, PRODUCTS, type Route } from "./lib/route";
import { Map } from "./map";
import { Panel } from "./panel";
import { Products } from "./products";

/** Every move is a hash change, so what is open survives a reload, can be linked, and the back button walks it. */
const go = (r: Route) => {
  location.hash = format(r);
};

export function App() {
  const [runs, setRuns] = useState<Run[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

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
  const showProducts = route === PRODUCTS;
  const place: Place = showProducts ? {} : route;
  const product = place.product;
  useEffect(() => {
    if (!showProducts && all.length && (!product || !all.includes(product))) {
      history.replaceState(null, "", format({ product: all[0] }));
      setRoute({ product: all[0] });
    }
  }, [all, product, showProducts]);

  const views = useMemo(() => (runs && product ? phasesOf(product, runs).map((p) => view(p, product, runs)) : []), [runs, product]);
  const waiting = useMemo(() => all.map((p) => ({ product: p, phase: phasesOf(p, runs ?? []).map((ph) => view(ph, p, runs ?? [])).find((v) => v.state === "needs-you") })).filter((w) => w.phase), [all, runs]);
  const reviews = waiting.every((w) => w.phase!.runs.every((r) => r.parked.every((t) => t.verdict)));
  const open = views.find((v) => v.phase.id === place.phase);

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
            <select value={product ?? ""} onChange={(e) => go({ product: e.target.value })} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[15px] font-medium text-ink">
              {!product && <option value="" />}
              {all.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/-prd$/, "")}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* the Products page reads Prds, so it stands even before any run */}
        {runs && (
          <button
            type="button"
            onClick={() => go(showProducts ? { product: all[0] } : PRODUCTS)}
            className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${showProducts ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:text-ink"}`}
            aria-pressed={showProducts}
          >
            Products
          </button>
        )}
        <span className="ml-auto" />
        {error && <span className="text-sm text-bad">{error}</span>}
        {waiting.length > 0 && (
          <button type="button" onClick={() => go({ product: waiting[0]!.product, phase: waiting[0]!.phase!.phase.id })} className="rounded-full bg-persimmon px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-95">
            {waiting.length === 1 ? `1 ${reviews ? "review waits" : "step waits"} on you` : `${waiting.length} ${reviews ? "reviews" : "steps"} wait on you`}
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1" aria-label={showProducts ? "Products" : "Phases"}>
          {showProducts ? (
            <Products onOpen={(p) => go({ product: p })} />
          ) : runs && all.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center text-ink-2">
              <div className="max-w-md">
                <p className="text-lg font-medium text-ink">No product yet</p>
                <p className="mt-2">
                  Start one with <code className="rounded bg-line-2 px-1.5 py-0.5 text-[13px]">persimmon run author-prd --input productId=&lt;id&gt; --input brief=@brief.md</code>. Its phases appear here as they run.
                </p>
              </div>
            </div>
          ) : (
            <Map key={open ? "beside" : "alone"} views={views} selected={place.phase} onSelect={(id) => go({ product, phase: id })} /> // remounted to fit the space left beside the panel
          )}
        </section>
        {open && !showProducts && <Panel key={`${product}/${open.phase.id}`} view={open} place={place} go={go} onClose={() => go({ product })} onAnswered={() => void refresh()} />}
      </div>
    </div>
  );
}
