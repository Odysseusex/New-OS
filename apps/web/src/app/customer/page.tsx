"use client";

import { useEffect, useRef, useState } from "react";
import { Award, Wheat } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCustomerDisplaySubscriber, type CustomerLine, type CustomerState } from "@/lib/customer-display";

// The buyer's screen on the two-screen monoblock.
//
// Deliberately NOT under (app): that layout draws the sidebar and topbar and
// bounces a CASHIER to /pos, so the till's own login would kick this page out
// the moment it opened.
//
// It is also completely passive — it makes no API call and needs no login. It
// renders only what the till window broadcasts to it, which is why it is safe
// for it to be reachable without a password: opened by itself it shows a
// welcome and nothing else.
//
// No fullscreen button here on purpose. This screen is a plain display on a
// two-screen monoblock — no touch, usually no mouse reaching it either — so
// anything that needed a tap or click on THIS screen was unusable by design.
// The till already opens this window sized to cover the whole second monitor
// (see openCustomerDisplay), which is as close to fullscreen as is reachable
// without any interaction here; the one silent attempt at true fullscreen
// below only helps if the browser allows it, and does nothing if not.
//
// One composition for all three states: the bakery's photographs fill the
// screen while nobody is being served and fold into a side panel when an order
// starts, so the screen never blinks from one page to another.

// The owner's own photographs (the public site's). Ones that survive being
// cropped both to a whole landscape screen and to a tall side panel.
const SLIDES = [
  "/site/croissant-coffee.jpg",
  "/site/hero-loaves.jpg",
  "/site/baguettes.jpg",
  "/site/kneading.jpg",
  "/site/baguette-basket.jpg",
  "/site/oven.jpg",
];
const SLIDE_MS = 9000;

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const amount = (value: number) => numberFormat.format(Math.round(value * 100) / 100);
const quantityFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

