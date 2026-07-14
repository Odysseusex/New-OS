"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, ShieldAlert } from "lucide-react";
import type { LocationDto, UserAccountDto } from "@bakery-os/shared";
import { ROLE_LABELS_RU, USER_MANAGE_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { UserAccountModal } from "@/components/user-account-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

export default function SettingsPage() {
  const { user } = useAuth();
  const canManage = user ? USER_MANAGE_ROLES.includes(user.role) : false;

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

  if (!canManage) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold text-foreground">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">
          Управление сотрудниками доступно только владельцу и администратору.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Настройки</h1>
          <p className="mt-1 text-sm text-muted">Сотрудники, роли и доступ к платформе</p>
        </div>
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
    </div>
  );
}
