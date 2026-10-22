"use client";

// GemPicker — combobox เลือกชนิด/รูปทรงพลอย (repo ไม่มี Select/Combobox) · UX §3.4
//  - presentation "popover" (ออฟฟิศ: ลูกศรเลื่อน · Enter เลือก · Esc ปิด) | "sheet" (หน้างานมือถือ W3: แผ่นเต็มจอ)
//  - ค้นหาไม่สนช่องว่าง/ตัวพิมพ์ · "ใกล้เคียงที่พิมพ์" ขึ้นบน (ตัวดักเบาๆ) · "＋ เพิ่ม “…” เป็นชนิดใหม่" เป็น option สุดท้าย
//  - เพิ่มใหม่: ตรวจชื่อ (cleanGemName) → ซ้ำเป๊ะหลัง normalize = ใช้ตัวเดิมให้ (แจ้ง) → คล้าย = GemSimilarPrompt → รูปทรงใหม่ = GemNewShapeAsk (1/2 ค่า)
//  - ชื่อใหม่ในฟอร์มนี้ (ยังไม่เข้าแคตตาล็อก จนกดบันทึก/เปิดงาน) ขึ้นรายการของแถวถัดไปพร้อมป้าย "ใหม่"
//  - ไม่มีรายการเลย (ไม่ seed ชนิด) = ข้อความชวนพิมพ์ชื่อแรก · โหลดรายการไม่ได้ = พิมพ์เองได้ แต่ตัวดักซ้ำฝั่งจอไม่ทำงาน (DB ยังดัก)
// 🔴 ไม่มีราคา/ผู้ขาย/ผู้สร้างในรายการ — options มาจาก gem_options_list (ไม่มีราคา)

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { GemNewShapeAsk } from "@/components/domain/gems/GemNewShapeAsk";
import { GemSimilarPrompt } from "@/components/domain/gems/GemSimilarPrompt";
import { GEM_FIELD } from "@/components/domain/gems/ui";
import type { DraftShape, DraftType } from "@/lib/jobs/gem-draft";
import { cleanGemName, findSimilarGemNames, normalizeGemName } from "@/lib/jobs/shop-gems";

export interface PickerOption {
  id: string;
  name: string;
  hasLength?: boolean;
}
export interface PendingOption {
  name: string;
  hasLength?: boolean;
}

interface Common {
  /** id ฐานของ aria (ไม่ซ้ำในหน้า) */
  id: string;
  label: string;
  options: readonly PickerOption[];
  /** ชื่อใหม่ที่พิมพ์ในฟอร์มนี้แล้ว (ยังไม่เข้าแคตตาล็อก) */
  pending: readonly PendingOption[];
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  presentation?: "popover" | "sheet";
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** ผู้ใช้เลือก "เพิ่มใหม่จริงๆ" ข้ามตัวดักชื่อคล้าย → ฟอร์มส่ง force ตอนบันทึก */
  onForceSimilar?: () => void;
  /** ข้อความแจ้ง (เช่น “ใช้ตัวเดิมให้”) */
  onNotice?: (message: string) => void;
}
type TypeProps = Common & { kind: "type"; value: DraftType | null; onSelect: (v: DraftType) => void };
type ShapeProps = Common & { kind: "shape"; value: DraftShape | null; onSelect: (v: DraftShape) => void };

type Entry =
  | { t: "opt"; key: string; id: string | null; name: string; hasLength?: boolean; pending: boolean; group: "near" | "all" }
  | { t: "add"; key: string; name: string };

const KIND_TH = { type: "ชนิดพลอย", shape: "รูปทรง" } as const;

