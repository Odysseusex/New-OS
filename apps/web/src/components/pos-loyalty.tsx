"use client";

import { useState } from "react";
import { UserRound, X } from "lucide-react";
import type { LoyaltyMemberDto } from "@bakery-os/shared";
import { formatKzPhone, KZ_PHONE_INVALID_MESSAGE, LoyaltyMemberStatus, normalizeKzPhone } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoneyPrecise, formatPoints } from "@/lib/format";
import { LoyaltyRegisterModal } from "@/components/loyalty-register-modal";

// The loyalty member on the current order: found by phone, then optionally
// paying part of the check with points. The discount itself is worked out by
// the till page with the same shared function the server uses.
export function PosLoyaltyBlock({
  member,
  onMemberChange,
  pointsToRedeem,
  onPointsChange,
  cap,
  discount,
}: {
  member: LoyaltyMemberDto | null;
  onMemberChange: (member: LoyaltyMemberDto | null) => void;
  pointsToRedeem: number;
  onPointsChange: (points: number) => void;
  cap: number;
  discount: number;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [registerPhone, setRegisterPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pointsText, setPointsText] = useState("");

  function attach(found: LoyaltyMemberDto) {
    if (found.status !== LoyaltyMemberStatus.ACTIVE) {
      setError("Клиент не участвует в программе: нет согласия на обработку персональных данных");
      return;
    }
    onMemberChange(found);
    setOpen(false);
    setPhone("");
    setNotFound(null);
    setError(null);
  }

  async function find() {
    setError(null);
    setNotFound(null);
    if (!normalizeKzPhone(phone)) {
      setError(KZ_PHONE_INVALID_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const result = await api.loyalty.lookup(phone);
      if (result.member) attach(result.member);
      else setNotFound(result.phone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось найти клиента");
    } finally {
      setBusy(false);
    }
  }

  function setPoints(value: number) {
    const clamped = Math.max(0, Math.min(value, cap));
    onPointsChange(clamped);
    setPointsText(clamped > 0 ? String(clamped) : "");
  }

  if (member) {
    return (
      <div className="rounded-xl border border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {formatKzPhone(member.phone)}
              {member.name ? ` · ${member.name}` : ""}
            </p>
            <p className="text-xs text-muted">Баллов: {formatPoints(member.pointsBalance)}</p>
          </div>
          <button
            onClick={() => {
              onMemberChange(null);
              onPointsChange(0);
              setPointsText("");
            }}
            aria-label="Убрать клиента"
            className="shrink-0 text-muted transition hover:text-red-600"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {member.pointsBalance > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={pointsText}
              onChange={(e) => {
                const text = e.target.value.replace(",", ".");
                setPointsText(e.target.value);
                const value = Number(text);
                onPointsChange(Number.isFinite(value) ? Math.max(0, Math.min(value, cap)) : 0);
              }}
              onBlur={() => setPoints(pointsToRedeem)}
              placeholder="Списать баллов"
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              onClick={() => setPoints(cap)}
              disabled={cap <= 0}
              className="shrink-0 rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-40"
            >
              Макс. {formatPoints(cap)}
            </button>
          </div>
        )}
        {discount > 0 && <p className="mt-1.5 text-xs font-medium text-accent">Оплата баллами: −{formatMoneyPrecise(discount)}</p>}
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
        >
          <UserRound className="h-4 w-4" strokeWidth={1.75} />
          Клиент бонусной программы
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="tel"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                find();
              }
            }}
            placeholder="Телефон клиента"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={find}
            disabled={busy}
            className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-40"
          >
            Найти
          </button>
          <button onClick={() => setOpen(false)} aria-label="Закрыть" className="shrink-0 text-muted transition hover:text-foreground">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      {notFound && (
        <p className="mt-1.5 text-xs text-muted">
          Номер {formatKzPhone(notFound)} не зарегистрирован.{" "}
          <button onClick={() => setRegisterPhone(notFound)} className="font-medium text-accent hover:underline">
            Зарегистрировать
          </button>
        </p>
      )}
      {registerPhone !== null && (
        <LoyaltyRegisterModal
          initialPhone={registerPhone}
          onClose={() => setRegisterPhone(null)}
          onSaved={(saved) => {
            setRegisterPhone(null);
            attach(saved);
          }}
        />
      )}
    </div>
  );
}
