"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ProductDto } from "@bakery-os/shared";
import { UNIT_LABELS_RU } from "@bakery-os/shared";
import { ENTER_ATTR, focusNextField } from "@/lib/keyboard";

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
  enterFlow = false,
}: {
  products: ProductDto[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  // For the caller's layout — the recipe form puts this in a flex row where
  // the picker takes the remaining width.
  className?: string;
  // Part of a document's keyboard flow (lib/keyboard): Enter from the previous
  // field opens this picker, and choosing a product moves on to the next field.
  enterFlow?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The list is placed on the screen itself (position: fixed), not inside the form: a short window (one line in
  // «Выпуск за день») or a scrolling table used to clip it so that no product was visible. It opens below the
  // field, or above it when there is more room there, and follows the field while the page scrolls.
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; listMax: number } | null>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewHeight = window.visualViewport?.height ?? window.innerHeight;
      const below = viewHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const up = below < 260 && above > below;
      const room = up ? above : below;
      const listMax = Math.max(120, Math.min(240, room - 64));
      setPlace(
        up
          ? { left: rect.left, width: rect.width, bottom: viewHeight - rect.top + 4, listMax }
          : { left: rect.left, width: rect.width, top: rect.bottom + 4, listMax },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [isOpen]);

  // Focus the search box the moment the list is on screen, so the user can type straight away.
  const placed = place !== null;
  useEffect(() => {
    if (isOpen && placed) searchRef.current?.focus();
  }, [isOpen, placed]);
  useEffect(() => {
    if (!isOpen) setPlace(null);
  }, [isOpen]);

  const selected = products.find((p) => p.id === value);
  // Matches anywhere in the name, not just the start: "шок" finds
  // «Белый шоколад», "люкс" finds «Дрожжи прессованные "Люкс"».
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? products.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
    : products;



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

  // The highlighted row follows the search; arrows move it.
  useEffect(() => setActive(0), [query, isOpen]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function select(productId: string) {
    onChange(productId);
    setIsOpen(false);
    setQuery("");
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.focus();
    // After the parent re-renders (a new empty line may appear below).
    if (enterFlow) setTimeout(() => focusNextField(trigger), 0);
  }

  return (
    <div ref={containerRef} className={`product-select relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        {...(enterFlow ? { [ENTER_ATTR]: "open" } : {})}
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
        <div
          className="fixed z-[60] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
          style={place ? { left: place.left, width: place.width, top: place.top, bottom: place.bottom } : { visibility: "hidden" }}
        >
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
                  // With nothing typed, Enter picks nothing: a stray Enter on an
                  // empty line must not drop the first product of the catalogue in.
                  if (normalizedQuery && filtered[active]) select(filtered[active].id);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                }
                // Escape is handled by the capture-phase listener above.
              }}
              placeholder="Поиск товара…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <ul ref={listRef} role="listbox" className="overflow-y-auto py-1" style={{ maxHeight: place?.listMax ?? 240 }}>
            {filtered.map((p, index) => (
              <li key={p.id} data-index={index}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onClick={() => select(p.id)}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-surface-muted ${
                    p.id === value ? "text-accent" : "text-foreground"
                  } ${normalizedQuery && index === active ? "bg-surface-muted" : ""}`}
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
