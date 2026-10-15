"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Upload } from "lucide-react";
import type { LoyaltyMemberListDto } from "@bakery-os/shared";
import {
  formatKzPhone,
  LOYALTY_ADMIN_ROLES,
  LOYALTY_MANAGE_ROLES,
  LOYALTY_MEMBER_STATUS_LABELS_RU,
  LoyaltyMemberStatus,
  Role,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { inputClass, marketingLabel, MemberStatusBadge } from "@/components/loyalty-shared";
import { LoyaltyLookupPanel } from "@/components/loyalty-lookup-panel";
import { LoyaltyMemberModal } from "@/components/loyalty-member-modal";
import { LoyaltyImportModal } from "@/components/loyalty-import-modal";

export function LoyaltyTab({ role }: { role: Role }) {
  const canManage = LOYALTY_MANAGE_ROLES.includes(role);
  const canAdmin = LOYALTY_ADMIN_ROLES.includes(role);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [list, setList] = useState<LoyaltyMemberListDto | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadList = useCallback(
    (q: string, s: string) => {
      if (!canManage) return;
      setListError(null);
      api.loyalty
        .list(q || undefined, s || undefined)
        .then(setList)
        .catch((err) => setListError(err instanceof ApiError ? err.message : "Не удалось загрузить клиентов"));
    },
    [canManage],
  );

  useEffect(() => {
    loadList("", "");
  }, [loadList]);

  return (
    <div>
      {canAdmin && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            <Upload className="h-4 w-4" strokeWidth={1.75} />
            Импорт
          </button>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <LoyaltyLookupPanel role={role} onChanged={() => loadList(query, status)} />
      </div>

      {canManage && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadList(query, status);
            }}
            className="mb-4 flex flex-wrap gap-2"
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или часть номера" className={`${inputClass} max-w-xs`} />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                loadList(query, e.target.value);
              }}
              className={`${inputClass} max-w-[16rem]`}
            >
              <option value="">Все, кроме объединённых</option>
              {Object.values(LoyaltyMemberStatus).map((s) => (
                <option key={s} value={s}>
                  {LOYALTY_MEMBER_STATUS_LABELS_RU[s]}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted">
              Показать
            </button>
          </form>

          {listError && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{listError}</div>}

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium">Имя</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Рассылки</th>
                  <th className="px-5 py-3 font-medium">Зарегистрирован</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list?.items.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setOpenId(m.id)}
                    className={clsx("cursor-pointer transition hover:bg-surface-muted", m.status !== LoyaltyMemberStatus.ACTIVE && "opacity-70")}
                  >
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-foreground">{formatKzPhone(m.phone)}</td>
                    <td className="px-5 py-3 text-foreground">{m.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <MemberStatusBadge status={m.status} />
                    </td>
                    <td className="px-5 py-3 text-muted">{marketingLabel(m.consents)}</td>
                    <td className="px-5 py-3 text-muted">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
                {list && list.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      Клиентов не найдено
                    </td>
                  </tr>
                )}
                {!list && !listError && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      Загрузка…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {list && list.total > list.items.length && (
              <p className="border-t border-border px-5 py-3 text-sm text-muted">
                Показаны {list.items.length} из {list.total}
              </p>
            )}
          </div>
        </>
      )}

      {openId && (
        <LoyaltyMemberModal memberId={openId} canManage={canManage} canAdmin={canAdmin} onClose={() => setOpenId(null)} onChanged={() => loadList(query, status)} />
      )}

      {importOpen && <LoyaltyImportModal onClose={() => setImportOpen(false)} onImported={() => loadList(query, status)} />}
    </div>
  );
}
