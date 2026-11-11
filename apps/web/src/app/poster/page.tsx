"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { ClubInfoDto } from "@bakery-os/shared";
import { clubApi } from "@/lib/club-api";

// A4 poster next to the till: scan → the customer app. Three looks to choose
// from (?v=photo|sage|editorial). Bonus figures are read live from the
// programme's settings and left out if they cannot be loaded.
const APP_URL = "https://ar-amir.com/app";
const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const VARIANTS = [
  ["photo", "Фото"],
  ["sage", "Шалфей"],
  ["editorial", "Журнал"],
] as const;
type Variant = (typeof VARIANTS)[number][0];

export default function PosterPage() {
  return (
    <Suspense fallback={null}>
      <Poster />
    </Suspense>
  );
}

function Poster() {
  const router = useRouter();
  const params = useSearchParams();
  const v = (VARIANTS.find(([key]) => key === params.get("v"))?.[0] ?? "photo") as Variant;
  const [info, setInfo] = useState<ClubInfoDto | null>(null);
  useEffect(() => {
    clubApi.info().then(setInfo).catch(() => setInfo(null));
  }, []);

  return (
    <main>
      <div className="pp-bar">
        <div className="pp-switch" role="radiogroup" aria-label="Вид плаката">
          {VARIANTS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={v === key} className={v === key ? "on" : ""} onClick={() => router.replace(`/poster?v=${key}`)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="pp-print" onClick={() => window.print()}>
          Печать
        </button>
      </div>
      {v === "photo" && <PhotoPoster info={info} />}
      {v === "sage" && <SagePoster info={info} />}
      {v === "editorial" && <EditorialPoster info={info} />}
    </main>
  );
}

function Qr({ size }: { size: string }) {
  return (
    <QRCodeSVG
      value={APP_URL}
      size={420}
      level="H"
      marginSize={0}
      bgColor="#ffffff"
      fgColor="#1f1712"
      imageSettings={{ src: "/site/app/icon-192.png", height: 76, width: 76, excavate: true }}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}

function channelOf(info: ClubInfoDto | null) {
  return info?.whatsapp && info.telegram ? "WhatsApp или Telegram" : info?.whatsapp ? "WhatsApp" : "Telegram";
}

function Steps({ info, className }: { info: ClubInfoDto | null; className: string }) {
  return (
    <ol className={className}>
      <li>
        <b>1</b>
        <span>Наведите камеру телефона на код</span>
      </li>
      <li>
        <b>2</b>
        <span>Войдите по номеру — подтверждение через {channelOf(info)}</span>
      </li>
      <li>
        <b>3</b>
        <span>Покажите карту на кассе и копите бонусы</span>
      </li>
    </ol>
  );
}

function Perks({ info, className }: { info: ClubInfoDto | null; className: string }) {
  const p = info?.programme;
  if (!p?.enabled) return null;
  return (
    <div className={className}>
      <div>
        <strong>{fmt.format(p.earnPercent)}%</strong>
        <span>бонусами с каждой покупки</span>
      </div>
      <div>
        <strong>{fmt.format(p.maxRedeemPercent)}%</strong>
        <span>чека можно оплатить бонусами</span>
      </div>
      <div>
        <strong>1 = 1 ₸</strong>
        <span>один бонус — один тенге</span>
      </div>
    </div>
  );
}

// 1. A big photo on top, white below — a coffee-shop menu board.
function PhotoPoster({ info }: { info: ClubInfoDto | null }) {
  return (
    <section className="pp-sheet pa">
      <div className="pa-photo">
        <img className="pa-logo" src="/site/app/logo.png" alt="Ar Amir" />
      </div>
      <div className="pa-body">
        <div className="pp-eyebrow">Бонусная карта Ar Amir</div>
        <h1 className="pp-title">
          Копите бонусы
          <br />с каждой покупки
        </h1>
        <div className="pa-row">
          <div className="pa-qr">
            <Qr size="72mm" />
          </div>
          <div className="pa-side">
            <Steps info={info} className="pa-steps" />
            <div className="pp-url">ar-amir.com/app</div>
          </div>
        </div>
        <Perks info={info} className="pa-perks" />
      </div>
    </section>
  );
}

// 2. Deep sage, like the card in the app.
function SagePoster({ info }: { info: ClubInfoDto | null }) {
  return (
    <section className="pp-sheet pb">
      <img className="pb-logo" src="/site/app/logo.png" alt="Ar Amir" />
      <div className="pp-eyebrow">Бонусная карта</div>
      <h1 className="pp-title">
        Ваша карта Ar Amir
        <br />— в телефоне
      </h1>
      <div className="pb-qr">
        <Qr size="92mm" />
      </div>
      <div className="pp-url">ar-amir.com/app</div>
      <Steps info={info} className="pb-steps" />
      <Perks info={info} className="pb-perks" />
    </section>
  );
}

// 3. A tall photo on the left, the text on the right — a magazine page.
function EditorialPoster({ info }: { info: ClubInfoDto | null }) {
  return (
    <section className="pp-sheet pc">
      <div className="pc-photo" />
      <div className="pc-body">
        <img className="pc-logo" src="/site/app/logo.png" alt="Ar Amir" />
        <div className="pp-eyebrow">Бонусная карта</div>
        <h1 className="pp-title">
          Свежая выпечка.
          <br />
          Приятные бонусы.
        </h1>
        <p className="pc-lead">Карта постоянного гостя Ar Amir теперь в вашем телефоне.</p>
        <div className="pc-qr">
          <Qr size="70mm" />
        </div>
        <div className="pp-url">ar-amir.com/app</div>
        <Steps info={info} className="pc-steps" />
        <Perks info={info} className="pc-perks" />
      </div>
    </section>
  );
}
