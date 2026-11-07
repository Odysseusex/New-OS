"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Cake, Plus, UserRound, X } from "lucide-react";
import type { LoyaltyFamilyMemberDto, LoyaltyMemberDto } from "@bakery-os/shared";
import { formatKzPhone, KZ_PHONE_INVALID_MESSAGE, LoyaltyMemberStatus, normalizeKzPhone } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatPoints } from "@/lib/format";
import { LoyaltyRegisterModal } from "@/components/loyalty-register-modal";
import { LoyaltyFamilySection } from "@/components/loyalty-family-section";
import { Modal } from "@/components/modal";
import { NumberKeypadModal, PhoneKeypadModal } from "@/components/numeric-keypad";

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
  // The ten digits after «+7», typed on the till's own pad.
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [registerPhone, setRegisterPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pointsPad, setPointsPad] = useState(false);
  const [birthdaysOpen, setBirthdaysOpen] = useState(false);

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
    const full = `+7${phone}`;
    if (!normalizeKzPhone(full)) {
      setError(KZ_PHONE_INVALID_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const result = await api.loyalty.lookup(full);
      if (result.member) attach(result.member);
      else setNotFound(result.phone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось найти клиента");
    } finally {
      setBusy(false);
    }
  }

  function setPoints(value: number) {
    onPointsChange(Math.max(0, Math.min(value, cap)));
  }

  if (member) {
    const on = pointsToRedeem > 0;
    const pending = member.pointsPending
      ? `ещё ${formatPoints(member.pointsPending.points)} с ${new Date(member.pointsPending.from).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit" })}`
      : null;
    return (
      <div className="rounded-[1.125rem] border border-border p-3.5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-base font-semibold text-accent">
            {(member.name ?? "К").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{member.name || "Клиент"}</p>
            <p className="truncate text-[0.8125rem] text-muted">{formatKzPhone(member.phone)}</p>
          </div>
          <div className="shrink-0 text-right leading-tight">
            <p className="text-lg font-semibold text-accent">{formatPoints(member.pointsBalance)}</p>
            <p className="text-xs text-muted">баллов</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1 border-l border-border pl-2">
            <button onClick={() => setBirthdaysOpen(true)} aria-label="Дни рождения" title="Дни рождения" className="rounded-lg p-1 text-muted transition hover:text-accent">
              <Cake className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => {
                onMemberChange(null);
                onPointsChange(0);
              }}
              aria-label="Убрать клиента"
              title="Убрать клиента"
              className="rounded-lg p-1 text-muted transition hover:text-red-600"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        {member.pointsBalance > 0 && (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-background px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => setPointsPad(true)}
              disabled={cap <= 0}
              className="min-w-0 flex-1 text-left text-[0.9375rem] text-foreground disabled:opacity-40"
            >
              {cap <= 0 ? (
                <span className="text-muted">Списать баллами нельзя: в чеке нет товаров по полной цене</span>
              ) : (
                <>
                  Списать баллами <b className="font-semibold">{formatMoney(on ? discount || pointsToRedeem : cap)}</b>
                  {on && pointsToRedeem < cap && <span className="ml-1.5 text-xs text-muted">из {formatPoints(cap)}</span>}
                </>
              )}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Списать баллами"
              disabled={cap <= 0}
              onClick={() => setPoints(on ? 0 : cap)}
              className={clsx("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40", on ? "bg-accent" : "bg-[var(--border-strong,#d1d5db)]")}
            >
              <span className={clsx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
            </button>
          </div>
        )}
        {pending && <p className="mt-2 px-1 text-xs text-muted">Бонус ждёт: {pending}</p>}
        {pointsPad && (
          <NumberKeypadModal
            title="Списать баллов"
            initial={pointsToRedeem}
            max={Math.floor(cap)}
            unit="баллов"
            onClose={() => setPointsPad(false)}
            onDone={(value) => {
              setPoints(value);
              setPointsPad(false);
            }}
          />
        )}
        {birthdaysOpen && <PosBirthdaysModal memberId={member.id} onClose={() => setBirthdaysOpen(false)} />}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          setPhone("");
          setError(null);
          setNotFound(null);
          setOpen(true);
        }}
        className="flex w-full items-center gap-3 rounded-[1.125rem] border border-dashed border-[var(--border-strong,#d1d5db)] px-3.5 py-3 text-left transition hover:bg-surface-muted"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-accent">
          <UserRound className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold text-foreground">Бонусный клиент</span>
          <span className="block text-[0.8125rem] text-muted">Добавить по номеру телефона</span>
        </span>
        <Plus className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} />
      </button>
      {open && (
        <PhoneKeypadModal
          title="Телефон клиента"
          digits={phone}
          onDigitsChange={(next) => {
            setPhone(next);
            setError(null);
            setNotFound(null);
          }}
          onSubmit={find}
          onClose={() => setOpen(false)}
          submitLabel="Найти клиента"
          busy={busy}
          error={error}
        >
          {notFound && (
            <div className="mt-3 rounded-2xl bg-surface-muted px-4 py-3 text-center">
              <p className="text-sm text-foreground">Номер {formatKzPhone(notFound)} не зарегистрирован</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setRegisterPhone(notFound);
                }}
                className="mt-2 h-11 w-full rounded-xl border border-accent text-base font-semibold text-accent transition hover:bg-accent/10"
              >
                Зарегистрировать
              </button>
            </div>
          )}
        </PhoneKeypadModal>
      )}
      {registerPhone !== null && (
        <LoyaltyRegisterModal
          initialPhone={registerPhone}
          keypad
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

// The cashier can add birthdays (the holder and family) while the customer is at
// the counter; removing them is done in Клиенты.
function PosBirthdaysModal({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const [family, setFamily] = useState<LoyaltyFamilyMemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.loyalty
      .findOne(memberId)
      .then((m) => setFamily(m.family))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить клиента"));
  }, [memberId]);
  useEffect(load, [load]);
  return (
    <Modal title="Дни рождения" onClose={onClose}>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!family && !error && <p className="text-sm text-muted">Загрузка…</p>}
      {family && <LoyaltyFamilySection memberId={memberId} family={family} editable canRemove={false} onChanged={load} keypad />}
    </Modal>
  );
}
