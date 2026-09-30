"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  STOCKTAKE_APPROVE_ROLES,
  STOCKTAKE_MANAGE_ROLES,
  STOCKTAKE_STATUS_LABELS_RU,
  StocktakeStatus,
} from "@bakery-os/shared";
import type { LocationDto, StocktakeDto, StocktakeLineDto, StocktakeSummaryDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";

const STATUS_STYLES: Record<StocktakeStatus, string> = {
  [StocktakeStatus.COUNTING]: "bg-amber-50 text-amber-700",
  [StocktakeStatus.REVIEW]: "bg-blue-50 text-blue-700",
  [StocktakeStatus.APPROVED]: "bg-green-50 text-green-700",
  [StocktakeStatus.CANCELLED]: "bg-surface-muted text-muted",
};

function StatusBadge({ status }: { status: StocktakeStatus }) {
  return (
    <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[status])}>
      {STOCKTAKE_STATUS_LABELS_RU[status]}
    </span>
  );
}

// Physical count of one location. Nothing here edits stock directly: the
// count is a document, and only «Провести» turns differences into ledger
// adjustments (server side). Counted quantities are saved per line on blur so
// a half-finished count survives a page reload or a dropped connection.
export function StocktakeTab({ locations }: { locations: LocationDto[] }) {
  const { user } = useAuth();
  const canManage = user ? STOCKTAKE_MANAGE_ROLES.includes(user.role) : false;
  const canApprove = user ? STOCKTAKE_APPROVE_ROLES.includes(user.role) : false;

  const [openId, setOpenId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");
  const [list, setList] = useState<StocktakeSummaryDto[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const load = useCallback(() => {
    setState("loading");
    api.stocktakes
      .list()
      .then((rows) => {
        setList(rows);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  async function create() {
    if (!locationId) return;
    setCreating(true);
    setError(null);
    try {
      const st = await api.stocktakes.create({ locationId });
      setOpenId(st.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось начать инвентаризацию");
    } finally {
      setCreating(false);
    }
  }

  if (openId) {
    return (
      <StocktakeDetail
        id={openId}
        canManage={canManage}
        canApprove={canApprove}
        onClose={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          <button
            onClick={create}
            disabled={creating || !locationId}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Создание…" : "Начать инвентаризацию"}
          </button>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {state === "loading" && <p className="text-sm text-muted">Загрузка…</p>}
      {state === "error" && <p className="text-sm text-red-700">Не удалось загрузить инвентаризации</p>}
      {state === "ready" && list.length === 0 && <p className="text-sm text-muted">Инвентаризаций пока нет</p>}

      {state === "ready" && list.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Точка</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 text-right font-medium">Посчитано</th>
                <th className="px-4 py-3 font-medium">Создал</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpenId(row.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted"
                >
                  <td className="px-4 py-3">{formatDateTime(row.snapshotAt)}</td>
                  <td className="px-4 py-3">{row.locationName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.countedCount} из {row.lineCount}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StocktakeDetail({
  id,
  canManage,
  canApprove,
  onClose,
}: {
  id: string;
  canManage: boolean;
  canApprove: boolean;
  onClose: () => void;
}) {
  const [st, setSt] = useState<StocktakeDto | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    api.stocktakes
      .get(id)
      .then((data) => {
        setSt(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [id]);

  async function run(action: () => Promise<StocktakeDto>) {
    setBusy(true);
    setError(null);
    try {
      setSt(await action());
      setConfirmApprove(false);
      setCancelling(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusy(false);
    }
  }

  async function saveCount(line: StocktakeLineDto, raw: string) {
    if (!st) return;
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed.replace(/\s/g, "").replace(",", "."));
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError(`Неверное количество для «${line.productName}»`);
      return;
    }
    if (next === line.countedQuantity) return;
    setError(null);
    try {
      setSt(await api.stocktakes.updateLine(st.id, line.id, { countedQuantity: next }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить количество");
    }
  }

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!st) return [];
    return st.lines.filter((l) => {
      if (onlyDiff && (l.difference === null || l.difference === 0)) return false;
      if (!query) return true;
      return l.productName.toLowerCase().includes(query) || l.sku.toLowerCase().includes(query);
    });
  }, [st, query, onlyDiff]);

  if (state === "loading") return <p className="text-sm text-muted">Загрузка…</p>;
  if (state === "error" || !st) {
    return (
      <div>
        <button onClick={onClose} className="mb-3 text-sm text-accent">← К списку</button>
        <p className="text-sm text-red-700">Не удалось загрузить инвентаризацию</p>
      </div>
    );
  }

  const counting = st.status === StocktakeStatus.COUNTING;
  const review = st.status === StocktakeStatus.REVIEW;
  const open = counting || review;
  const uncostedDiffs = st.lines.filter((l) => l.difference !== null && l.difference !== 0 && l.unitCost === null).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onClose} className="text-sm font-medium text-accent">← К списку</button>
        <h2 className="text-lg font-semibold text-foreground">Инвентаризация · {st.locationName}</h2>
        <StatusBadge status={st.status} />
        <span className="text-sm text-muted">Остатки на {formatDateTime(st.snapshotAt)}</span>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {st.snapshotDriftCount > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Остатки не сходятся с журналом движений: {st.snapshotDriftCount} поз.
        </div>
      )}
      {st.status === StocktakeStatus.CANCELLED && st.cancelReason && (
        <div className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-foreground">
          Причина отмены: {st.cancelReason}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Посчитано" value={`${st.countedCount} из ${st.lineCount}`} />
        <Stat label="Недостача" value={formatMoney(st.shortageValue)} tone="red" />
        <Stat label="Излишек" value={formatMoney(st.surplusValue)} tone="green" />
        <Stat label="Сальдо" value={formatMoney(st.surplusValue - st.shortageValue)} />
      </div>
      {uncostedDiffs > 0 && (
        <p className="mb-4 text-sm text-amber-700">
          Себестоимость не определена у {uncostedDiffs} поз. с расхождением — в оценку не входят.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск товара…"
          className="min-w-[200px] flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Только расхождения
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Товар</th>
              <th className="px-4 py-3 font-medium">Категория</th>
              <th className="px-4 py-3 text-right font-medium">По учёту</th>
              <th className="px-4 py-3 text-right font-medium">Факт</th>
              <th className="px-4 py-3 text-right font-medium">Расхождение</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => (
              <CountRow key={line.id} line={line} editable={counting && canManage} onSave={saveCount} />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">Нет позиций</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {counting && canManage && (
            <button
              disabled={busy}
              onClick={() => run(() => api.stocktakes.submit(st.id))}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Отправить на проверку
            </button>
          )}
          {review && canManage && (
            <button
              disabled={busy}
              onClick={() => run(() => api.stocktakes.reopen(st.id))}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
            >
              Вернуть к подсчёту
            </button>
          )}
          {review && canApprove && !confirmApprove && (
            <button
              disabled={busy}
              onClick={() => setConfirmApprove(true)}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Провести
            </button>
          )}
          {review && canApprove && confirmApprove && (
            <>
              <span className="text-sm text-foreground">
                Будут созданы корректировки остатков. Отменить проведение нельзя.
              </span>
              <button
                disabled={busy}
                onClick={() => run(() => api.stocktakes.approve(st.id))}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                Подтвердить проведение
              </button>
              <button
                onClick={() => setConfirmApprove(false)}
                className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted"
              >
                Назад
              </button>
            </>
          )}
          {canManage && !cancelling && (
            <button
              onClick={() => setCancelling(true)}
              className="rounded-xl border border-border px-4 py-2.5 text-sm text-red-700 hover:bg-red-50"
            >
              Отменить инвентаризацию
            </button>
          )}
          {canManage && cancelling && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина отмены"
                className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => run(() => api.stocktakes.cancel(st.id, reason.trim()))}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Отменить
              </button>
              <button
                onClick={() => setCancelling(false)}
                className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground hover:bg-surface-muted"
              >
                Назад
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={clsx(
          "mt-1 text-lg font-semibold",
          tone === "red" ? "text-red-700" : tone === "green" ? "text-green-700" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CountRow({
  line,
  editable,
  onSave,
}: {
  line: StocktakeLineDto;
  editable: boolean;
  onSave: (line: StocktakeLineDto, raw: string) => void;
}) {
  const [value, setValue] = useState(line.countedQuantity === null ? "" : String(line.countedQuantity));
  useEffect(() => {
    setValue(line.countedQuantity === null ? "" : String(line.countedQuantity));
  }, [line.countedQuantity]);

  const diff = line.difference;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5">
        <div className="font-medium text-foreground">{line.productName}</div>
        <div className="text-xs text-muted">{line.sku}</div>
      </td>
      <td className="px-4 py-2.5 text-muted">{line.categoryName ?? "—"}</td>
      <td className="px-4 py-2.5 text-right">
        {formatQuantity(line.systemQuantity)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {editable ? (
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onSave(line, value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-right text-base text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        ) : line.countedQuantity === null ? (
          "—"
        ) : (
          formatQuantity(line.countedQuantity)
        )}
      </td>
      <td
        className={clsx(
          "px-4 py-2.5 text-right font-medium",
          diff === null || diff === 0 ? "text-muted" : diff < 0 ? "text-red-700" : "text-green-700",
        )}
      >
        {diff === null ? "—" : diff > 0 ? `+${formatQuantity(diff)}` : formatQuantity(diff)}
      </td>
      <td className="px-4 py-2.5 text-right text-muted">
        {line.differenceValue === null ? "—" : formatMoney(line.differenceValue)}
      </td>
    </tr>
  );
}
