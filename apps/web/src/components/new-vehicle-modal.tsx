"use client";

import { useState } from "react";
import type { VehicleDto } from "@bakery-os/shared";
import { VEHICLE_STATUS_LABELS_RU, VehicleStatus } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/modal";

export function NewVehicleModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle?: VehicleDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(vehicle?.name ?? "");
  const [plateNumber, setPlateNumber] = useState(vehicle?.plateNumber ?? "");
  const [status, setStatus] = useState<VehicleStatus>(vehicle?.status ?? VehicleStatus.AVAILABLE);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (vehicle) {
        await api.vehicles.update(vehicle.id, { name, plateNumber, status });
      } else {
        await api.vehicles.create({ name, plateNumber });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить транспорт");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={vehicle ? "Редактировать транспорт" : "Новый транспорт"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Название</label>
          <input
            type="text"
            required
            placeholder="Газель, Фургон…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className={vehicle ? "mb-5 grid grid-cols-2 gap-3" : "mb-5"}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Гос. номер</label>
            <input
              type="text"
              required
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {vehicle && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Статус</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {Object.values(VehicleStatus).map((s) => (
                  <option key={s} value={s}>
                    {VEHICLE_STATUS_LABELS_RU[s]}
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
          {isSubmitting ? "Сохранение…" : vehicle ? "Сохранить" : "Добавить транспорт"}
        </button>
      </form>
    </Modal>
  );
}
