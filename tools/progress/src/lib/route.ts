// What is open, as the hash says it (37-progress.md): `#<product>/<phase>/<run>/<view>`, so any place can be linked and the
// back button walks it. Pure: no DOM.
import type { RevisionRef } from "./document";

export type View = { t: "rounds" } | { t: "review"; taskRun: string } | { t: "artifact"; ref: RevisionRef; anchor?: string };

export interface Place {
  product?: string;
  phase?: string;
  run?: string;
  /** Unset: the panel's own default, the review when one waits on you, else the rounds. */
  view?: View;
}

/** The products page, `#products`. */
export const PRODUCTS = "products";

export type Route = Place | typeof PRODUCTS;

export function parse(hash: string): Route {
  const [product, phase, run, mode, ...rest] = decodeURIComponent(hash.replace(/^#/, "")).split("/");
  if (product === PRODUCTS) return PRODUCTS;
  const view: View | undefined =
    mode === "rounds"
      ? { t: "rounds" }
      : mode === "review" && rest[0]
        ? { t: "review", taskRun: rest[0] }
        : mode === "artifact" && rest.length >= 3 && Number.isInteger(Number(rest[2]))
          ? // ponytail: the hash names no apiVersion; the API resolves a kind by its name alone, which the packs keep unique
            { t: "artifact", ref: { apiVersion: "", kind: rest[0]!, id: rest[1]!, revision: Number(rest[2]) }, ...(rest[3] ? { anchor: rest[3] } : {}) }
          : undefined;
  return { ...(product ? { product } : {}), ...(phase ? { phase } : {}), ...(run ? { run } : {}), ...(view ? { view } : {}) };
}

export function format(route: Route): string {
  if (route === PRODUCTS) return `#${PRODUCTS}`;
  const v = route.view;
  const tail = !v ? [] : v.t === "rounds" ? ["rounds"] : v.t === "review" ? ["review", v.taskRun] : ["artifact", v.ref.kind, v.ref.id, String(v.ref.revision), ...(v.anchor ? [v.anchor] : [])];
  return `#${[route.product, route.phase, route.run, ...tail].filter((p): p is string => !!p).join("/")}`;
}
