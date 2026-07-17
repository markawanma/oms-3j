"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { searchProductsForLive } from "@/lib/actions/quick-order";
import type { ProductSearchRow } from "@/lib/types";

/**
 * SKU search combobox — debounced (250ms) server search + keyboard nav
 * (Up/Down to move, Enter to select, Escape to close). Kept as a
 * self-contained, uncontrolled-input component: the parent only cares about
 * onSelect firing with the chosen product, then clears/refocuses this via
 * `resetKey` (bump it to force the input to clear after each add).
 */
export function ProductSearchCombobox({
  onSelect,
  resetKey,
}: {
  onSelect: (product: ProductSearchRow) => void;
  resetKey: number;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ProductSearchRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setTerm("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }, [resetKey]);

  useEffect(() => {
    if (!term.trim()) {
      setResults([]);
      setOpen(false);
      setError(null);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      const result = await searchProductsForLive(term);
      if (currentRequest !== requestId.current) return; // stale response, dropped
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setResults([]);
        return;
      }
      setError(null);
      setResults(result.data);
      setOpen(true);
      setActiveIndex(result.data.length > 0 ? 0 : -1);
    }, 250);

    return () => clearTimeout(handle);
  }, [term]);

  function selectProduct(product: ProductSearchRow) {
    onSelect(product);
    setTerm("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        selectProduct(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor="sku-search" className="block text-sm font-medium text-slate-700">
        ค้นหาสินค้า (SKU หรือ ชื่อ)
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id="sku-search"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="sku-search-listbox"
          aria-autocomplete="list"
          autoComplete="off"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="พิมพ์ SKU หรือชื่อสินค้า..."
          className="min-h-11 w-full rounded-md border border-slate-300 pl-9 pr-3 text-base focus-visible:border-primary-600"
        />
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {open && (
        <ul
          id="sku-search-listbox"
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-sm text-slate-400">กำลังค้นหา...</li>}
          {!loading && results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">ไม่พบสินค้า</li>}
          {!loading &&
            results.map((product, index) => (
              <li key={product.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // preventDefault so the input doesn't lose focus before onClick fires
                    e.preventDefault();
                    selectProduct(product);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    index === activeIndex ? "bg-primary-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-slate-900">{product.name}</span>{" "}
                    <span className="text-slate-400">({product.sku})</span>
                  </span>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      product.available <= 0 ? "text-red-600" : "text-slate-500"
                    }`}
                  >
                    เหลือ {product.available}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
