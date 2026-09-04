"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { ConsignmentBalanceDto, ConsignmentDetailDto } from "@bakery-os/shared";
import { CONSIGNMENT_PAY_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Modal } from "@/components/modal";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";

// Расчёты по товарам под реализацию — what we owe the people whose goods we
// sell, and paying it.
//
// The number here is never typed by anyone: it is every sale of their goods
// at the price snapshotted on that sale, minus returns, minus what has
// already been paid. The per-product breakdown exists so the owner can check
// the total against something concrete instead of trusting one figure.
export function ConsignmentTab() {
  const { user } = useAuth();
  const canPay = user ? CONSIGNMENT_PAY_ROLES.includes(user.role) : false;

  const [balances, setBalances] = useState<ConsignmentBalanceDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);
  const [payingFor, setPayingFor] = useState<ConsignmentBalanceDto | null>(null);

  const load = useCallback(() => {
    setState("loading");
    api.consignment
      .balances()
      .then((data) => {
        setBalances(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  const totalOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error") return <p className="text-sm text-red-700">Не удалось загрузить расчёты</p>;

  if (balances.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted">
          Пока нет товаров под реализацию. Отметьте товар как «Товар под реализацию» в его карточке
          (Склад — Номенклатура) и укажите поставщика и цену поставщику — долг начнёт считаться сам с
          первой продажи.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">Итого к выплате</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(totalOwed)}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Поставщик</th>
              <th className="px-4 py-3 text-right font-medium">Продано</th>
              <th className="px-4 py-3 text-right font-medium">Возвращено</th>
              <th className="px-4 py-3 text-right font-medium">Выплачено</th>
              <th className="px-4 py-3 text-right font-medium">Долг</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {balances.map((row) => (
              <tr key={row.supplierId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <button
                    onClick={() => setOpenSupplierId(row.supplierId)}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {row.supplierName}
                  </button>
                  {row.lastPaidAt && (
                    <p className="mt-0.5 text-xs text-muted">
                      Последняя выплата {formatDateTime(row.lastPaidAt)}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-muted">{formatMoney(row.soldAmount)}</td>
                <td className="px-4 py-3 text-right text-muted">
                  {row.returnedAmount > 0 ? `−${formatMoney(row.returnedAmount)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-muted">{formatMoney(row.paidAmount)}</td>
                <td
                  className={clsx(
                    "px-4 py-3 text-right font-semibold",
                    row.balance > 0 ? "text-foreground" : "text-muted",
                  )}
                >
                  {formatMoney(row.balance)}
                </td>
                <td className="px-4 py-3 text-right">
                  {canPay && row.balance > 0 && (
                    <button
                      onClick={() => setPayingFor(row)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-muted"
                    >
                      Выплатить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Долг считается по факту продаж: продали — должны, вернули покупателю — долг уменьшился. Эта же
        сумма входит в кредиторскую задолженность, а цена поставщику учитывается как себестоимость в
        отчёте «Прибыли и убытки».
      </p>

      {openSupplierId && (
        <ConsignmentDetailModal supplierId={openSupplierId} onClose={() => setOpenSupplierId(null)} />
      )}
      {payingFor && (
        <PayModal
          balance={payingFor}
          onClose={() => setPayingFor(null)}
          onPaid={() => {
            setPayingFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ConsignmentDetailModal({
  supplierId,
  onClose,
}: {
  supplierId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ConsignmentDetailDto | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");

  useEffect(() => {
    api.consignment
      .detail(supplierId)
      .then((data) => {
        setDetail(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [supplierId]);

  return (
    <Modal title={detail?.supplierName ?? "Расчёты по реализации"} onClose={onClose} width="max-w-2xl">
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="text-sm text-red-700">Не удалось загрузить</p>}
      {state === "ready" && detail && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-muted">Продано</p>
              <p className="text-base font-semibold text-foreground">{formatMoney(detail.soldAmount)}</p>
            </div>
            <div>
              <p className="text-muted">Выплачено</p>
              <p className="text-base font-semibold text-foreground">{formatMoney(detail.paidAmount)}</p>
            </div>
            <div>
              <p className="text-muted">Долг</p>
              <p className="text-base font-semibold text-foreground">{formatMoney(detail.balance)}</p>
            </div>
          </div>

          <p className="mb-2 text-sm font-medium text-foreground">По товарам</p>
          <div className="mb-5 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Товар</th>
                  <th className="px-3 py-2 text-right font-medium">Цена</th>
                  <th className="px-3 py-2 text-right font-medium">Продано</th>
                  <th className="px-3 py-2 text-right font-medium">Возврат</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((row) => (
                  <tr key={`${row.productId}:${row.unitCost}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-foreground">{row.productName}</td>
                    <td className="px-3 py-2 text-right text-muted">{formatMoney(row.unitCost)}</td>
                    <td className="px-3 py-2 text-right text-muted">{formatQuantity(row.quantitySold)}</td>
                    <td className="px-3 py-2 text-right text-muted">
                      {row.quantityReturned > 0 ? formatQuantity(row.quantityReturned) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">
                      {formatMoney(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-2 text-sm font-medium text-foreground">Выплаты</p>
          {detail.payments.length === 0 ? (
            <p className="text-sm text-muted">Выплат ещё не было</p>
          ) : (
            <ul className="space-y-2">
              {detail.payments.map((p) => (
                <li key={p.id} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-foreground">{formatMoney(p.amount)}</span>
                    <span className="text-xs text-muted">{formatDateTime(p.paidAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {p.createdByName}
                    {p.note ? ` · ${p.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

function PayModal({
  balance,
  onClose,
  onPaid,
}: {
  balance: ConsignmentBalanceDto;
  onClose: () => void;
  onPaid: () => void;
}) {
  // Pre-filled with the whole debt, which is what a payout usually is —
  // but editable, because partial payouts are normal too.
  const [amount, setAmount] = useState(String(balance.balance));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= balance.balance;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.consignment.pay({
        supplierId: balance.supplierId,
        amount: value,
        note: note.trim() || undefined,
      });
      onPaid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести выплату");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Выплата — ${balance.supplierName}`} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit}>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-muted">Долг</span>
          <span className="text-xl font-semibold text-foreground">{formatMoney(balance.balance)}</span>
        </div>

        <label className="mb-1.5 block text-sm font-medium text-foreground">Сумма выплаты, ₸</label>
        <input
          type="number"
          min="0"
          step="any"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <p className="mt-1.5 text-xs text-muted">
          Больше долга указать нельзя — это почти всегда опечатка. Можно выплатить часть.
        </p>

        <label className="mb-1.5 mt-4 block text-sm font-medium text-foreground">Комментарий</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Необязательно"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />

        {error && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={!valid || isSubmitting}
          className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {isSubmitting ? "Проводим…" : "Провести выплату"}
        </button>
      </form>
    </Modal>
  );
}
