"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Send, ShieldAlert } from "lucide-react";
import type {
  FiscalReceiptDto,
  FiscalShiftDto,
  FiscalStatusDto,
  LocationDto,
  UserAccountDto,
} from "@bakery-os/shared";
import { FiscalReceiptStatus, HARD_DELETE_ROLES, ROLE_LABELS_RU, USER_MANAGE_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { UserAccountModal } from "@/components/user-account-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

export default function SettingsPage() {
  const { user } = useAuth();
  const canManage = user ? USER_MANAGE_ROLES.includes(user.role) : false;
  const canSeeFiscal = user ? HARD_DELETE_ROLES.includes(user.role) : false;

  const [accounts, setAccounts] = useState<UserAccountDto[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<UserAccountDto | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canManage) return;
    api.users
      .list(showArchived)
      .then(setAccounts)
      .catch(() => setError("Не удалось загрузить сотрудников"));
  }, [canManage, showArchived]);

  useEffect(() => {
    if (!canManage) return;
    api.locations.list().then(setLocations).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleArchive(account: UserAccountDto) {
    try {
      await api.users.archive(account.id);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось деактивировать сотрудника");
    }
  }

  async function handleRestore(account: UserAccountDto) {
    try {
      await api.users.restore(account.id);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось восстановить сотрудника");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Настройки</h1>
        <p className="mt-1 text-sm text-muted">Сотрудники, роли и доступ к платформе</p>
      </div>

      <div className="mb-8 space-y-5">
        <TelegramCard />
        {/* Same gate as the endpoints behind it — OWNER/ADMIN only. */}
        {canSeeFiscal && <FiscalCard />}
      </div>

      {!canManage && (
        <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
          <ShieldAlert className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-semibold text-foreground">Нет доступа</h2>
          <p className="mt-2 text-sm text-muted">
            Управление сотрудниками доступно только владельцу и администратору.
          </p>
        </div>
      )}

      {canManage && (
        <>
          <div className="mb-6 flex items-start justify-between">
            <h2 className="text-sm font-semibold text-foreground">Сотрудники</h2>
            <button
              onClick={() => {
                setEditingAccount(undefined);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый сотрудник
            </button>
          </div>

          {error && (
            <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="mb-4 flex justify-end">
            <ArchivedToggle checked={showArchived} onChange={setShowArchived} />
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">ФИО</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Роль</th>
              <th className="px-5 py-3 font-medium">Точка</th>
              <th className="px-5 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id} className={clsx(!a.isActive && "opacity-60")}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <div className="flex items-center gap-2">
                    {a.fullName}
                    {!a.isActive && <ArchivedBadge />}
                    {a.id === user?.id && (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted">
                        Это вы
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-muted">{a.email}</td>
                <td className="px-5 py-3 text-muted">{ROLE_LABELS_RU[a.role]}</td>
                <td className="px-5 py-3 text-muted">{a.locationName ?? "—"}</td>
                <td className="px-5 py-3">
                  <RowActions
                    isActive={a.isActive}
                    onEdit={() => {
                      setEditingAccount(a);
                      setIsModalOpen(true);
                    }}
                    onArchive={() => handleArchive(a)}
                    onRestore={() => handleRestore(a)}
                  />
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                  Сотрудников пока нет
                </td>
              </tr>
            )}
          </tbody>
            </table>
          </div>

          {isModalOpen && (
            <UserAccountModal
              locations={locations}
              account={editingAccount}
              onClose={() => setIsModalOpen(false)}
              onSaved={() => {
                setIsModalOpen(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function TelegramCard() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string; botUsername: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.telegram
      .status()
      .then((s) => setLinked(s.linked))
      .catch(() => setError("Не удалось проверить статус Telegram"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGetCode() {
    setBusy(true);
    setError(null);
    try {
      const token = await api.telegram.linkToken();
      setCode(token);
    } catch {
      setError("Не удалось получить код");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    setBusy(true);
    setError(null);
    try {
      await api.telegram.unlink();
      setCode(null);
      setLinked(false);
    } catch {
      setError("Не удалось отключить Telegram");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
          <Send className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Telegram</h2>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {linked === null && <p className="text-sm text-muted">Загрузка…</p>}

      {linked === true && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">✅ Подключён</p>
          <button
            onClick={handleUnlink}
            disabled={busy}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-60"
          >
            Отключить
          </button>
        </div>
      )}

      {linked === false && !code && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Управляйте складом и продажами прямо из Telegram-бота ArAmir OS.</p>
          <button
            onClick={handleGetCode}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            Подключить Telegram
          </button>
        </div>
      )}

      {linked === false && code && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {code.botUsername ? (
              <>
                Откройте бота{" "}
                <a
                  href={`https://t.me/${code.botUsername}?start=${code.code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent underline"
                >
                  @{code.botUsername}
                </a>{" "}
                — код подставится автоматически.
              </>
            ) : (
              "Откройте бота ArAmir OS в Telegram и отправьте команду ниже."
            )}
          </p>
          <div className="rounded-xl bg-surface-muted px-4 py-3 text-center font-mono text-lg tracking-widest text-foreground">
            /start {code.code}
          </div>
          <p className="text-xs text-muted">Код действителен 10 минут.</p>
          <button onClick={load} className="text-sm font-medium text-accent underline">
            Я подключил(а) — проверить
          </button>
        </div>
      )}
    </div>
  );
}

// Operational state of the fiscal cash register: is it switched on, is the
// shift still alive, and are there receipts a human has to deal with.
//
// The shift matters because the operator caps one at 24 hours and we cannot
// close it from here yet — their close endpoint wants a cash-register
// password whose transport is still an open question with re:Kassa. Until
// that is answered, showing the expiry is the mitigation: the owner can close
// the shift in the re:Kassa app before it bites.
function FiscalCard() {
  const [status, setStatus] = useState<FiscalStatusDto | null>(null);
  const [receipts, setReceipts] = useState<FiscalReceiptDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.fiscal.status(), api.fiscal.needsAttention()])
      .then(([s, r]) => {
        setStatus(s);
        setReceipts(r);
        setState("ready");
      })
      // A failed load must not look like "everything is fine" — that is the
      // exact confusion an earlier card here caused.
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReconcile() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.fiscal.reconcile();
      setResult(
        r.checked === 0
          ? "Нечего сверять — зависших чеков нет"
          : `Проверено ${r.checked}, подтверждено ${r.resolved}`,
      );
      load();
    } catch (err) {
      setResult(err instanceof ApiError ? err.message : "Не удалось выполнить сверку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-sm font-semibold text-foreground">Фискальная касса</h2>
        {state === "ready" && status && (
          <span
            className={clsx(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              status.enabled ? "bg-emerald-50 text-emerald-700" : "bg-surface-muted text-muted",
            )}
          >
            {status.enabled ? "Включена" : "Выключена"}
          </span>
        )}
      </div>

      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && (
        <p className="text-sm text-red-700">Не удалось получить состояние кассы</p>
      )}

      {state === "ready" && status && (
        <>
          {!status.enabled && (
            <p className="text-sm text-muted">
              Продажи проводятся без фискальных чеков.
              {status.provider === "fake" && " Реквизиты кассы не заданы."}
            </p>
          )}

          {status.enabled && <ShiftRow shift={status.shift} />}

          {status.productsWithoutNtinCount > 0 && (
            <p className="mt-3 text-sm text-amber-700">
              Товаров без кода NTIN: {status.productsWithoutNtinCount}. Продажу это не блокирует, но
              заполните коды в Складе — Номенклатура, когда будет время.
            </p>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Требуют внимания</p>
                <p className="mt-0.5 text-sm text-muted">
                  {receipts.length === 0 ? "Нет" : `${receipts.length} чек(ов)`}
                </p>
              </div>
              <button
                onClick={handleReconcile}
                disabled={busy}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
              >
                {busy ? "Сверка…" : "Сверить с кассой"}
              </button>
            </div>

            {result && <p className="mt-3 text-sm text-muted">{result}</p>}

            {receipts.length > 0 && (
              <ul className="mt-4 space-y-2">
                {receipts.map((r) => (
                  <li key={r.id} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">{RECEIPT_STATUS_LABELS[r.status]}</span>
                      <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.ticketNumber && (
                      <p className="mt-0.5 font-mono text-xs text-muted">Чек № {r.ticketNumber}</p>
                    )}
                    {r.errorMessage && <p className="mt-0.5 text-muted">{r.errorMessage}</p>}
                    {!r.saleId && r.status === FiscalReceiptStatus.REGISTERED && (
                      <p className="mt-0.5 text-amber-700">Чек пробит, но продажа не записалась</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const RECEIPT_STATUS_LABELS: Record<FiscalReceiptStatus, string> = {
  [FiscalReceiptStatus.PENDING]: "Не отправлен",
  [FiscalReceiptStatus.SENDING]: "Отправляется",
  [FiscalReceiptStatus.REGISTERED]: "Пробит",
  [FiscalReceiptStatus.FAILED]: "Отклонён кассой",
  [FiscalReceiptStatus.UNKNOWN]: "Ответ не получен",
};

function ShiftRow({ shift }: { shift: FiscalShiftDto | null }) {
  if (!shift) {
    return <p className="text-sm text-amber-700">Не удалось связаться с кассой — состояние смены неизвестно</p>;
  }
  if (!shift.isOpen) {
    return <p className="text-sm text-muted">Смена закрыта</p>;
  }

  // Under three hours left is the point where telling someone is still useful.
  const hoursLeft = shift.expiresAt ? (new Date(shift.expiresAt).getTime() - Date.now()) / 3600000 : null;
  const soon = hoursLeft !== null && hoursLeft < 3;

  return (
    <div className="space-y-1 text-sm">
      <p className="text-foreground">
        Смена {shift.shiftNumber !== null ? `№ ${shift.shiftNumber}` : ""} открыта
        {shift.openedAt ? ` с ${formatDateTime(shift.openedAt)}` : ""}
      </p>
      {shift.expiresAt && (
        <p className={clsx(shift.isExpired || soon ? "text-amber-700" : "text-muted")}>
          {shift.isExpired
            ? `Смена просрочена с ${formatDateTime(shift.expiresAt)} — закройте её в приложении re:Kassa`
            : `Истекает ${formatDateTime(shift.expiresAt)}`}
        </p>
      )}
    </div>
  );
}
