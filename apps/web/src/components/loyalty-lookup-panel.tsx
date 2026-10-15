"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { LoyaltyLookupDto } from "@bakery-os/shared";
import { formatKzPhone, KZ_PHONE_INVALID_MESSAGE, LOYALTY_ADMIN_ROLES, LOYALTY_MANAGE_ROLES, normalizeKzPhone, Role } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { inputClass, marketingLabel, MemberStatusBadge } from "@/components/loyalty-shared";
import { LoyaltyRegisterModal } from "@/components/loyalty-register-modal";
import { LoyaltyMemberModal } from "@/components/loyalty-member-modal";

// Find a retail customer by phone, or register one. Used on Клиенты → Розница
// and on the till, which is the only screen a cashier can reach.
export function LoyaltyLookupPanel({ role, onChanged }: { role: Role; onChanged?: () => void }) {
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<LoyaltyLookupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerPhone, setRegisterPhone] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookup(null);
    setError(null);
    if (!normalizeKzPhone(phone)) {
      setError(KZ_PHONE_INVALID_MESSAGE);
      return;
    }
    try {
      setLookup(await api.loyalty.lookup(phone));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось найти клиента");
    }
  }

  function changed() {
    onChanged?.();
    if (lookup) api.loyalty.lookup(lookup.phone).then(setLookup).catch(() => undefined);
  }

  return (
    <div>
      <form onSubmit={handleLookup} className="flex flex-wrap gap-2">
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон клиента" className={`${inputClass} max-w-xs`} />
        <button type="submit" className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted">
          <Search className="h-4 w-4" strokeWidth={1.75} />
          Найти
        </button>
        <button
          type="button"
          onClick={() => setRegisterPhone(phone)}
          className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Новый клиент
        </button>
      </form>

      {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {lookup?.member && (
        <button
          type="button"
          onClick={() => setOpenId(lookup.member!.id)}
          className="mt-4 flex w-full flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition hover:bg-surface-muted"
        >
          <span className="font-medium text-foreground">{formatKzPhone(lookup.member.phone)}</span>
          <span className="text-foreground">{lookup.member.name ?? "Имя не указано"}</span>
          <MemberStatusBadge status={lookup.member.status} />
          {lookup.member.phone !== lookup.phone && (
            <span className="text-xs text-muted">номер {formatKzPhone(lookup.phone)} объединён с этой записью</span>
          )}
          <span className="ml-auto text-sm text-muted">Рассылки: {marketingLabel(lookup.member.consents)}</span>
        </button>
      )}

      {lookup && !lookup.member && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm">
          <span className="text-foreground">Клиент с номером {formatKzPhone(lookup.phone)} не найден</span>
          <button type="button" onClick={() => setRegisterPhone(lookup.phone)} className="font-medium text-accent hover:underline">
            Зарегистрировать
          </button>
        </div>
      )}

      {registerPhone !== null && (
        <LoyaltyRegisterModal
          initialPhone={registerPhone}
          onClose={() => setRegisterPhone(null)}
          onSaved={(member) => {
            setRegisterPhone(null);
            setLookup({ phone: member.phone, member });
            setPhone(formatKzPhone(member.phone));
            onChanged?.();
          }}
        />
      )}

      {openId && (
        <LoyaltyMemberModal
          memberId={openId}
          canManage={LOYALTY_MANAGE_ROLES.includes(role)}
          canAdmin={LOYALTY_ADMIN_ROLES.includes(role)}
          onClose={() => setOpenId(null)}
          onChanged={changed}
        />
      )}
    </div>
  );
}
