"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import type { InvoiceDto, LocationDto, ProductDto, PurchaseOrderDto, SupplierDto } from "@bakery-os/shared";
import {
  HARD_DELETE_ROLES,
  INVOICE_MANAGE_ROLES,
  INVOICE_STATUS_LABELS_RU,
  InvoiceStatus,
  ORG_WIDE_ROLES,
  PURCHASE_ORDER_MANAGE_ROLES,
  PURCHASE_ORDER_STATUS_LABELS_RU,
  PurchaseOrderStatus,
  SUPPLIER_MANAGE_ROLES,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/format";
import { NewPurchaseOrderModal } from "@/components/new-purchase-order-modal";
import { NewInvoiceModal } from "@/components/new-invoice-modal";
import { NewSupplierModal } from "@/components/new-supplier-modal";
import { ArchivedBadge, ArchivedToggle, RowActions } from "@/components/row-actions";

type Tab = "orders" | "invoices" | "suppliers";

export default function ProcurementPage() {
  const { user } = useAuth();
  const isOrgWide = user ? ORG_WIDE_ROLES.includes(user.role) : false;
  const canManageOrders = user ? PURCHASE_ORDER_MANAGE_ROLES.includes(user.role) : false;
  const canManageInvoices = user ? INVOICE_MANAGE_ROLES.includes(user.role) : false;
  const canManageSuppliers = user ? SUPPLIER_MANAGE_ROLES.includes(user.role) : false;
  const canDelete = user ? HARD_DELETE_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<Tab>("orders");
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderDto[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [showArchivedSuppliers, setShowArchivedSuppliers] = useState(false);
  const [modal, setModal] = useState<"order" | "invoice" | "supplier" | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDto | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    api.procurement
      .orders(locationFilter || undefined)
      .then(setOrders)
      .catch(() => setError("Не удалось загрузить заказы"));
  }, [locationFilter]);

  const loadInvoices = useCallback(() => {
    api.invoices
      .list(locationFilter || undefined)
      .then(setInvoices)
      .catch(() => setError("Не удалось загрузить накладные"));
  }, [locationFilter]);

  const loadSuppliers = useCallback(() => {
    api.suppliers
      .list(showArchivedSuppliers)
      .then(setSuppliers)
      .catch(() => setError("Не удалось загрузить поставщиков"));
  }, [showArchivedSuppliers]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
    api.products.list().then(setProducts).catch(() => {});
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const fixedLocationId = isOrgWide ? null : (user?.locationId ?? null);

  async function handleReceive(order: PurchaseOrderDto) {
    try {
      await api.procurement.receiveOrder(order.id);
      loadOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять заказ");
    }
  }

  async function handleCancel(order: PurchaseOrderDto) {
    try {
      await api.procurement.cancelOrder(order.id);
      loadOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить заказ");
    }
  }

  async function handleConfirmInvoice(invoice: InvoiceDto) {
    try {
      await api.invoices.confirm(invoice.id);
      loadInvoices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось провести накладную");
    }
  }

  async function handleCancelInvoice(invoice: InvoiceDto) {
    try {
      await api.invoices.cancel(invoice.id);
      loadInvoices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить накладную");
    }
  }

  async function handleSupplierArchive(s: SupplierDto) {
    try {
      await api.suppliers.archive(s.id);
      loadSuppliers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заархивировать поставщика");
    }
  }

  async function handleSupplierRestore(s: SupplierDto) {
    try {
      await api.suppliers.restore(s.id);
      loadSuppliers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось восстановить поставщика");
    }
  }

  async function handleSupplierDelete(s: SupplierDto) {
    if (!confirm(`Удалить поставщика «${s.name}»? Это действие нельзя отменить.`)) return;
    try {
      await api.suppliers.remove(s.id);
      loadSuppliers();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Не удалось удалить поставщика");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Закупки</h1>
          <p className="mt-1 text-sm text-muted">Поставщики и заказы на пополнение склада</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
            Заказы
          </TabButton>
          <TabButton active={tab === "invoices"} onClick={() => setTab("invoices")}>
            Накладные
          </TabButton>
          <TabButton active={tab === "suppliers"} onClick={() => setTab("suppliers")}>
            Поставщики
          </TabButton>
        </div>

        <div className="flex items-center gap-3">
          {(tab === "orders" || tab === "invoices") && isOrgWide && (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Все точки</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}

          {tab === "orders" && canManageOrders && (
            <button
              onClick={() => setModal("order")}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый заказ
            </button>
          )}

          {tab === "invoices" && canManageInvoices && (
            <button
              onClick={() => setModal("invoice")}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новая накладная
            </button>
          )}

          {tab === "suppliers" && canManageSuppliers && (
            <ArchivedToggle checked={showArchivedSuppliers} onChange={setShowArchivedSuppliers} />
          )}

          {tab === "suppliers" && canManageSuppliers && (
            <button
              onClick={() => {
                setEditingSupplier(undefined);
                setModal("supplier");
              }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              Новый поставщик
            </button>
          )}
        </div>
      </div>

      {tab === "orders" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Поставщик</th>
                {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Дата заказа</th>
                {canManageOrders && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{order.supplierName}</td>
                  {isOrgWide && <td className="px-5 py-3 text-muted">{order.locationName}</td>}
                  <td className="px-5 py-3 text-right text-foreground">
                    {formatMoney(order.totalCost)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-5 py-3 text-muted">{formatDateTime(order.orderedAt)}</td>
                  {canManageOrders && (
                    <td className="px-5 py-3">
                      {order.status === PurchaseOrderStatus.PLACED && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleReceive(order)}
                            title="Принять"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-green-600"
                          >
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => handleCancel(order)}
                            title="Отменить"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                          >
                            <XCircle className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                    Заказов пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "invoices" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Номер</th>
                <th className="px-5 py-3 font-medium">Поставщик</th>
                {isOrgWide && <th className="px-5 py-3 font-medium">Точка</th>}
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Дата</th>
                {canManageInvoices && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-5 py-3 font-medium text-foreground">№{invoice.number}</td>
                  <td className="px-5 py-3 text-muted">{invoice.supplierName}</td>
                  {isOrgWide && <td className="px-5 py-3 text-muted">{invoice.locationName}</td>}
                  <td className="px-5 py-3 text-right text-foreground">{formatMoney(invoice.totalCost)}</td>
                  <td className="px-5 py-3">
                    <InvoiceStatusBadge status={invoice.status} />
                  </td>
                  <td className="px-5 py-3 text-muted">{formatDateTime(invoice.issuedAt)}</td>
                  {canManageInvoices && (
                    <td className="px-5 py-3">
                      {invoice.status === InvoiceStatus.DRAFT && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleConfirmInvoice(invoice)}
                            title="Провести"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-green-600"
                          >
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => handleCancelInvoice(invoice)}
                            title="Отменить"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-red-600"
                          >
                            <XCircle className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">
                    Накладных пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">Название</th>
                <th className="px-5 py-3 font-medium">Телефон</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Заметки</th>
                {canManageSuppliers && <th className="px-5 py-3 font-medium">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((s) => (
                <tr key={s.id} className={clsx(!s.isActive && "opacity-60")}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      {s.name}
                      {!s.isActive && <ArchivedBadge />}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted">{s.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{s.email ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{s.notes ?? "—"}</td>
                  {canManageSuppliers && (
                    <td className="px-5 py-3">
                      <RowActions
                        isActive={s.isActive}
                        onEdit={() => {
                          setEditingSupplier(s);
                          setModal("supplier");
                        }}
                        onArchive={() => handleSupplierArchive(s)}
                        onRestore={() => handleSupplierRestore(s)}
                        onDelete={canDelete ? () => handleSupplierDelete(s) : undefined}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Поставщиков пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal === "order" && (
        <NewPurchaseOrderModal
          suppliers={suppliers.filter((s) => s.isActive)}
          locations={locations}
          products={products}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadOrders();
          }}
        />
      )}

      {modal === "invoice" && (
        <NewInvoiceModal
          suppliers={suppliers.filter((s) => s.isActive)}
          locations={locations}
          products={products}
          fixedLocationId={fixedLocationId}
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            loadInvoices();
          }}
        />
      )}

      {modal === "supplier" && (
        <NewSupplierModal
          supplier={editingSupplier}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            loadSuppliers();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const styles: Record<PurchaseOrderStatus, string> = {
    [PurchaseOrderStatus.PLACED]: "bg-amber-50 text-amber-700",
    [PurchaseOrderStatus.RECEIVED]: "bg-green-50 text-green-700",
    [PurchaseOrderStatus.CANCELLED]: "bg-surface-muted text-muted",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {PURCHASE_ORDER_STATUS_LABELS_RU[status]}
    </span>
  );
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    [InvoiceStatus.DRAFT]: "bg-amber-50 text-amber-700",
    [InvoiceStatus.CONFIRMED]: "bg-green-50 text-green-700",
    [InvoiceStatus.CANCELLED]: "bg-surface-muted text-muted",
  };
  return (
    <span className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", styles[status])}>
      {INVOICE_STATUS_LABELS_RU[status]}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
