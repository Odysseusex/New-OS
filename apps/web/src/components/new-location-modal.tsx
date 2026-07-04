"use client";

import { useState } from "react";
import type { RegionDto } from "@bakery-os/shared";
import {
  LOCATION_OWNERSHIP_LABELS_RU,
  LOCATION_TYPE_LABELS_RU,
  LocationOwnership,
  LocationType,
} from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewLocationModal({
  regions,
  onClose,
  onCreated,
}: {
  regions: RegionDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<LocationType>(LocationType.STORE);
  const [ownership, setOwnership] = useState<LocationOwnership>(LocationOwnership.OWNED);
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.locations.create({
        name,
        type,
        ownership,
        regionId: regionId || undefined,
        city,
        address,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить точку");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Новая точка" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Тип</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LocationType)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(LocationType).map((t) => (
                <option key={t} value={t}>
                  {LOCATION_TYPE_LABELS_RU[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Форма</label>
            <select
              value={ownership}
              onChange={(e) => setOwnership(e.target.value as LocationOwnership)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {Object.values(LocationOwnership).map((o) => (
                <option key={o} value={o}>
                  {LOCATION_OWNERSHIP_LABELS_RU[o]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {regions.length > 0 && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Регион</label>
            <select
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Город</label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Адрес</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Сохранение…" : "Добавить точку"}
        </button>
      </form>
    </Modal>
  );
}
