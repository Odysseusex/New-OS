"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import type { ClubInfoDto } from "@bakery-os/shared";
import { ClubApiError, clubApi, clubToken, pendingLogin, type PendingLogin } from "@/lib/club-api";
import { displayNational, fmtPoints, nationalDigits, privacyHref } from "./format";

const POLL_MS = 2500;

// Sign-in: the number, then one message from that number (WhatsApp or the
// Telegram bot). No password and no SMS.
export function Login({ info, onSignedIn }: { info: ClubInfoDto | null; onSignedIn: () => void }) {
  const [pending, setPending] = useState<PendingLogin | null>(() => pendingLogin.get());

  if (pending) {
    return (
      <Confirm
        pending={pending}
        onBack={() => {
          pendingLogin.set(null);
          setPending(null);
        }}
        onSignedIn={onSignedIn}
      />
    );
  }
  return <Start info={info} onStarted={setPending} />;
}

function Start({ info, onStarted }: { info: ClubInfoDto | null; onStarted: (p: PendingLogin) => void }) {
  const [digits, setDigits] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(true);
  // The WhatsApp notices box only while WhatsApp is switched on for the app.
  const whatsappOn = info?.whatsapp === true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const programme = info?.programme ?? null;
  const ready = digits.length === 10 && consent && !busy;

  const start = async () => {
    setError(null);
    if (digits.length !== 10 || !digits.startsWith("7")) {
      setError("Введите номер полностью, например 701 123 45 67");
      return;
    }
    setBusy(true);
    try {
      const started = await clubApi.startLogin({ phone: `+7${digits}`, name: name.trim() || undefined, consent, marketing: whatsappOn && marketing });
      const value = { ...started, phone: `+7${digits}` };
      pendingLogin.set(value);
      onStarted(value);
    } catch (err) {
      setError(err instanceof ClubApiError ? err.message : "Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="aa-frame no-tabs aa-fade">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 18 }}>
        <img src="/site/app/logo.png" alt="Ar Amir" className="aa-hero-logo" />
        <span className="aa-eyebrow">Бонусная карта</span>
        <h1 className="aa-h1">Ar Amir</h1>
        {programme && (
          <p className="aa-sub" style={{ maxWidth: 340 }}>
            {programme.tiers ? `От ${fmtPoints(programme.earnPercent)}% до ${fmtPoints(programme.tiers.platinum.percent)}%` : `${fmtPoints(programme.earnPercent)}%`} бонусами с каждой покупки. Оплачивайте ими до {fmtPoints(programme.maxRedeemPercent)}% чека.
          </p>
        )}
      </div>

      <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="aa-field">
          <label htmlFor="aa-phone">Номер телефона</label>
          <div className="aa-phone">
            <span>+7</span>
            <input
              id="aa-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="701 123 45 67"
              value={displayNational(digits)}
              onChange={(e) => setDigits(nationalDigits(e.target.value))}
            />
          </div>
        </div>
        <div className="aa-field">
          <label htmlFor="aa-name">Как к вам обращаться</label>
          <input id="aa-name" className="aa-input" autoComplete="given-name" placeholder="Имя" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="aa-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Согласен(на) на обработку персональных данных согласно{" "}
            <a href={privacyHref()} target="_blank" rel="noreferrer">
              политике конфиденциальности
            </a>
          </span>
        </label>
        {whatsappOn && (
          <label className="aa-check">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>Присылать уведомления о бонусах и подарках в WhatsApp</span>
          </label>
        )}
        {error && <div className="aa-error">{error}</div>}
        {info && !info.ready ? (
          <div className="aa-error">Вход временно недоступен. Загляните позже.</div>
        ) : (
          <button type="button" className="aa-btn primary" disabled={!ready} onClick={start}>
            {busy ? "Секунду…" : "Продолжить"}
          </button>
        )}
      </section>
      <p className="aa-muted" style={{ textAlign: "center", fontSize: 13, margin: 0 }}>
        Пароль не нужен: вход подтверждается одним сообщением с вашего номера.
      </p>
    </main>
  );
}

function Confirm({ pending, onBack, onSignedIn }: { pending: PendingLogin; onBack: () => void; onSignedIn: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await clubApi.loginStatus(pending.requestId, pending.secret);
      if (res.status === "CONFIRMED" && res.token) {
        clubToken.set(res.token);
        pendingLogin.set(null);
        onSignedIn();
      } else if (res.status === "EXPIRED" || res.status === "USED") {
        setExpired(true);
      }
    } catch (err) {
      if (err instanceof ClubApiError && err.status === 404) setExpired(true);
      else if (err instanceof ClubApiError && err.status !== 0) setError(err.message);
    } finally {
      busy.current = false;
    }
  }, [pending, onSignedIn]);

  useEffect(() => {
    if (expired) return;
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    // Back from WhatsApp: check at once instead of waiting for the next tick.
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [poll, expired]);

  return (
    <main className="aa-frame no-tabs aa-fade">
      <div className="aa-top">
        <button type="button" className="aa-link" onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
          <ArrowLeft size={18} /> Другой номер
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="aa-eyebrow">Подтверждение</span>
        <h1 className="aa-h1" style={{ fontSize: 34 }}>
          Отправьте нам одно сообщение
        </h1>
        <p className="aa-sub">Так мы убедимся, что номер {pending.phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2 $3 $4")} — ваш.</p>
      </div>

      {expired ? (
        <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0 }}>Время на подтверждение вышло. Начните вход заново — это займёт полминуты.</p>
          <button type="button" className="aa-btn primary" onClick={onBack}>
            Начать заново
          </button>
        </section>
      ) : (
        <>
          <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ol className="aa-steps">
              <li>
                <b>1</b>
                <span>Нажмите кнопку — откроется чат с готовым сообщением.</span>
              </li>
              <li>
                <b>2</b>
                <span>Нажмите «Отправить».</span>
              </li>
              <li>
                <b>3</b>
                <span>Вернитесь сюда — вход произойдёт сам.</span>
              </li>
            </ol>
            {pending.whatsappUrl && (
              <a className="aa-btn wa" href={pending.whatsappUrl} target="_blank" rel="noreferrer">
                <MessageCircle size={20} /> Открыть WhatsApp
              </a>
            )}
            {pending.telegramUrl && (
              <a className={`aa-btn ${pending.whatsappUrl ? "ghost" : "primary"}`} href={pending.telegramUrl} target="_blank" rel="noreferrer">
                <Send size={18} /> {pending.whatsappUrl ? "Через Telegram" : "Открыть Telegram"}
              </a>
            )}
          </section>
          <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
            <span className="aa-muted" style={{ fontSize: 13 }}>
              Код в сообщении
            </span>
            <div className="aa-bigcode">{pending.code}</div>
            <div className="aa-wait">
              <span className="aa-dot" /> Ждём ваше сообщение
            </div>
          </section>
          {error && <div className="aa-error">{error}</div>}
        </>
      )}
    </main>
  );
}
