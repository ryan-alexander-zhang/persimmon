// What changed in a document since an earlier revision (37-progress.md). Blocks pair by the anchor a finding names, so an
// element follows its `id`; prose is compared word by word. Pure: no DOM, no fetch.
import { diffWords } from "diff";
import type { Block, Doc, Meta, Part } from "./document";

/** What a block is paired by: its anchor, and for a block without one its kind and label. */
const keyOf = (b: Block): string => {
  switch (b.t) {
    case "section":
    case "element":
    case "prose":
      return `${b.t}:${b.anchor}`;
    case "list":
      return `list:${b.label ?? ""}:${b.items[0]?.anchor ?? ""}`;
    default:
      return `${b.t}:${b.label ?? ""}`;
  }
};

/** `next` with every block, field and passage marked against `prev`; a removed block stays where it was, marked. */
export function diffDoc(prev: Doc, next: Doc): Doc {
  return { ...next, meta: diffMeta(prev.meta, next.meta), blocks: diffBlocks(prev.blocks, next.blocks) };
}

function diffBlocks(prev: Block[], next: Block[]): Block[] {
  const before = new Map(prev.map((b) => [keyOf(b), b]));
  const kept = new Set<string>();
  const out: Block[] = [];
  for (const b of next) {
    const p = before.get(keyOf(b));
    if (p) kept.add(keyOf(b));
    out.push(p ? diffBlock(p, b) : mark(b, "added"));
  }
  // a removed block goes back after the block that preceded it, so it reads where it was
  prev.forEach((b, i) => {
    if (kept.has(keyOf(b))) return;
    const after = prev.slice(0, i).reverse().find((x) => kept.has(keyOf(x)));
    const at = after ? out.findIndex((x) => keyOf(x) === keyOf(after)) + 1 : 0;
    out.splice(at, 0, mark(b, "removed"));
    kept.add(keyOf(b));
  });
  return out;
}

function diffBlock(p: Block, n: Block): Block {
  if (p.t === "prose" && n.t === "prose") {
    if (p.text === n.text) return n;
    const parts: Part[] = diffWords(p.text, n.text).map((c) => ({ text: c.value, ...(c.added ? { change: "added" as const } : c.removed ? { change: "removed" as const } : {}) }));
    // a replacement reads as two words, not one: "one of", never "oneof"
    parts.forEach((x, i) => {
      if (x.change === "removed" && parts[i + 1]?.change === "added" && !/\s$/.test(x.text) && !/^\s/.test(parts[i + 1]!.text)) x.text += " ";
    });
    return { ...n, parts, change: "changed" };
  }
  if (p.t === "list" && n.t === "list") {
    const was = new Set(p.items.map((i) => i.text));
    const now = new Set(n.items.map((i) => i.text));
    const items = [...n.items.map((i) => (was.has(i.text) ? i : { ...i, change: "added" as const })), ...p.items.filter((i) => !now.has(i.text)).map((i) => ({ ...i, change: "removed" as const }))];
    return items.some((i) => i.change) ? { ...n, items, change: "changed" } : n;
  }
  if ((p.t === "section" || p.t === "group") && n.t === p.t) {
    const blocks = diffBlocks(p.blocks, n.blocks);
    return blocks.some((b) => b.change) ? { ...n, blocks, change: "changed" } : n;
  }
  if (p.t === "element" && n.t === "element") {
    const meta = diffMeta(p.meta, n.meta);
    const blocks = diffBlocks(p.blocks, n.blocks);
    const titled = p.title !== n.title;
    return titled || meta.some((m) => m.change) || blocks.some((b) => b.change) ? { ...n, meta, blocks, change: "changed" } : n;
  }
  return JSON.stringify(p) === JSON.stringify(n) ? n : { ...n, change: "changed" };
}

function diffMeta(prev: Meta[], next: Meta[]): Meta[] {
  const before = new Map(prev.map((m) => [m.anchor, m]));
  const now = new Set(next.map((m) => m.anchor));
  return [
    ...next.map((m) => {
      const p = before.get(m.anchor);
      return !p ? { ...m, change: "added" as const } : p.value !== m.value ? { ...m, change: "changed" as const, was: p.value } : m;
    }),
    ...prev.filter((m) => !now.has(m.anchor)).map((m) => ({ ...m, change: "removed" as const })),
  ];
}

/** A whole block added or removed: the mark sits on it, its insides read as they are. */
const mark = (b: Block, change: "added" | "removed"): Block => ({ ...b, change });

/** How many elements, passages and fields changed: what the switch's label counts. */
export function countChanges(blocks: Block[]): number {
  return blocks.reduce((n, b) => {
    if (b.change === "added" || b.change === "removed") return n + 1;
    if (b.change !== "changed") return n;
    if (b.t === "section" || b.t === "group") return n + countChanges(b.blocks);
    if (b.t === "element") return n + Math.max(1, countChanges(b.blocks) + b.meta.filter((m) => m.change).length);
    return n + 1;
  }, 0);
}
