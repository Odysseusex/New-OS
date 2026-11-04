"use client";

import { useState } from "react";
import clsx from "clsx";
import type { ManualDiscountDto, TillApprovalAction } from "@bakery-os/shared";
import { TILL_APPROVAL_ACTION_LABELS_RU, manualDiscountTarget } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";
import { formatMoney } from "@/lib/format";

const input =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-center text-lg tracking-widest text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function PinField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      placeholder="PIN"
      aria-label="PIN"
      className={input}
    />
  );
}

// A senior cashier types their PIN on a cashier's till to approve one action.
export function SeniorPinModal({
  action,
  locationId,
  detail,
  onApproved,
  onClose,
}: {
  action: TillApprovalAction;
  locationId?: string;
  detail?: string;
  onApproved: (token: string, approverName: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`${TILL_APPROVAL_ACTION_LABELS_RU[action]} — PIN старшего кассира`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const r = await api.tillPin.approve({ pin, action, locationId, detail });
            onApproved(r.approvalToken, r.approverName);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Не удалось подтвердить");
            setPin("");
          } finally {
            setBusy(false);
          }
        }}
      >
        {detail && <p className="mb-3 text-sm text-muted">{detail}</p>}
        <PinField value={pin} onChange={setPin} autoFocus />
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" data-submit disabled={busy || pin.length < 4} className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Проверяем…" : "Подтвердить"}
        </button>
      </form>
    </Modal>
  );
}

// «Сменить кассира»: another employee's PIN takes over this till.
export function PinLoginModal({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Сменить кассира" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const r = await api.tillPin.login(pin);
            localStorage.setItem("bakery_token", r.accessToken);
            window.location.assign("/pos");
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Не удалось войти");
            setPin("");
            setBusy(false);
          }
        }}
      >
        <PinField value={pin} onChange={setPin} autoFocus />
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" data-submit disabled={busy || pin.length < 4} className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </Modal>
  );
}

export interface AppliedDiscount extends ManualDiscountDto {
  approvalToken?: string;
  approverName: string | null;
}

// «Скидка на чек»: a percent or a sum. A cashier needs a senior cashier's PIN in the same window.
export function CheckDiscountModal({
  base,
  needsApproval,
  locationId,
  onApply,
  onClose,
}: {
  base: number;
  needsApproval: boolean;
  locationId?: string;
  onApply: (discount: AppliedDiscount) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.replace(",", "."));
  const discount: ManualDiscountDto = kind === "percent" ? { percent: n } : { amount: n };
  const valid = Number.isFinite(n) && n > 0 && (kind === "amount" || n <= 100);
  const preview = valid ? manualDiscountTarget(base, discount) : 0;

  return (
    <Modal title="Скидка на чек" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || preview <= 0) return;
          setError(null);
          if (!needsApproval) {
            onApply({ ...discount, approverName: null });
            return;
          }
          setBusy(true);
          try {
            const r = await api.tillPin.approve({ pin, action: "DISCOUNT", locationId, detail: `${kind === "percent" ? `${n}%` : formatMoney(n)} на чек` });
            onApply({ ...discount, approvalToken: r.approvalToken, approverName: r.approverName });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Не удалось подтвердить");
            setPin("");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-3 flex rounded-xl bg-surface-muted p-0.5">
          {(["percent", "amount"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx("flex-1 rounded-lg px-3 py-1.5 text-sm", kind === k ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted")}
            >
              {k === "percent" ? "Процент" : "Сумма, ₸"}
            </button>
          ))}
        </div>
        <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input} placeholder={kind === "percent" ? "%" : "₸"} />
        {valid && <p className="mt-2 text-sm text-muted">Скидка: {formatMoney(preview)} из {formatMoney(base)}</p>}
        {needsApproval && (
          <div className="mt-4">
            <p className="mb-1.5 text-sm font-medium text-foreground">PIN старшего кассира</p>
            <PinField value={pin} onChange={setPin} />
          </div>
        )}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          data-submit
          disabled={busy || !valid || preview <= 0 || (needsApproval && pin.length < 4)}
          className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Проверяем…" : "Применить скидку"}
        </button>
      </form>
    </Modal>
  );
}
