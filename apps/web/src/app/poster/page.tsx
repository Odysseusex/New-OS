"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ClubInfoDto } from "@bakery-os/shared";
import { clubApi } from "@/lib/club-api";

// A4 poster next to the till: scan → the customer app. The bonus figures are
// read live from the programme's settings (left out if they cannot be loaded).
const APP_URL = "https://ar-amir.com/app";
const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export default function PosterPage() {
  const [info, setInfo] = useState<ClubInfoDto | null>(null);
  useEffect(() => {
    clubApi.info().then(setInfo).catch(() => setInfo(null));
  }, []);
  const p = info?.programme ?? null;
  const channel = info?.whatsapp && info.telegram ? "WhatsApp или Telegram" : info?.whatsapp ? "WhatsApp" : "Telegram";

  return (
    <main>
      <div className="pp-bar">
        <span>Лист A4. В окне печати выберите «Без полей» / масштаб 100 %.</span>
        <button type="button" onClick={() => window.print()}>
          Печать
        </button>
      </div>
      <section className="pp-sheet">
        <img className="pp-logo" src="/site/app/logo.png" alt="Ar Amir" />
        <div className="pp-eyebrow">Бонусная карта</div>
        <h1 className="pp-title">Копите бонусы
          <br />в Ar Amir</h1>
        <p className="pp-sub">Наведите камеру телефона на код</p>
        <div className="pp-qr">
          <QRCodeSVG
            value={APP_URL}
            size={420}
            level="H"
            marginSize={0}
            imageSettings={{ src: "/site/app/icon-192.png", height: 84, width: 84, excavate: true }}
            style={{ width: "84mm", height: "84mm" }}
          />
        </div>
        <div className="pp-url">ar-amir.com/app</div>
        <div className="pp-steps">
          <div className="pp-step">
            <b>1</b>
            <span>Отсканируйте код камерой телефона</span>
          </div>
          <div className="pp-step">
            <b>2</b>
            <span>Войдите по номеру — подтверждение через {channel}</span>
          </div>
          <div className="pp-step">
            <b>3</b>
            <span>Покажите карту на кассе и копите бонусы</span>
          </div>
        </div>
        {p && p.enabled && (
          <div className="pp-perks">
            <div className="pp-perk">
              <strong>{fmt.format(p.earnPercent)}%</strong>
              <span>бонусами с каждой покупки</span>
            </div>
            <div className="pp-perk">
              <strong>до {fmt.format(p.maxRedeemPercent)}%</strong>
              <span>чека можно оплатить бонусами</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
