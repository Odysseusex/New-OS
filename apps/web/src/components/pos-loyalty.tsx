"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, UserRound, X } from "lucide-react";
import type { LoyaltyFamilyMemberDto, LoyaltyMemberDto } from "@bakery-os/shared";
import { formatKzPhone, KZ_PHONE_INVALID_MESSAGE, LoyaltyMemberStatus, normalizeKzPhone } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoneyPrecise, formatPoints } from "@/lib/format";
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
    return (
      <div className="rounded-xl border border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {formatKzPhone(member.phone)}
              {member.name ? ` · ${member.name}` : ""}
            </p>
            <p className="text-xs text-muted">
              Баллов: {formatPoints(member.pointsBalance)}
              {member.pointsPending &&
                ` · ещё ${formatPoints(member.pointsPending.points)} с ${new Date(member.pointsPending.from).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit" })}`}
            </p>
          </div>
          <button
            onClick={() => setBirthdaysOpen(true)}
            aria-label="Дни рождения"
            title="Дни рождения"
            className="ml-auto shrink-0 text-muted transition hover:text-accent"
          >
            <Cake className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            onClick={() => {
              onMemberChange(null);
              onPointsChange(0);
            }}
            aria-label="Убрать клиента"
            className="shrink-0 text-muted transition hover:text-red-600"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        {member.pointsBalance > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPointsPad(true)}
              disabled={cap <= 0}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-left text-sm transition hover:bg-surface-muted disabled:opacity-40"
            >
              {pointsToRedeem > 0 ? (
                <span className="font-medium text-foreground">Списать {formatPoints(pointsToRedeem)}</span>
              ) : (
                <span className="text-muted">Списать баллов</span>
              )}
            </button>
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
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
      >
        <UserRound className="h-4 w-4" strokeWidth={1.75} />
        Клиент бонусной программы
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