export function GemPicker(props: TypeProps | ShapeProps) {
  const { kind, id, label, options, pending, loading, loadError, onRetry, presentation = "popover", disabled, invalid, describedBy, onForceSimilar, onNotice } = props;
  const uid = useId();
  const listId = `${id}-list-${uid}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ typed: string; matches: { id: string | null; name: string }[] } | null>(null);
  const [askShape, setAskShape] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const all = useMemo(() => [...options.map((o) => ({ ...o, pending: false })), ...pending.map((p) => ({ id: null as string | null, name: p.name, hasLength: p.hasLength, pending: true }))], [options, pending]);

  const entries = useMemo<Entry[]>(() => {
    const q = normalizeGemName(query);
    const typed = query.trim();
    const exactNorm = typed !== "" && all.some((o) => normalizeGemName(o.name) === q);
    const near = typed === "" ? [] : findSimilarGemNames(typed, all.map((o, i) => ({ id: String(i), name: o.name })), 3).similar.map((s) => all[Number(s.id)]);
    const nearKeys = new Set(near.map((n) => `${n.id ?? "new"}:${n.name}`));
    const rest = all.filter((o) => (q === "" || normalizeGemName(o.name).includes(q)) && !nearKeys.has(`${o.id ?? "new"}:${o.name}`));
    const out: Entry[] = [
      ...near.map((o): Entry => ({ t: "opt", key: `n-${o.id ?? "new"}-${o.name}`, id: o.id, name: o.name, hasLength: o.hasLength, pending: o.pending, group: "near" })),
      ...rest.map((o): Entry => ({ t: "opt", key: `a-${o.id ?? "new"}-${o.name}`, id: o.id, name: o.name, hasLength: o.hasLength, pending: o.pending, group: "all" })),
    ];
    if (typed !== "" && !exactNorm) out.push({ t: "add", key: "add", name: typed.replace(/\s+/g, " ") });
    return out;
  }, [all, query]);

  const nearCount = entries.filter((e) => e.t === "opt" && e.group === "near").length;
  const allCount = entries.filter((e) => e.t === "opt" && e.group === "all").length;

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // popover: คลิกนอกกรอบ = ปิด (Modal ซ้อนอยู่ใน DOM ของกรอบ จึงไม่ถูกนับเป็นนอกกรอบ)
  useEffect(() => {
    if (!open || presentation !== "popover") return;
    function onDown(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, presentation]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    setQuery("");
    setNameError(null);
    if (refocus) trigger.current?.focus();
  }

  function choose(o: { id: string | null; name: string; hasLength?: boolean }) {
    if (props.kind === "type") {
      props.onSelect(o.id ? { kind: "existing", id: o.id, name: o.name } : { kind: "new", name: o.name });
    } else {
      const hasLength = o.hasLength === true;
      props.onSelect(o.id ? { kind: "existing", id: o.id, name: o.name, hasLength } : { kind: "new", name: o.name, hasLength });
    }
    close();
  }

  function addNew(raw: string) {
    const c = cleanGemName(raw);
    if (!c.ok) {
      setNameError(c.message);
      return;
    }
    setNameError(null);
    const named = all.map((o, i) => ({ id: String(i), name: o.name }));
    const hit = findSimilarGemNames(c.value, named, 3);
    if (hit.exact) {
      const o = all[Number(hit.exact.id)];
      onNotice?.(`${KIND_TH[kind]} “${c.value}” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “${o.name}” ให้`);
      choose(o);
      return;
    }
    if (hit.similar.length > 0) {
      setSimilar({ typed: c.value, matches: hit.similar.map((s) => ({ id: all[Number(s.id)].id, name: all[Number(s.id)].name })) });
      return;
    }
    finishNew(c.value);
  }

  function finishNew(name: string) {
    if (kind === "shape") {
      setAskShape(name);
      return;
    }
    choose({ id: null, name });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(entries.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const en = entries[active];
      if (!en) return;
      if (en.t === "add") addNew(en.name);
      else choose({ id: en.id, name: en.name, hasLength: en.hasLength });
    }
  }

  const display = props.value?.name ?? null;
  const isNew = props.value?.kind === "new";
  const panelBase = presentation === "sheet" ? "fixed inset-0 z-50 flex flex-col bg-white" : "absolute left-0 z-30 mt-1 w-72 max-w-[90vw] rounded-md border border-zinc-300 bg-white shadow-lg";

  return (
    <div
      ref={root}
      className="relative"
      // popover: โฟกัสออกนอกกรอบ (Tab ไปช่องอื่น) = ปิด · กล่องซ้อน (Modal ถามชื่อคล้าย/ถามขนาด) อยู่ใน DOM ของกรอบนี้ จึงไม่นับเป็น "ออก"
      onBlur={(e) => {
        if (open && presentation === "popover" && !root.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget !== null) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        id={`${id}-btn`}
        disabled={disabled}
        aria-haspopup={presentation === "sheet" ? "dialog" : "listbox"}
        aria-expanded={open}
        aria-label={`${label}${display ? `: ${display}` : ""}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : setOpen(true))}
        className={`${GEM_FIELD} flex items-center justify-between gap-2 text-left ${presentation === "sheet" ? "min-h-14" : ""}`}
      >
        <span className={`min-w-0 break-words [overflow-wrap:anywhere] ${display ? "" : "text-zinc-600"}`}>
          {display ?? `เลือก${KIND_TH[kind]}`}
          {isNew && <span className="ml-1 rounded-sm bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950">ใหม่</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
      </button>

      {open && (
        <div
          className={panelBase}
          data-testid={`${id}-panel`}
          onKeyDown={onKey}
          // คลิกในแผ่น (พื้นที่ว่าง/หัวกลุ่ม/แถบเลื่อน) ไม่ให้ช่องค้นหาเสียโฟกัส — ไม่งั้นถูกนับว่าออกนอกกรอบแล้วปิด
          onMouseDown={(e) => {
            if (e.target !== input.current && !(e.target as HTMLElement).closest("button")) e.preventDefault();
          }}
          {...(presentation === "sheet" ? { role: "dialog", "aria-modal": true, "aria-label": `เลือก${KIND_TH[kind]}` } : {})}
        >
          <div className={presentation === "sheet" ? "flex items-center gap-2 border-b border-zinc-200 p-2" : "p-2"}>
            {presentation === "sheet" && (
              <button type="button" onClick={() => close()} className="min-h-14 min-w-14 text-lg font-semibold text-zinc-900" aria-label="กลับ">
                ‹
              </button>
            )}
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={entries[active] ? `${listId}-${active}` : undefined}
              aria-label={`ค้นหาหรือพิมพ์ชื่อ${KIND_TH[kind]}`}
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setNameError(null);
              }}
              placeholder={kind === "type" ? "ค้นหาหรือพิมพ์ชื่อ เช่น โกเมน" : "ค้นหาหรือพิมพ์ชื่อ เช่น กลม"}
              maxLength={80}
              className={`${GEM_FIELD} ${presentation === "sheet" ? "min-h-14" : ""}`}
            />
          </div>

          {loading && (
            <div role="status" aria-label={`กำลังโหลดรายการ${KIND_TH[kind]}`} className="space-y-1.5 p-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
          {loadError && !loading && (
            <div role="status" className="m-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-950">
              โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้
              {onRetry && (
                <button type="button" onClick={onRetry} className="ml-2 min-h-11 px-2 font-semibold underline">
                  ลองอีกครั้ง
                </button>
              )}
            </div>
          )}

          <ul id={listId} role="listbox" aria-label={`รายการ${KIND_TH[kind]}`} className={`${presentation === "sheet" ? "flex-1" : "max-h-64"} overflow-y-auto`}>
            {entries.map((e, i) => {
              const prevGroup = i > 0 ? entries[i - 1] : null;
              const head =
                e.t === "opt" && (i === 0 || (prevGroup && prevGroup.t === "opt" && prevGroup.group !== e.group) || (prevGroup && prevGroup.t === "add"))
                  ? e.group === "near"
                    ? "ใกล้เคียงที่พิมพ์"
                    : nearCount > 0 || query === ""
                      ? `ทั้งหมด (${allCount})`
                      : null
                  : null;
              return (
                <li key={e.key} role="presentation">
                  {head && <p className="px-3 pt-2 text-xs font-semibold text-zinc-700">{head}</p>}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // ไม่ให้ช่องค้นหาเสียโฟกัสตอนคลิกตัวเลือก (combobox มาตรฐาน — กันถูกนับว่า "ออกจากแถว")
                    onClick={() => (e.t === "add" ? addNew(e.name) : choose({ id: e.id, name: e.name, hasLength: e.hasLength }))}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-base break-words [overflow-wrap:anywhere] ${i === active ? "bg-primary-100 text-zinc-900" : "text-zinc-900 hover:bg-zinc-50"} ${e.t === "add" ? "border-t border-dashed border-zinc-300 font-medium" : ""} ${presentation === "sheet" ? "min-h-14" : ""}`}
                  >
                    {e.t === "add" ? (
                      <>
                        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>เพิ่ม “{e.name}” เป็น{KIND_TH[kind]}ใหม่</span>
                      </>
                    ) : (
                      <>
                        <span>{e.name}</span>
                        {e.pending && <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950">ใหม่</span>}
                        {kind === "shape" && e.hasLength !== undefined && <span className="ml-auto shrink-0 text-xs text-zinc-700">{e.hasLength ? "2 ค่า" : "1 ค่า"}</span>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {entries.length === 0 && !loading && (
            <p className="px-3 py-3 text-sm text-zinc-800">
              {query.trim() === ""
                ? all.length === 0
                  ? `ยังไม่มี${KIND_TH[kind]}ในระบบ — พิมพ์ชื่อแรกได้เลย ชื่อที่ใส่จะอยู่ในรายการให้คนถัดไป`
                  : "ไม่พบรายการ"
                : "ไม่พบรายการที่ตรงกัน"}
            </p>
          )}
          {nameError && (
            <p role="alert" className="mx-2 mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800">
              {nameError}
            </p>
          )}
          {allCount === 0 && nearCount === 0 && all.length === 0 && entries.length > 0 && !loading && (
            <p className="px-3 pb-2 text-xs text-zinc-700">ยังไม่มี{KIND_TH[kind]}ในระบบ — ชื่อที่เพิ่มจะอยู่ในรายการให้คนถัดไป</p>
          )}
        </div>
      )}

      {similar && (
        <GemSimilarPrompt
          typed={similar.typed}
          kindLabel={KIND_TH[kind]}
          matches={similar.matches}
          onUse={(m) => {
            const o = all.find((x) => x.id === m.id && x.name === m.name) ?? { id: m.id, name: m.name, hasLength: undefined };
            onNotice?.(`ใช้ “${m.name}” ที่มีอยู่แล้วแทน “${similar.typed}”`);
            setSimilar(null);
            choose(o);
          }}
          onForce={() => {
            const typed = similar.typed;
            setSimilar(null);
            onForceSimilar?.();
            finishNew(typed);
          }}
          onCancel={() => setSimilar(null)}
        />
      )}
      {askShape && (
        <GemNewShapeAsk
          name={askShape}
          onCancel={() => setAskShape(null)}
          onConfirm={(hasLength) => {
            const name = askShape;
            setAskShape(null);
            choose({ id: null, name, hasLength });
          }}
        />
      )}
    </div>
  );
}
