"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ClubInfoDto } from "@bakery-os/shared";
import { clubApi } from "@/lib/club-api";

// A4 poster next to the till: scan → the customer app. Warm paper, a gold
// hairline frame, no slogan; nothing but the code and what to do with it. Bonus figures are read live from
// the programme's settings and left out if they cannot be loaded.
const APP_URL = "https://ar-amir.com/app";
const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export default function PosterPage() {
  const [info, setInfo] = useState<ClubInfoDto | null>(null);
  useEffect(() => {
    clubApi.info().then(setInfo).catch(() => setInfo(null));
  }, []);
  const p = info?.programme;
  const channel = info?.whatsapp && info.telegram ? "WhatsApp или Telegram" : info?.whatsapp ? "WhatsApp" : "Telegram";

  return (
    <main>
      <div className="pp-bar">
        <button type="button" className="pp-print" onClick={() => window.print()}>
          Печать
        </button>
      </div>
      <section className="pp-sheet">
        <header className="pp-head">
          <img className="pp-logo" src="/site/app/logo.png" alt="Ar Amir" />
          <span className="pp-brand">Ar Amir</span>
        </header>
        <div className="pp-orn" aria-hidden="true">
          <i />
          <em />
          <i />
        </div>

        <h1 className="pp-label">Бонусная карта</h1>

        <div className="pp-qr">
          <QRCodeSVG
            value={APP_URL}
            size={480}
            level="H"
            marginSize={0}
            bgColor="#ffffff"
            fgColor="#1f1712"
            imageSettings={{ src: "/site/app/icon-192.png", height: 84, width: 84, excavate: true }}
            style={{ width: "92mm", height: "92mm", display: "block" }}
          />
        </div>
        <div className="pp-url">ar-amir.com/app</div>

        <ol className="pp-steps">
          <li>
            <b>1</b>
            <span>Наведите камеру телефона на код</span>
          </li>
          <li>
            <b>2</b>
            <span>Войдите по номеру через {channel}</span>
          </li>
          <li>
            <b>3</b>
            <span>Покажите карту на кассе</span>
          </li>
        </ol>

        {p?.enabled && (
          <footer className="pp-perks">
            <div>
              <strong>{fmt.format(p.earnPercent)}%</strong>
              <span>бонусами с каждой покупки</span>
            </div>
            <div>
              <strong>до {fmt.format(p.maxRedeemPercent)}%</strong>
              <span>чека можно оплатить бонусами</span>
            </div>
            <div>
              <strong>1 = 1 ₸</strong>
              <span>один бонус — один тенге</span>
            </div>
          </footer>
        )}
      </section>
    </main>
  );
}
