"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { normalizeBin } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

// The name and БИН/ИИН printed at the head of an акт сверки.
export function OrganizationRequisitesCard() {
  const [legalName, setLegalName] = useState("");
  const [bin, setBin] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.organization
      .requisites()
      .then((r) => {
        setLegalName(r.legalName ?? "");
        setBin(r.bin ?? "");
        setLoaded(true);
      })
      .catch((err) => setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Не удалось загрузить реквизиты" }));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (bin.trim() !== "" && normalizeBin(bin) === null) {
      setMessage({ ok: false, text: "БИН/ИИН — 12 цифр" });
      return;
    }
    setSaving(true);
    try {
      const saved = await api.organization.updateRequisites({ legalName: legalName.trim() || null, bin: bin.trim() || null });
      setLegalName(saved.legalName ?? "");
      setBin(saved.bin ?? "");
      setMessage({ ok: true, text: "Сохранено" });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Не удалось сохранить" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold text-foreground">Реквизиты организации</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Наименование для документов</label>
          <input
            type="text"
            maxLength={200}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="ИП …"
            disabled={!loaded}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">БИН / ИИН</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={15}
            value={bin}
            onChange={(e) => setBin(e.target.value)}
            placeholder="12 цифр"
            disabled={!loaded}
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!loaded || saving}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        {message && <span className={message.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{message.text}</span>}
      </div>
    </form>
  );
}
