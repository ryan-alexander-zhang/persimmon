// An artifact set as a document (37-progress.md); in a review, selecting text or a heading's button notes a finding.
import { MessageSquarePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffDoc } from "./lib/diff";
import { type Anchor, type Block, type Finding, type Meta, type Part, type Schema, toDoc } from "./lib/document";

export interface Noting {
  findings: Finding[];
  add: (f: Finding) => void;
}

/** A place to scroll to: an element's anchor; a fresh object each time, so the same id jumps again. */
export interface Jump {
  anchor: Anchor;
}

/** Scrolls to and flashes the passage `anchor` names, when it is on the page. */
export function jumpTo(anchor: Anchor) {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("jumped");
  void el.offsetWidth; // restart the animation
  el.classList.add("jumped");
}

/** `BR-6`, `GD-14`: the ids a finding names, each a button to the element. */
export function Linked({ text, onId }: { text: string; onId: (id: string) => void }) {
  const parts = text.split(/\b([A-Z]{1,6}-\d+)\b/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <button key={i} type="button" onClick={() => onId(p)} className="rounded bg-line-2 px-1 font-sans text-[13px] font-semibold text-ink-2 hover:bg-ink hover:text-white" title={`Go to ${p}`}>
            {p}
          </button>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** The ids of every element in the document: what a tag or a finding can jump to. */
function idsOf(blocks: Block[], into = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (b.t === "element" && b.id) into.add(b.id);
    if ("blocks" in b) idsOf(b.blocks, into);
  }
  return into;
}

const contains = (blocks: Block[], anchor: Anchor): boolean => blocks.some((b) => ("anchor" in b && b.anchor === anchor) || ("blocks" in b && contains(b.blocks, anchor)));

/** With `prev`, the document is marked with what changed since that earlier revision's content; `jump` scrolls to one element. */
export function DocView({ content, schema, base, kind, noting, prev, jump: wanted }: { content: unknown; schema?: Schema; base: string; kind?: string; noting?: Noting; prev?: unknown; jump?: Jump }) {
  const doc = useMemo(() => (prev === undefined ? toDoc(content, schema, base, kind) : diffDoc(toDoc(prev, schema, base, kind), toDoc(content, schema, base, kind))), [content, schema, base, kind, prev]);
  const ids = useMemo(() => idsOf(doc.blocks), [doc]);
  const [jump, setJump] = useState(wanted);
  useEffect(() => setJump(wanted), [wanted]);
  useEffect(() => {
    if (jump && contains(doc.blocks, jump.anchor)) jumpTo(jump.anchor); // after the sections holding it opened
  }, [jump, doc]);
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ anchor: Anchor; quote?: string; x: number; y: number } | undefined>();
  const [draft, setDraft] = useState<typeof pick>();

  // a selection inside the document offers "Add finding" beside it
  useEffect(() => {
    if (!noting) return;
    const onUp = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !box.current) return setPick(undefined);
      const range = sel.getRangeAt(0);
      if (!box.current.contains(range.commonAncestorContainer)) return setPick(undefined);
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const anchor = start?.closest<HTMLElement>("[data-anchor]")?.dataset.anchor ?? base;
      const rect = range.getBoundingClientRect();
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (quote) setPick({ anchor, quote, x: rect.right, y: rect.bottom });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [noting, base]);

  const noted = (anchor: Anchor) => noting?.findings.filter((f) => f.anchor === anchor).length ?? 0;
  const ctx: Ctx = { diffing: prev !== undefined, noted, onHeading: noting ? (anchor, el) => setDraft({ anchor, ...corner(el) }) : undefined, jump: jump && contains(doc.blocks, jump.anchor) ? jump.anchor : undefined, onId: (id) => setJump({ anchor: id }), ids };

  return (
    <div ref={box} className="max-w-[68ch] font-read text-[17px] leading-[1.65] text-ink">
      {doc.title && <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em]">{doc.title}</h1>}
      {doc.meta.length > 0 && <MetaLine meta={doc.meta} className="mt-2" ctx={ctx} />}
      <div className="mt-6 space-y-9">
        {doc.blocks.map((b, i) => (
          <BlockView key={i} block={b} ctx={ctx} />
        ))}
      </div>
      {pick && !draft && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()} // keep the selection
          onClick={() => {
            setDraft(pick);
            setPick(undefined);
          }}
          style={{ left: Math.min(pick.x, innerWidth - 150), top: pick.y + 6 }}
          className="fixed z-40 flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-sans text-sm font-medium text-white shadow-lg"
        >
          <MessageSquarePlus className="size-4" aria-hidden /> Add finding
        </button>
      )}
      {draft && noting && (
        <Composer
          at={draft}
          onKeep={(text) => {
            noting.add({ anchor: draft.anchor, ...(draft.quote ? { quote: draft.quote } : {}), text });
            setDraft(undefined);
            getSelection()?.removeAllRanges();
          }}
          onDrop={() => setDraft(undefined)}
        />
      )}
    </div>
  );
}

