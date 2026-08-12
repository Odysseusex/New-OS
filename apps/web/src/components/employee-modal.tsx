"use client";

import { useState } from "react";
import type { EmployeeDto, LocationDto, UserAccountDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function EmployeeModal({
  locations,
  linkableUsers,
  employee,
  fixedLocationId,
  onClose,
  onSaved,
}: {
  locations: LocationDto[];
  // Active users not yet linked to any employee — offered only when creating
  // a new employee. Linking a User to an Employee happens at creation time
  // only (see UpdateEmployeeRequestDto, which deliberately has no userId).
  linkableUsers: UserAccountDto[];
  employee?: EmployeeDto;
  fixedLocationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(employee?.fullName ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [locationId, setLocationId] = useState(employee?.locationId ?? fixedLocationId ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [hiredAt, setHiredAt] = useState(employee?.hiredAt ? employee.hiredAt.slice(0, 10) : "");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (employee) {
        await api.hr.employees.update(employee.id, {
          fullName,
          position,
          locationId: locationId || undefined,
          phone: phone || undefined,
          hiredAt: hiredAt || undefined,
        });
      } else {
        await api.hr.employees.create({
          fullName,
          position,
          locationId: locationId || undefined,
          phone: phone || undefined,
          hiredAt: hiredAt || undefined,
          userId: userId || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить сотрудника");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={employee ? "Редактировать сотрудника" : "Новый сотрудник"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">ФИО</label>
          <input
            type="text"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Должность</label>
            <input
              type="text"
              required
              placeholder="Например: Пекарь"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {!fixedLocationId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Без точки</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Телефон <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Дата найма <span className="text-muted">(необязательно)</span>
            </label>
            <input
              type="date"
              value={hiredAt}
              onChange={(e) => setHiredAt(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {!employee && (
          <div className="mb-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Привязать пользователя ERP <span className="text-muted">(необязательно)</span>
            </label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="">Без доступа к системе</option>
              {linkableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.email})
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted">
              Нужно только если сотрудник сам входит в систему — например, чтобы отмечать свою смену
            </p>
          </div>
        )}

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : employee ? "Сохранить" : "Добавить сотрудника"}
        </button>
      </form>
    </Modal>
  );
}
