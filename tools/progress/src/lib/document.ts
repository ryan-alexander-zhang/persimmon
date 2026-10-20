// Any artifact's content set as a document to read, and the verdict built from findings (37-progress.md). Pure: no DOM, no fetch.

export type Schema = Record<string, unknown>;

/** What a finding on a passage names: the nearest `id` (else the artifact id) and the field path below it. */
export type Anchor = string;

export type Block =
  | { t: "section"; heading: string; description?: string; anchor: Anchor; blocks: Block[] }
  | { t: "element"; id?: string; title?: string; meta: Meta[]; anchor: Anchor; blocks: Block[] }
  | { t: "prose"; label?: string; description?: string; text: string; anchor: Anchor }
  | { t: "list"; label?: string; description?: string; items: { text: string; anchor: Anchor }[]; tags: boolean }
  | { t: "group"; label?: string; description?: string; blocks: Block[] }
  | { t: "empty"; label?: string };

export interface Meta {
  label: string;
  value: string;
  anchor: Anchor;
}

export interface Doc {
  title?: string;
  meta: Meta[];
  blocks: Block[];
}

/** `successCriteria` → `Success criteria`. */
export const words = (key: string) => {
  const w = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
/** A value that fits on a meta line: a number, a flag, a token, a short phrase. */
const isShort = (v: unknown) => typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 40 && !v.includes("\n"));
/** `BR-2`, `CAP-10`, `expenses`: list entries shown as tags rather than bullets. */
const isTag = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][\w.-]{0,39}$/.test(v);

