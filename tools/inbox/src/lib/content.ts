// Any artifact's content as a page tree, and the verdict built from findings (37-inbox.md). Pure: no DOM, no fetch.

export type Schema = Record<string, unknown>;

/** One item of the page: what it shows, and what a finding on it names. */
export interface Item {
  /** JSON Pointer into the content. */
  pointer: string;
  /** The property name in words, or a card's title. */
  label?: string;
  /** The schema `description` of the property, shown on hover. */
  description?: string;
  /** What a finding's message starts with: the nearest `id`, then the pointer below it. */
  anchor: string;
  shape: "fields" | "cards" | "bullets" | "text" | "empty";
  text?: string;
  children?: Item[];
}

/** `successCriteria` → `Success criteria`. */
export const words = (key: string) => {
  const w = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const escape = (k: string | number) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

/** The subschema of a property or of array items, following local `$ref`s and `allOf` branches. */
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

function deref(schema: Schema | undefined, root: Schema, depth = 0): Schema | undefined {
  if (!schema || depth > 8 || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  const target = schema.$ref
    .slice(2)
    .split("/")
    .reduce<unknown>((n, k) => (isObject(n) ? n[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
  return deref(isObject(target) ? { ...(target as Schema), ...(schema.description ? { description: schema.description } : {}) } : undefined, root, depth + 1);
}

const titleKeys = ["name", "title", "label", "statement"];

/** A card's title: its `id`, then its name, title or statement when short; `used` is the key the title took. */
function cardTitle(v: Record<string, unknown>): { title?: string; used?: string } {
  const used = titleKeys.find((k) => typeof v[k] === "string" && (v[k] as string).length <= 80);
  const title = [typeof v.id === "string" ? v.id : undefined, used && v[used]].filter(Boolean).join(" · ");
  return title ? { title, ...(used ? { used } : {}) } : {};
}

/** The page tree of `value` under `schema`. `base` is what a finding names when no `id` is nearer, first the artifact id; `below` is the pointer under it. */
export function toItem(value: unknown, schema: Schema | undefined, root: Schema, base: string, pointer = "", label?: string, below = pointer): Item {
  const description = typeof deref(schema, root)?.description === "string" ? (deref(schema, root)!.description as string) : undefined;
  const own = isObject(value) && typeof value.id === "string" ? value.id : undefined;
  const anchor = own ?? (below ? `${base} ${below}` : base);
  const item: Item = { pointer, anchor, shape: "text", ...(label ? { label } : {}), ...(description ? { description } : {}) };
  // below an item with an id, a finding names that id and the pointer under it
  const child = (v: unknown, s: Schema | undefined, k: string | number, l?: string) => toItem(v, s, root, own ?? base, `${pointer}/${escape(k)}`, l, `${own ? "" : below}/${escape(k)}`);

  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0))
    return { ...item, shape: "empty" };
  if (Array.isArray(value)) {
    const items = sub(schema, root, "items");
    if (value.every(isObject)) return { ...item, shape: "cards", children: value.map((v, i) => child(v, items, i, cardTitle(v).title ?? `${i + 1}`)) };
    return { ...item, shape: "bullets", children: value.map((v, i) => child(v, items, i)) };
  }
  if (isObject(value)) {
    const t = cardTitle(value);
    const titled = t.title !== undefined && (!label || label === t.title); // the title shows the id and the name: not again below it
    const keys = Object.keys(value).filter((k) => !titled || (k !== "id" && k !== t.used));
    return { ...item, ...(titled ? { label: t.title } : {}), shape: "fields", children: keys.map((k) => child(value[k], sub(schema, root, k), k, words(k))) };
  }
  return { ...item, text: String(value) };
}

export interface Finding {
  anchor: string;
  text: string;
}

export interface RevisionRef {
  apiVersion: string;
  kind: string;
  id: string;
  revision: number;
}

/** The ValidationResult a click answers, as `askVerdict` builds it at the terminal: findings are notes on approve, blocking on reject. */
export function verdict(passed: boolean, findings: Finding[], evidence: RevisionRef[]) {
  return {
    passed,
    findings: findings.map((f, i) => ({
      severity: passed ? "info" : "error",
      code: passed ? `note_${i + 1}` : `blocking_${i + 1}`,
      message: f.anchor ? `${f.anchor}: ${f.text}` : f.text,
    })),
    evidence,
  };
}
