"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ProductDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";

// Product picker with a search box. The whole catalogue is already loaded
// client-side (api.products.list returns every product, no paging), so
// filtering is a plain in-memory substring match — no request per keystroke,
// and therefore no debounce to add.
//
// Shared rather than copied: the stock movement form and the recipe form ask
// the same question of the same list, and the Escape handling below is subtle
// enough that a second copy would eventually drift from it.
export function ProductSelect({
  products,
  value,
  onChange,
  placeholder = "Выберите товар",
  className = "",
}: {
  products: ProductDto[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  // For the caller's layout — the recipe form puts this in a flex row where
  // the picker takes the remaining width.
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = products.find((p) => p.id === value);
  // Matches anywhere in the name, not just the start: "шок" finds
  // «Белый шоколад», "люкс" finds «Дрожжи прессованные "Люкс"».
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? products.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : products;

  // Focus the search box the moment the list opens, so the user can type
  // straight away instead of clicking into it.
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    // Escape must close only this list, not the whole form. The Modal's own
    // Escape handler listens on `document` too, and React delegates its events
    // from `document` as well, so stopping the event from inside a React
    // onKeyDown cannot reach it. Intercepting in the capture phase does: it
    // runs before every bubble-phase listener no matter the registration order.
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setIsOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [isOpen]);

  function select(productId: string) {
    onChange(productId);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <span className={selected ? "" : "text-muted"}>
          {selected ? `${selected.name} (${UNIT_LABELS_RU[selected.unit]})` : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // This picker sits inside a <form>, so a bare Enter would
                // submit it instead of picking a product.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0) select(filtered[0].id);
                }
                // Escape is handled by the capture-phase listener above.
              }}
              placeholder="Поиск товара…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onClick={() => select(p.id)}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-surface-muted ${
                    p.id === value ? "text-accent" : "text-foreground"
                  }`}
                >
                  {p.name} ({UNIT_LABELS_RU[p.unit]})
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-3 text-sm text-muted">Ничего не найдено</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
