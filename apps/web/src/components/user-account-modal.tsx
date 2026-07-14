"use client";

import { useState } from "react";
import type { LocationDto, UserAccountDto } from "@bakery-os/shared";
import { ORG_WIDE_ROLES, ROLE_LABELS_RU, Role } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function UserAccountModal({
  locations,
  account,
  onClose,
  onSaved,
}: {
  locations: LocationDto[];
  account?: UserAccountDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(account?.fullName ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(account?.role ?? Role.CASHIER);
  const [locationId, setLocationId] = useState(account?.locationId ?? locations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const needsLocation = !ORG_WIDE_ROLES.includes(role);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (account) {
        await api.users.update(account.id, {
          fullName,
          email,
          role,
          locationId: needsLocation ? locationId : null,
          password: password || undefined,
        });
      } else {
        await api.users.create({
          fullName,
          email,
          password,
          role,
          locationId: needsLocation ? locationId : undefined,
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
    <Modal title={account ? "Редактировать сотрудника" : "Новый сотрудник"} onClose={onClose}>
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
            <label className="mb-1.5 block text-sm font-medium text-foreground">Email (логин)</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Пароль {account && <span className="text-muted">(оставьте пустым, чтобы не менять)</span>}
            </label>
            <input
              type="password"
              required={!account}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={account ? "••••••••" : "Минимум 8 символов"}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Роль</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(Role).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS_RU[r]}
                </option>
              ))}
            </select>
          </div>
          {needsLocation && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Точка</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {locations.length === 0 && <option value="">Сначала добавьте точку</option>}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : account ? "Сохранить" : "Добавить сотрудника"}
        </button>
      </form>
    </Modal>
  );
}
