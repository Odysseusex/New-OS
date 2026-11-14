"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, QrCode, ScanLine, Smartphone, UserRound, X } from "lucide-react";
import type { LoyaltyFamilyMemberDto, LoyaltyMemberDto } from "@bakery-os/shared";
import { formatKzPhone, LOYALTY_TIER_LABELS_RU, KZ_PHONE_INVALID_MESSAGE, LoyaltyMemberStatus, normalizeKzPhone } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatMoneyPrecise, formatPoints } from "@/lib/format";
import { LoyaltyFamilySection } from "@/components/loyalty-family-section";
import { Modal } from "@/components/modal";
import { NumberKeypadModal, PhoneKeypadModal } from "@/components/numeric-keypad";

// The loyalty member on the current order: scanned from the customer app's card
// (the till's scan field) or found by phone, then optionally
// paying part of the check with points. The discount itself is worked out by
// the till page with the same shared function the server uses.
export function PosLoyaltyBlock({
  member,
  onMemberChange,
  pointsToRedeem,
  onPointsChange,
  cap,
  discount,
  inviting,
  onInvite,
}: {
  member: LoyaltyMemberDto | null;
  onMemberChange: (member: LoyaltyMemberDto | null) => void;
  // The app's QR on the buyer's screen: a new customer registers in the app,
  // never at the till (owner, 14.11.2026).
  inviting: boolean;
  onInvite: (on: boolean) => void;
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
      else {
        setNotFound(result.phone);
        onInvite(true);
      }
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
            {member.hasApp === false && (
              <button
                type="button"
                onClick={() => onInvite(!inviting)}
                className="mt-0.5 flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
              >
                <Smartphone className="h-3 w-3" strokeWidth={2} />
                {inviting ? "QR приложения на экране покупателя · скрыть" : "Без приложения — показать QR"}
              </button>
            )}
            <p className="text-xs text-muted">
              {member.tier && `${LOYALTY_TIER_LABELS_RU[member.tier.tier]} ${member.tier.percent}% · `}
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
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted">
        <ScanLine className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">Сканируйте QR-код из приложения клиента</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            setPhone("");
            setError(null);
            setNotFound(null);
            setOpen(true);
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-2 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
        >
          <UserRound className="h-4 w-4" strokeWidth={1.75} />
          По номеру
        </button>
        <button
          onClick={() => onInvite(!inviting)}
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-medium transition ${
            inviting ? "border-accent bg-accent text-accent-foreground" : "border-border text-foreground hover:bg-surface-muted"
          }`}
        >
          <QrCode className="h-4 w-4" strokeWidth={1.75} />
          {inviting ? "Скрыть QR" : "QR приложения"}
        </button>
      </div>
      {inviting && <p className="mt-1.5 text-xs text-muted">QR приложения на экране покупателя</p>}
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
              <p className="text-sm font-medium text-foreground">Номер {formatKzPhone(notFound)} не зарегистрирован</p>
              <p className="mt-1 text-sm text-muted">Клиент регистрируется сам в приложении Ar Amir: QR-код уже на экране покупателя.</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-2 h-11 w-full rounded-xl border border-accent text-base font-semibold text-accent transition hover:bg-accent/10"
              >
                Понятно
              </button>
            </div>
          )}
        </PhoneKeypadModal>
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