function deref(schema: Schema | undefined, root: Schema, depth = 0): Schema | undefined {
  if (!schema || depth > 8 || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  const target = schema.$ref
    .slice(2)
    .split("/")
    .reduce<unknown>((n, k) => (isObject(n) ? n[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
  return deref(isObject(target) ? { ...(target as Schema), ...(schema.description ? { description: schema.description } : {}) } : undefined, root, depth + 1);
}

/** The subschema of a property or of array items, through local `$ref`s and `allOf` branches. */
function sub(schema: Schema | undefined, root: Schema, key: string | "items"): Schema | undefined {
  const s = deref(schema, root);
  if (!s) return undefined;
  if (key === "items") return deref(isObject(s.items) ? (s.items as Schema) : undefined, root);
  const own = isObject(s.properties) ? (s.properties as Record<string, Schema>)[key] : undefined;
  if (own) return deref(own, root);
  for (const b of Array.isArray(s.allOf) ? (s.allOf as Schema[]) : []) {
    const found = sub(b, root, key);
    if (found) return found;
  }
  return undefined;
}

const describe = (schema: Schema | undefined, root: Schema) => {
  const d = deref(schema, root)?.description;
  return typeof d === "string" ? { description: d } : {};
};

const titleKeys = ["title", "name", "label", "statement"];

/** The short name an element or the document goes by, and the key it came from. */
function titleOf(v: Record<string, unknown>): { title?: string; used?: string } {
  const used = titleKeys.find((k) => typeof v[k] === "string" && (v[k] as string).length <= 100);
  return used ? { title: v[used] as string, used } : {};
}

interface At {
  base: string;
  path: string[];
}
const anchorAt = (at: At) => [at.base, ...at.path].join(" ");
const down = (at: At, key: string) => ({ base: at.base, path: [...at.path, key] });

/** The fields of an object as blocks: short ones on the meta line, the rest as run-in prose, lists, elements or groups. */
function fields(v: Record<string, unknown>, schema: Schema | undefined, root: Schema, at: At, skip: string[]): { meta: Meta[]; blocks: Block[] } {
  const meta: Meta[] = [];
  const blocks: Block[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (skip.includes(k)) continue;
    const s = sub(schema, root, k);
    const here = down(at, k);
    if (isShort(x)) meta.push({ label: words(k), value: String(x), anchor: anchorAt(here) });
    else blocks.push(...field(x, s, root, here, words(k)));
  }
  return { meta, blocks };
}

/** One field below the top: labelled, never a section of its own; unlabelled as a section's whole body. */
function field(x: unknown, s: Schema | undefined, root: Schema, at: At, name?: string): Block[] {
  const d = describe(s, root);
  const label = name ? { label: name } : {};
  if (x === null || x === undefined || (Array.isArray(x) && x.length === 0) || (isObject(x) && Object.keys(x).length === 0)) return [{ t: "empty", ...label }];
  if (isScalar(x)) return [{ t: "prose", ...label, ...d, text: String(x), anchor: anchorAt(at) }];
  if (Array.isArray(x)) {
    if (x.every(isScalar)) return [{ t: "list", ...label, ...d, items: x.map((i) => ({ text: String(i), anchor: anchorAt(at) })), tags: x.every(isTag) }];
    return [{ t: "group", ...label, ...d, blocks: elements(x, sub(s, root, "items"), root, at) }];
  }
  const { meta, blocks } = fields(x as Record<string, unknown>, s, root, at, []);
  return [{ t: "group", ...label, ...d, blocks: [...(meta.length ? [{ t: "element" as const, meta, anchor: anchorAt(at), blocks: [] }] : []), ...blocks] }];
}

/** An array's entries: an object is an element headed by its id and short name; anything else a paragraph. */
function elements(xs: unknown[], s: Schema | undefined, root: Schema, at: At): Block[] {
  return xs.map((x, i) => {
    const here = down(at, `#${i + 1}`);
    if (!isObject(x)) return { t: "prose", text: String(x), anchor: anchorAt(here) };
    const id = typeof x.id === "string" ? x.id : undefined;
    const { title, used } = titleOf(x);
    const inner = id ? { base: id, path: [] } : here;
    const { meta, blocks } = fields(x, s, root, inner, ["id", ...(used ? [used] : [])]);
    return { t: "element", ...(id ? { id } : {}), ...(title ? { title } : {}), meta, anchor: anchorAt(inner), blocks };
  });
}

/** The document of one artifact: its title, its short top-level fields as a meta line, every other top-level field a section. */
export function toDoc(content: unknown, schema: Schema | undefined, base: string): Doc {
  const root = schema ?? {};
  const at: At = { base, path: [] };
  if (typeof content === "string") return { meta: [], blocks: [{ t: "prose", text: content, anchor: base }] };
  if (!isObject(content)) return { meta: [], blocks: [{ t: "empty" }] };
  const { title, used } = titleOf(content);
  const meta: Meta[] = [];
  const blocks: Block[] = [];
  for (const [k, x] of Object.entries(content)) {
    if (k === used) continue;
    const s = sub(schema, root, k);
    const here = down(at, k);
    if (isShort(x)) {
      meta.push({ label: words(k), value: String(x), anchor: anchorAt(here) });
      continue;
    }
    const inner = Array.isArray(x) && x.length && !x.every(isScalar) ? elements(x, sub(s, root, "items"), root, here) : field(x, s, root, here);
    blocks.push({ t: "section", heading: words(k), ...describe(s, root), anchor: anchorAt(here), blocks: inner });
  }
  return { ...(title ? { title } : {}), meta, blocks };
}

export interface Finding {
  anchor: Anchor;
  /** The selected passage, when the finding came from a selection. */
  quote?: string;
  text: string;
}

/** `CAP-2 description: "builds a claim from lines" — split it`: the id first, as the confirm Tasks ask, then the passage. */
export function message(f: Finding): string {
  const quote = f.quote ? ` "${f.quote.length > 120 ? `${f.quote.slice(0, 117)}...` : f.quote}" —` : "";
  return f.anchor ? `${f.anchor}:${quote} ${f.text}` : f.quote ? `${quote.slice(1)} ${f.text}` : f.text;
}

export interface RevisionRef {
  apiVersion: string;
  kind: string;
  namespace?: string;
  id: string;
  revision: number;
}

/** The ValidationResult a click answers, as `askVerdict` builds it at the terminal: notes on approve, blocking on reject. */
export function verdict(passed: boolean, findings: Finding[], evidence: RevisionRef[]) {
  return {
    passed,
    findings: findings.map((f, i) => ({ severity: passed ? "info" : "error", code: passed ? `note_${i + 1}` : `blocking_${i + 1}`, message: message(f) })),
    evidence,
  };
}
