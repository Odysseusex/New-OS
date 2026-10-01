"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { STOCK_MOVEMENT_TYPE_LABELS_RU, StockMovementType, UNIT_LABELS_RU } from "@bakery-os/shared";
import type { ProductDto, StockVoidCandidateDto, StockVoidDto, StockVoidPreviewDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { Modal } from "@/components/modal";
import { ProductSelect } from "@/components/product-select";

const buttonClass = "rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60";
const ghostButton = "rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-60";

// Аннулирование ошибочного прихода и списания: a receipt that never happened
// and the write-off that only took it away again. Stock does not change; the
// pair stops counting as a loss.
export function StockVoidModal({
  products,
  onClose,
  onDone,
}: {
  products: ProductDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [candidates, setCandidates] = useState<StockVoidCandidateDto[]>([]);
  const [previous, setPrevious] = useState<StockVoidDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<StockVoidPreviewDto | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setPreview(null);
    setConfirming(false);
    setError(null);
    if (!productId) {
      setCandidates([]);
      setPrevious([]);
      return;
    }
    let live = true;
    Promise.all([api.inventory.voidCandidates(productId), api.inventory.voids(productId)])
      .then(([c, v]) => {
        if (!live) return;
        setCandidates(c);
        setPrevious(v);
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Не удалось загрузить движения"));
    return () => {
      live = false;
    };
  }, [productId]);

  useEffect(() => {
    setConfirming(false);
    if (!productId || selected.size === 0) {
      setPreview(null);
      return;
    }
    let live = true;
    api.inventory
      .previewVoid(productId, Array.from(selected))
      .then((p) => live && setPreview(p))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Не удалось проверить выбор"));
    return () => {
      live = false;
    };
  }, [productId, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.inventory.createVoid({ productId, movementIds: Array.from(selected), reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось аннулировать");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!preview?.allowed && reason.trim().length >= 5 && !busy;

  return (
    <Modal title="Аннулирование ошибочного прихода и списания" onClose={onClose} width="max-w-3xl">
      <div className="space-y-4">
        <ProductSelect products={products} value={productId} onChange={setProductId} />

        {productId && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Тип</th>
                  <th className="px-3 py-2 font-medium">Точка</th>
                  <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium">Себестоимость</th>
                  <th className="px-3 py-2 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates.map((c) => (
                  <tr key={c.id} className={clsx(c.blockedReason && "opacity-60")}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        disabled={c.blockedReason !== null}
                        onChange={() => toggle(c.id)}
                        aria-label="Выбрать"
                      />
                    </td>
                    <td className="px-3 py-2 text-muted">{formatDateTime(c.createdAt)}</td>
                    <td className="px-3 py-2">{STOCK_MOVEMENT_TYPE_LABELS_RU[c.type as StockMovementType]}</td>
                    <td className="px-3 py-2 text-muted">{c.locationName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(c.quantity)} {UNIT_LABELS_RU[c.unit]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.unitCost === null ? "—" : formatMoney(c.unitCost)}</td>
                    <td className="px-3 py-2 text-muted">{c.blockedReason ?? c.reason ?? "—"}</td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted">Приходов и списаний нет</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {preview && (
          <div className={clsx("rounded-xl px-4 py-3 text-sm", preview.allowed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
            {preview.allowed ? (
              <>
                <div className="font-medium">Остаток не изменится. Из потерь будет убрано: {formatMoney(preview.lossRemoved)}</div>
                {preview.writeOffsWithoutStampedCost > 0 && (
                  <div>Списаний без зафиксированной себестоимости (по текущей): {preview.writeOffsWithoutStampedCost}</div>
                )}
              </>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                {preview.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="block text-sm text-muted">
          Причина
          <textarea
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {previous.length > 0 && (
          <div className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
            <div className="mb-1 font-medium text-foreground">Уже аннулировано по этому товару</div>
            {previous.map((v) => (
              <div key={v.id}>
                {formatDateTime(v.createdAt)} · {v.createdByName} · движений {v.movements.length} · убрано из потерь {formatMoney(v.lossRemoved)} · {v.reason}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted">
          Действие необратимо: движения останутся в истории с пометкой «аннулировано», но перестанут учитываться как потери.
        </p>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={ghostButton} onClick={onClose}>Отмена</button>
          {!confirming ? (
            <button className={buttonClass} disabled={!canSubmit} onClick={() => setConfirming(true)}>
              Аннулировать
            </button>
          ) : (
            <button className={buttonClass} disabled={busy} onClick={submit}>
              {busy ? "Выполняется…" : "Подтвердить аннулирование"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
