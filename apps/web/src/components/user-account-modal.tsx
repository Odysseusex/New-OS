"use client";

import { useEffect, useState } from "react";
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
  const [title, setTitle] = useState(account?.title ?? "");
  const [locationId, setLocationId] = useState(account?.locationId ?? "");
  const [pin, setPin] = useState("");
  const [removePin, setRemovePin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // «Помощник» works with a key instead of a password: issued here, shown once.
  const [hasKey, setHasKey] = useState(Boolean(account?.hasAssistantKey));
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function changeKey(revoke: boolean) {
    if (!account) return;
    if (hasKey && !window.confirm(revoke ? "Отозвать ключ? Помощник перестанет работать, пока не выпустите новый." : "Выпустить новый ключ? Прежний сразу перестанет работать.")) return;
    setError(null);
    setKeyBusy(true);
    try {
      const result = await api.users.assistantKey(account.id, revoke);
      setNewKey(result.key);
      setHasKey(result.key !== null);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выпустить ключ");
    } finally {
      setKeyBusy(false);
    }
  }

  const needsLocation = !ORG_WIDE_ROLES.includes(role);

  // locations can still be loading when this modal opens, so the first
  // render may have nothing to default to. Backfill once they arrive,
  // without clobbering a value the user (or the edited account) already has.
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin && !/^\d{4,6}$/.test(pin)) {
      setError("PIN — от 4 до 6 цифр");
      return;
    }
    setIsSubmitting(true);
    try {
      let savedId = account?.id;
      if (account) {
        await api.users.update(account.id, {
          fullName,
          email,
          role,
          title: title || null,
          locationId: needsLocation ? locationId : null,
          password: password || undefined,
        });
      } else {
        const created = await api.users.create({
          fullName,
          email,
          password,
          role,
          title: title || undefined,
          locationId: needsLocation ? locationId : undefined,
        });
        savedId = created.id;
      }
      // The till PIN is its own request: it is checked for uniqueness on its own.
      if (savedId && pin) await api.users.setPin(savedId, pin);
      else if (savedId && removePin) await api.users.setPin(savedId, null);
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

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Отображаемая должность <span className="text-muted">(необязательно)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Разработчик"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-1.5 text-xs text-muted">
            Если указано, показывается вместо названия роли в правом верхнем углу — на права
            доступа не влияет, их по-прежнему определяет роль
          </p>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            PIN для кассы <span className="text-muted">(4–6 цифр)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setRemovePin(false);
              }}
              placeholder={account?.hasPin ? "PIN задан — введите новый, чтобы сменить" : "Не задан"}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {account?.hasPin && (
              <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={removePin} onChange={(e) => { setRemovePin(e.target.checked); if (e.target.checked) setPin(""); }} />
                Убрать
              </label>
            )}
          </div>
        </div>

        {account?.role === Role.ASSISTANT && role === Role.ASSISTANT && (
          <div className="mb-4 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Ключ помощника <span className="font-normal text-muted">· {hasKey ? "выпущен" : "не выпущен"}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={keyBusy}
                  onClick={() => changeKey(false)}
                  className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-60"
                >
                  {hasKey ? "Выпустить новый" : "Выпустить ключ"}
                </button>
                {hasKey && (
                  <button
                    type="button"
                    disabled={keyBusy}
                    onClick={() => changeKey(true)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                  >
                    Отозвать
                  </button>
                )}
              </div>
            </div>
            {newKey && (
              <div className="mt-3">
                <textarea
                  readOnly
                  value={newKey}
                  rows={4}
                  onFocus={(e) => e.target.select()}
                  className="w-full break-all rounded-xl border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-foreground outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">Показывается один раз. Вставьте его только в защищённую форму, не в чат.</p>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(newKey);
                      setCopied(true);
                    }}
                    className="shrink-0 rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition hover:opacity-90"
                  >
                    {copied ? "Скопировано" : "Скопировать"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
