"use client";

import { useState } from "react";
import type { LocationDto, RegionDto } from "@bakery-os/shared";
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
  location,
  onClose,
  onSaved,
}: {
  regions: RegionDto[];
  location?: LocationDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [type, setType] = useState<LocationType>(location?.type ?? LocationType.STORE);
  const [ownership, setOwnership] = useState<LocationOwnership>(
    location?.ownership ?? LocationOwnership.OWNED,
  );
  const [regionId, setRegionId] = useState(location?.regionId ?? regions[0]?.id ?? "");
  const [city, setCity] = useState(location?.city ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const dto = { name, type, ownership, regionId: regionId || undefined, city, address };
      if (location) {
        await api.locations.update(location.id, dto);
      } else {
        await api.locations.create(dto);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить точку");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={location ? "Редактировать точку" : "Новая точка"} onClose={onClose}>
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
          {isSubmitting ? "Сохранение…" : location ? "Сохранить" : "Добавить точку"}
        </button>
      </form>
    </Modal>
  );
}
