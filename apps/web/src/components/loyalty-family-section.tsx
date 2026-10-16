"use client";

import { useState } from "react";
import type { LoyaltyFamilyMemberDto } from "@bakery-os/shared";
import { isValidBirthDate, LOYALTY_MAX_FAMILY_MEMBERS, MONTHS_GENITIVE_RU } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { inputClass } from "@/components/loyalty-shared";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function formatBirthday(f: Pick<LoyaltyFamilyMemberDto, "birthDay" | "birthMonth" | "birthYear">) {
  return `${f.birthDay} ${MONTHS_GENITIVE_RU[f.birthMonth - 1]}${f.birthYear ? ` ${f.birthYear}` : ""}`;
}

// Birthdays on one card: the holder and their family.
export function LoyaltyFamilySection({
  memberId,
  family,
  editable,
  canRemove,
  onChanged,
}: {
  memberId: string;
  family: LoyaltyFamilyMemberDto[];
  editable: boolean;
  canRemove: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yearNum = year.trim() ? Number(year) : null;
  const dateOk = day !== "" && month !== "" && isValidBirthDate(Number(month), Number(day), yearNum);

  function reset() {
    setAdding(false);
    setName("");
    setRelation("");
    setDay("");
    setMonth("");
    setYear("");
  }

  async function act(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const ok = await act(
      () =>
        api.loyalty.addFamily(memberId, {
          name: name.trim(),
          relation: relation.trim() || undefined,
          birthDay: Number(day),
          birthMonth: Number(month),
          birthYear: yearNum,
        }),
      "Не удалось добавить день рождения",
    );
    if (ok) reset();
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Дни рождения</h3>
        {editable && !adding && family.length < LOYALTY_MAX_FAMILY_MEMBERS && (
          <button type="button" onClick={() => setAdding(true)} className="text-sm font-medium text-accent hover:underline">
            + Добавить
          </button>
        )}
      </div>
      {error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {family.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {family.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div>
                <span className="font-medium text-foreground">{f.name}</span>
                {f.relation && <span className="text-muted"> · {f.relation}</span>}
                <span className="block text-muted">
                  {formatBirthday(f)}
                  {f.lastGiftYear !== null && ` · подарок ${f.lastGiftYear} начислен`}
                  {!f.giftEligibleNext && ` · ${formatDate(f.nextBirthday)} без подарка: добавлено менее чем за 30 дней`}
                </span>
              </div>
              {editable && canRemove && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Удалить день рождения: ${f.name}?`)) void act(() => api.loyalty.removeFamily(f.id), "Не удалось удалить");
                  }}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
                >
                  Удалить
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="text-sm text-muted">Не указаны</p>
      )}

      {adding && (
        <div className="mt-3 rounded-xl border border-border bg-surface-muted p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Имя</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Кто это</label>
              <input value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={50} placeholder="Сам клиент, сын, жена…" className={inputClass} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[5rem_1fr_6rem] gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">День</label>
              <select value={day} onChange={(e) => setDay(e.target.value)} className={inputClass} aria-label="День">
                <option value="" />
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Месяц</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} aria-label="Месяц">
                <option value="" />
                {MONTHS_GENITIVE_RU.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Год</label>
              <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="—" className={inputClass} aria-label="Год" />
            </div>
          </div>
          {day !== "" && month !== "" && !dateOk && <p className="mt-2 text-sm text-red-700">Такой даты нет</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={reset} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface">
              Отмена
            </button>
            <button
              type="button"
              disabled={busy || !name.trim() || !dateOk}
              onClick={submit}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              Добавить
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