function Money({ value }: { value: number }) {
  return (
    <>
      {amount(value)}
      <small>₸</small>
    </>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 100;
  const u = d % 10;
  if (d > 10 && d < 20) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
}

export default function CustomerDisplayPage() {
  const [state, setState] = useState<CustomerState>({ kind: "idle", locationName: null });
  const [slide, setSlide] = useState(0);

  useCustomerDisplaySubscriber(setState);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {
      // Refused because there was no user gesture on this window — expected
      // most of the time. The window still covers the screen edge to edge.
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setSlide((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, []);

  const previous = (slide + SLIDES.length - 1) % SLIDES.length;

  // While nobody is being served the screen plays the film about the bonus card
  // (marketing/app-video; silent, looping, its QR always on screen). It starts
  // again from the beginning after each customer and steps aside for an order.
  // If the file cannot play, the photographs underneath simply stay.
  const video = useRef<HTMLVideoElement | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  // Shown only once it really plays: a monitor that cannot decode it keeps the photographs.
  const [playing, setPlaying] = useState(false);
  const idle = state.kind === "idle";
  // The owner's call (14.11.2026, «пока так»): the film stays on screen ALL the time,
  // over the order too. Set to false to bring back the order / «Спасибо» panels.
  const film = FILM_ALWAYS || idle;
  useEffect(() => {
    // An error raised before this page became interactive never reaches onError.
    const el = video.current;
    if (!el) return;
    if (el.error) setVideoOk(false);
    else if (!el.paused && el.readyState >= 3) setPlaying(true);
  }, []);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (FILM_ALWAYS) return;
    if (idle) {
      el.currentTime = 0;
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [idle]);

  return (
    <div className="cd" data-mode={state.kind === "idle" ? "idle" : "order"}>
      <div className="cd-photo">
        {SLIDES.map((src, i) => (
          <div
            key={src}
            className="cd-slide"
            data-state={i === slide ? "in" : i === previous ? "out" : undefined}
            style={{ backgroundImage: `url(${src})` }}
          />
        ))}
        <div className="cd-shade" />
        <div className="cd-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cd-logo" src="/site/logo.png" alt="Ар Амир" draggable={false} />
          <div className="cd-welcome">
            <h1>Добро пожаловать</h1>
            {state.locationName && (
              <>
                <span className="cd-rule" />
                <span className="cd-place">{state.locationName}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {videoOk && (
        <video
          ref={video}
          className="cd-video"
          data-on={film && playing ? "1" : undefined}
          src="/site/bonus-card.mp4"
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onError={() => setVideoOk(false)}
        />
      )}

      <div className="cd-panel">
        {state.kind === "cart" && <CartPanel state={state} />}
        {state.kind === "paid" && <PaidPanel state={state} />}
      </div>
    </div>
  );
}

const FILM_ALWAYS = true;

function CartPanel({ state }: { state: Extract<CustomerState, { kind: "cart" }> }) {
  // What the discounts on this order come to — markdown, coupon and points
  // alike arrive as a struck-through price on the line.
  const saved = state.lines.reduce(
    (sum, l) => (l.fullUnitPrice != null ? sum + (l.fullUnitPrice - l.unitPrice) * l.quantity : sum),
    0,
  );
  const count = state.lines.length;
  const member = state.member ?? null;

  return (
    <>
      <div className="cd-head">
        <h2>Ваш заказ</h2>
        <span className="cd-count">
          {count} {plural(count, "позиция", "позиции", "позиций")}
        </span>
      </div>

      {/* Bottom-aligned and clipped at the top: the item just rung up is always
          in view, and on a long order the oldest lines fade out above. */}
      <div className="cd-lines">
        {state.lines.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </div>

      <div className="cd-foot">
        {member && (
          <div className="cd-member">
            <Award strokeWidth={1.75} />
            <span>
              {member.name ? <b>{member.name}</b> : "Бонусная карта"} · {amount(Math.floor(member.points))}{" "}
              {plural(Math.floor(member.points), "балл", "балла", "баллов")}
            </span>
            {member.redeemed > 0 && <span className="cd-member-right">Оплачено баллами −{amount(member.redeemed)} ₸</span>}
          </div>
        )}
        <div className="cd-total">
          <span className="cd-total-label">
            К оплате
            {saved >= 1 && <span className="cd-saved">Ваша скидка {amount(Math.round(saved))} ₸</span>}
          </span>
          <span className="cd-total-sum">
            <Money value={state.total} />
          </span>
        </div>
      </div>
    </>
  );
}

function Line({ line }: { line: CustomerLine }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const discounted = line.fullUnitPrice != null && line.fullUnitPrice > line.unitPrice;
  return (
    <div className="cd-line">
      {line.photoUrl && !photoFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cd-thumb" src={line.photoUrl} alt="" draggable={false} onError={() => setPhotoFailed(true)} />
      ) : (
        <span className="cd-thumb cd-thumb-empty">
          <Wheat strokeWidth={1.5} />
        </span>
      )}
      <div className="cd-line-main">
        <div className="cd-name">{line.name}</div>
        <div className="cd-sub">
          <span>
            {quantityFormat.format(line.quantity)} {line.unit} ×
          </span>
          {discounted && <span className="cd-old">{amount(line.fullUnitPrice as number)} ₸</span>}
          <span className={discounted ? "cd-new" : undefined}>{amount(line.unitPrice)} ₸</span>
          {/* Spelled out as well as struck through: the buyer reads this from
              across the counter. Computed from the two prices, so it stays true
              whatever the markdown or coupon rate is; labelled generically
              because the same pair carries a markdown, a coupon or points. */}
          {discounted && (
            <span className="cd-off">−{Math.round((1 - line.unitPrice / (line.fullUnitPrice as number)) * 100)}%</span>
          )}
        </div>
      </div>
      <span className="cd-sum">{amount(line.unitPrice * line.quantity)} ₸</span>
    </div>
  );
}

function PaidPanel({ state }: { state: Extract<CustomerState, { kind: "paid" }> }) {
  const change = state.change != null && state.change > 0 ? state.change : null;
  const earned = state.pointsEarned != null && state.pointsEarned > 0 ? state.pointsEarned : null;
  return (
    <div className="cd-thanks">
      <svg className="cd-check" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="48" />
        <path d="M30 52 L44 66 L71 37" />
      </svg>
      <h2>Спасибо за покупку!</h2>
      <div className="cd-paid">
        <Money value={state.total} />
      </div>
      {(change !== null || earned !== null) && (
        <div className="cd-facts">
          {change !== null && (
            <div className="cd-fact">
              <span>Сдача</span>
              <b>{amount(change)} ₸</b>
            </div>
          )}
          {earned !== null && (
            <div className="cd-fact">
              <span>Начислено баллов</span>
              <b>+{amount(Math.floor(earned))}</b>
            </div>
          )}
        </div>
      )}
      {/* The fiscal receipt belongs to the buyer, and this screen is the one
          facing them — so the QR they are meant to scan goes here rather than
          only on the cashier's side. */}
      {state.qrCode ? (
        <div className="cd-qr">
          <div className="cd-qr-box">
            <QRCodeSVG value={state.qrCode} size={168} bgColor="#ffffff" fgColor="#000000" />
          </div>
          <span>
            Фискальный чек
            {state.receiptNumber && (
              <>
                <br />№ {state.receiptNumber}
              </>
            )}
          </span>
        </div>
      ) : (
        <div className="cd-bye">Ждём вас снова</div>
      )}
    </div>
  );
}