const corner = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.bottom };
};

interface Ctx {
  diffing: boolean;
  noted: (anchor: Anchor) => number;
  onHeading?: (anchor: Anchor, el: HTMLElement) => void;
  /** The element the reader asked for: a section holding it opens. */
  jump?: Anchor;
  onId: (id: string) => void;
  ids: Set<string>;
}

/** A passage with findings carries a persimmon rule in the margin. */
const mark = (ctx: Ctx, anchor: Anchor) => (ctx.noted(anchor) ? "border-l-2 border-persimmon pl-3 -ml-[14px]" : "");

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  switch (block.t) {
    case "section":
      return <Section block={block} ctx={ctx} />;
    case "element":
      return (
        <div data-anchor={block.anchor} className={`group/el ${mark(ctx, block.anchor)}`}>
          {(block.id || block.title) && (
            <h3 className={`flex items-baseline gap-2.5 ${block.change === "removed" ? "opacity-50" : ""}`}>
              {block.id && <span className="shrink-0 rounded bg-line-2 px-1.5 py-px font-sans text-[13px] font-semibold text-ink-2 tabular-nums">{block.id}</span>}
              {block.title && <span className={`font-semibold ${block.change === "removed" ? "line-through decoration-bad/60" : ""}`}>{block.title}</span>}
              <ChangeTag change={block.change} />
              {ctx.onHeading && (
                <button
                  type="button"
                  onClick={(e) => ctx.onHeading!(block.anchor, e.currentTarget)}
                  className="ml-auto self-center rounded p-1 text-ink-3 opacity-0 group-hover/el:opacity-100 hover:bg-persimmon-soft hover:text-persimmon focus-visible:opacity-100"
                  aria-label={`Add a finding on ${block.id ?? block.title}`}
                  title={`Add a finding on ${block.id ?? block.title}`}
                >
                  <MessageSquarePlus className="size-4" aria-hidden />
                </button>
              )}
            </h3>
          )}
          {block.meta.length > 0 && <MetaLine meta={block.meta} className={`mt-0.5 ${block.change === "removed" ? "opacity-50" : ""}`} ctx={ctx} />}
          {block.blocks.length > 0 && (
            <div className={`mt-1.5 space-y-2 ${block.change === "removed" ? "opacity-50" : ""}`}>
              {block.blocks.map((b, i) => (
                <BlockView key={i} block={b} ctx={ctx} />
              ))}
            </div>
          )}
        </div>
      );
    case "prose":
      return (
        <div data-anchor={block.anchor} className={mark(ctx, block.anchor)}>
          {block.parts || block.change ? (
            <p className="whitespace-pre-line">
              {block.label && (
                <span className="font-sans text-[14px] font-semibold text-ink-2" title={block.description}>
                  {block.label}.{" "}
                </span>
              )}
              {(block.parts ?? [{ text: block.text, ...(block.change === "added" || block.change === "removed" ? { change: block.change } : {}) }]).map((p, i) => (
                <Words key={i} part={p} />
              ))}
            </p>
          ) : (
            block.text.split(/\n\s*\n/).map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {i === 0 && block.label && (
                  <span className="font-sans text-[14px] font-semibold text-ink-2" title={block.description}>
                    {block.label}.{" "}
                  </span>
                )}
                {para}
              </p>
            ))
          )}
        </div>
      );
    case "list":
      return (
        <div data-anchor={block.items[0]?.anchor} className={block.items[0] ? mark(ctx, block.items[0].anchor) : ""}>
          {block.label && (
            <span className="font-sans text-[14px] font-semibold text-ink-2" title={block.description}>
              {block.label}
              {block.tags ? " " : ""}
            </span>
          )}
          {block.tags ? (
            <span className="inline-flex flex-wrap gap-1.5 align-baseline">
              {block.items.map((it, i) => {
                const cls = `rounded px-1.5 font-sans text-[13px] font-medium ${it.change === "added" ? "bg-done-soft text-done" : it.change === "removed" ? "bg-bad-soft text-bad line-through" : "bg-line-2 text-ink-2"}`;
                return ctx.ids.has(it.text) ? (
                  <button key={i} type="button" onClick={() => ctx.onId(it.text)} className={`${cls} cursor-pointer hover:bg-ink hover:text-white`} title={`Go to ${it.text}`}>
                    {it.text}
                  </button>
                ) : (
                  <span key={i} className={cls}>
                    {it.text}
                  </span>
                );
              })}
            </span>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-6 marker:text-ink-3">
              {block.items.map((it, i) => (
                <li key={i}>{it.change ? <Words part={{ text: it.text, change: it.change === "removed" ? "removed" : "added" }} /> : it.text}</li>
              ))}
            </ul>
          )}
        </div>
      );
    case "group":
      return (
        <div>
          {block.label && (
            <p className="font-sans text-[14px] font-semibold text-ink-2" title={block.description}>
              {block.label}
            </p>
          )}
          <div className="mt-1.5 space-y-4 border-l border-line pl-4">
            {block.blocks.map((b, i) => (
              <BlockView key={i} block={b} ctx={ctx} />
            ))}
          </div>
        </div>
      );
    case "empty":
      return (
        <p className="font-sans text-[14px] text-ink-3">
          {block.label ? `${block.label}: ` : ""}none
        </p>
      );
  }
}

