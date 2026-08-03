"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Wallet } from "lucide-react";
import type { CustomerDto } from "@bakery-os/shared";
import { CUSTOMER_MANAGE_ROLES, HARD_DELETE_ROLES, PAYMENT_RECORD_ROLES } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/format";
import { NewCustomerModal } from "@/components/new-customer-modal";
import { CustomerDetailModal } from "@/components/customer-detail-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

export default function CustomersPage() {
  const { user } = useAuth();
  const canManage = user ? CUSTOMER_MANAGE_ROLES.includes(user.role) : false;
  const canDelete = user ? HARD_DELETE_ROLES.includes(user.role) : false;
  const canRecordPayment = user ? PAYMENT_RECORD_ROLES.includes(user.role) : false;

  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerDto | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.customers
      .list(showArchived)
      .then(setCustomers)
      .catch(() => setError("Не удалось загрузить клиентов"));
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOutstanding = customers.reduce((sum, c) => sum + c.outstandingBalance, 0);

  async function handleArchive(c: CustomerDto) {
    try {
      await api.customers.archive(c.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать клиента");
    }
  }

  async function handleRestore(c: CustomerDto) {
    try {
      await api.customers.restore(c.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить клиента");
    }
  }

  async function handleDelete(c: CustomerDto) {
    if (!confirm(`Удалить клиента «${c.name}»? Это действие нельзя отменить.`)) return;
    try {
      await api.customers.remove(c.id);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить клиента");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Клиенты</h1>
          <p className="mt-1 text-sm text-muted">Оптовые клиенты, история заказов и задолженности</p>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setEditingCustomer(undefined);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Новый клиент
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {canManage && (
        <div className="mb-4 flex justify-end">
          <ArchivedToggle checked={showArchived} onChange={setShowArchived} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
            <Wallet className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <p className="text-2xl font-semibold text-foreground">{customers.length}</p>
          <p className="mt-0.5 text-sm text-muted">Клиентов в базе</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-accent">
            <Wallet className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <p className="text-2xl font-semibold text-foreground">{formatMoney(totalOutstanding)}</p>
          <p className="mt-0.5 text-sm text-muted">Общая задолженность</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Название</th>
              <th className="px-5 py-3 font-medium">Телефон</th>
              <th className="px-5 py-3 font-medium">Кредитный лимит</th>
              <th className="px-5 py-3 text-right font-medium">Задолженность</th>
              {canManage && <th className="px-5 py-3 font-medium">Действия</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={clsx("cursor-pointer transition hover:bg-surface-muted", !c.isActive && "opacity-60")}
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  <div className="flex items-center gap-2">
                    {c.name}
                    {!c.isActive && <ArchivedBadge />}
                  </div>
                </td>
                <td className="px-5 py-3 text-muted">{c.phone ?? "—"}</td>
                <td className="px-5 py-3 text-muted">
                  {c.creditLimit !== null ? formatMoney(c.creditLimit) : "—"}
                </td>
                <td
                  className={`px-5 py-3 text-right font-medium ${
                    c.outstandingBalance > 0 ? "text-red-600" : "text-foreground"
                  }`}
                >
                  {formatMoney(c.outstandingBalance)}
                </td>
                {canManage && (
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      isActive={c.isActive}
                      onEdit={() => {
                        setEditingCustomer(c);
                        setIsModalOpen(true);
                      }}
                      onArchive={() => handleArchive(c)}
                      onRestore={() => handleRestore(c)}
                      onDelete={canDelete ? () => handleDelete(c) : undefined}
                    />
                  </td>
                )}
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                  Клиентов пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <NewCustomerModal
          customer={editingCustomer}
          onClose={() => setIsModalOpen(false)}
          onSaved={() => {
            setIsModalOpen(false);
            load();
          }}
        />
      )}

      {selectedId && (
        <CustomerDetailModal
          customerId={selectedId}
          canRecordPayment={canRecordPayment}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