function MetaLine({ meta, className, ctx }: { meta: Meta[]; className?: string; ctx: Ctx }) {
  return (
    <p className={`font-sans text-[14px] text-ink-2 ${className ?? ""}`}>
      {meta.map((m, i) => (
        <span key={i} data-anchor={m.anchor} className={ctx.noted(m.anchor) ? "text-persimmon" : ""}>
          {i > 0 && ", "}
          {i === 0 ? m.label : m.label.toLowerCase()}{" "}
          {m.change === "removed" ? (
            <Words part={{ text: m.value, change: "removed" }} />
          ) : m.change ? (
            <>
              <Words part={{ text: m.value, change: "added" }} />
              {m.was !== undefined && (
                <>
                  {" "}
                  <Words part={{ text: m.was, change: "removed" }} />
                </>
              )}
            </>
          ) : (
            <span className="font-medium text-ink">{m.value}</span>
          )}
        </span>
      ))}
    </p>
  );
}

/** A section; unchanged ones fold to their heading while changes are shown. */
function Section({ block, ctx }: { block: Extract<Block, { t: "section" }>; ctx: Ctx }) {
  const [opened, setOpen] = useState<boolean>(); // the reader's choice; until then, folded when unchanged (the earlier revision may load after this mounts)
  const open = opened ?? (!ctx.diffing || !!block.change || (!!ctx.jump && contains(block.blocks, ctx.jump)));
  return (
    <section data-anchor={block.anchor} className={block.change === "removed" ? "opacity-50" : ""}>
      <h2 className="flex items-baseline gap-2.5 font-sans text-[19px] font-semibold text-ink" title={block.description}>
        {block.heading}
        <ChangeTag change={block.change === "changed" ? undefined : block.change} />
        {ctx.diffing && !block.change && (
          <button type="button" onClick={() => setOpen(!open)} className="text-[13px] font-normal text-ink-3 hover:text-ink">
            {open ? "unchanged, fold" : "unchanged, show"}
          </button>
        )}
      </h2>
      {open && (
        <div className="mt-3 space-y-5">
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} ctx={ctx} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Words added (green underline) or removed (struck in red) since the earlier revision. */
function Words({ part }: { part: Part }) {
  if (part.change === "added") return <ins className="bg-done-soft text-ink underline decoration-done decoration-2 underline-offset-4">{part.text}</ins>;
  if (part.change === "removed") return <del className="text-bad decoration-bad/70">{part.text}</del>;
  return <>{part.text}</>;
}

function ChangeTag({ change }: { change?: string }) {
  if (change !== "added" && change !== "removed") return null;
  return <span className={`self-center rounded px-1.5 py-px font-sans text-[12px] font-semibold ${change === "added" ? "bg-done-soft text-done" : "bg-bad-soft text-bad"}`}>{change === "added" ? "Added" : "Removed"}</span>;
}

function Composer({ at, onKeep, onDrop }: { at: { anchor: Anchor; quote?: string; x: number; y: number }; onKeep: (text: string) => void; onDrop: () => void }) {
  const [text, setText] = useState("");
  return (
    <div style={{ left: Math.max(16, Math.min(at.x - 340, innerWidth - 376)), top: Math.min(at.y + 8, innerHeight - 230) }} className="fixed z-50 w-[360px] rounded-xl border border-line bg-surface p-3 font-sans shadow-xl" role="dialog" aria-label="New finding">
      <p className="text-[13px] font-semibold text-ink-2">{at.anchor}</p>
      {at.quote && <p className="mt-1 line-clamp-2 border-l-2 border-persimmon pl-2 font-read text-[14px] text-ink-2 italic">{at.quote}</p>}
      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) onKeep(text.trim());
          }
          if (e.key === "Escape") onDrop();
        }}
        placeholder="What must change?"
        className="mt-2 w-full resize-none rounded-md border border-line px-2.5 py-2 text-[14px] focus:border-ink-3 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between text-[12px] text-ink-3">
        <span>Enter to add, Esc to cancel</span>
        <span className="flex gap-2">
          <button type="button" onClick={onDrop} className="rounded-md px-2.5 py-1 text-[13px] text-ink-2 hover:bg-line-2">
            Cancel
          </button>
          <button type="button" disabled={!text.trim()} onClick={() => onKeep(text.trim())} className="rounded-md bg-ink px-2.5 py-1 text-[13px] font-medium text-white disabled:opacity-40">
            Add finding
          </button>
        </span>
      </div>
    </div>
  );
}
