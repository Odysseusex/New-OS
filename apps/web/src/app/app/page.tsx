"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Gift, Hourglass, LogOut, Receipt, RotateCcw, Share, Sparkles, User, Wheat, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { CARD_CODE_STEP_SECONDS, LOYALTY_TIER_LABELS_RU, type ClubHistoryItemDto, type ClubInfoDto, type ClubProfileDto, type LoyaltyTierDto } from "@bakery-os/shared";
import { ClubApiError, clubApi, clubToken } from "@/lib/club-api";
import { Login } from "./_components/login";
import { useCardCode } from "./_components/card-code";
import { CARD_COLORS, cardStyle, useCardColor, type CardColor } from "./_components/card-colors";
import { bonusWord, fmtDay, fmtDayTime, fmtMoney, fmtMonth, fmtPoints, greeting, prettyPhone, privacyHref } from "./_components/format";

type Tab = "card" | "history" | "profile";
const REFRESH_MS = 60_000;
const HINT_KEY = "aa.club.installHintHidden";

export default function ClubApp() {
  const [phase, setPhase] = useState<"loading" | "login" | "in">("loading");
  const [info, setInfo] = useState<ClubInfoDto | null>(null);
  const [profile, setProfile] = useState<ClubProfileDto | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("card");

  const load = useCallback(async () => {
    if (!clubToken.get()) {
      setPhase("login");
      return;
    }
    try {
      const sentAt = Date.now();
      const me = await clubApi.me();
      // Server time at the middle of the round trip: the card code follows it.
      setOffsetMs(new Date(me.serverTime).getTime() - (sentAt + Date.now()) / 2);
      setProfile(me);
      setError(null);
      setPhase("in");
    } catch (err) {
      if (err instanceof ClubApiError && err.status === 401) {
        clubToken.set(null);
        setProfile(null);
        setError(err.message === "Войдите заново" ? null : err.message);
        setPhase("login");
      } else {
        setError(err instanceof ClubApiError ? err.message : "Не удалось загрузить карту");
        setPhase((p) => (p === "loading" ? "in" : p));
      }
    }
  }, []);

  useEffect(() => {
    clubApi.info().then(setInfo).catch(() => setInfo(null));
    void load();
  }, [load]);

  // Fresh balance after a purchase: on return to the app and once a minute.
  useEffect(() => {
    if (phase !== "in") return;
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [phase, load]);

  if (phase === "loading") {
    return (
      <div className="aa-splash">
        <img src="/site/app/logo.png" alt="Ar Amir" />
      </div>
    );
  }
  if (phase === "login") {
    return (
      <>
        {error && (
          <div className="aa-frame no-tabs" style={{ minHeight: 0, paddingBottom: 0 }}>
            <div className="aa-error">{error}</div>
          </div>
        )}
        <Login info={info} onSignedIn={() => void load()} />
      </>
    );
  }
  if (!profile) {
    return (
      <main className="aa-frame no-tabs">
        <div className="aa-error">{error ?? "Не удалось загрузить карту"}</div>
        <button type="button" className="aa-btn primary" onClick={() => void load()}>
          Повторить
        </button>
      </main>
    );
  }

  return (
    <>
      <main className="aa-frame aa-fade" key={tab}>
        <header className="aa-top">
          <img src="/site/app/logo.png" alt="" />
          <span className="brand">Ar Amir</span>
          <span className="hello">
            {greeting()}
            {profile.name ? (
              <>
                ,<br />
                <b style={{ color: "var(--aa-ink)" }}>{profile.name}</b>
              </>
            ) : null}
          </span>
        </header>
        {error && <div className="aa-error">{error}</div>}
        {tab === "card" && <CardTab profile={profile} offsetMs={offsetMs} />}
        {tab === "history" && <HistoryTab items={profile.history} />}
        {tab === "profile" && (
          <ProfileTab
            profile={profile}
            onRenamed={(name) => setProfile({ ...profile, name })}
            onLogout={async () => {
              await clubApi.logout().catch(() => undefined);
              clubToken.set(null);
              setProfile(null);
              setTab("card");
              setPhase("login");
            }}
          />
        )}
      </main>
      <nav className="aa-tabs" aria-label="Разделы">
        {(
          [
            ["card", "Карта", CreditCard],
            ["history", "История", Receipt],
            ["profile", "Профиль", User],
          ] as const
        ).map(([key, label, Icon]) => (
          <button key={key} type="button" className={`aa-tab${tab === key ? " on" : ""}`} onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}>
            <Icon size={20} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

// ── Карта ────────────────────────────────────────────────────────────────

function CardTab({ profile, offsetMs }: { profile: ClubProfileDto; offsetMs: number }) {
  const code = useCardCode(profile.card.secret, profile.phone, offsetMs);
  const [color] = useCardColor();
  const p = profile.programme;
  const last4 = profile.phone.replace(/\D/g, "").slice(-4);

  return (
    <>
      <section className="aa-card" aria-label="Бонусная карта" style={cardStyle(color)}>
        <WheatArt />
        <div className="row">
          <span className="mark">Ar Amir</span>
          <span className="kind">{profile.tier ? `${LOYALTY_TIER_LABELS_RU[profile.tier.tier]} · ${fmtPoints(profile.tier.percent)}%` : "Бонусная карта"}</span>
        </div>
        <div className="balance">
          <strong>{fmtPoints(profile.balance)}</strong>
          <span>{bonusWord(profile.balance)}</span>
        </div>
        <div className="foot">
          <b>{profile.name ?? "Гость пекарни"}</b>
          <span>
            •• {last4.slice(0, 2)} {last4.slice(2)}
          </span>
        </div>
      </section>

      {(profile.pending || profile.expiring) && (
        <div className="aa-chips">
          {profile.pending && (
            <div className="aa-chip">
              <Sparkles size={18} />
              <span>
                <b>+{fmtPoints(profile.pending.points)}</b> {bonusWord(profile.pending.points)} станут доступны {fmtDay(profile.pending.from)}
              </span>
            </div>
          )}
          {profile.expiring && (
            <div className="aa-chip warn">
              <Hourglass size={18} />
              <span>
                {fmtPoints(profile.expiring.points)} {bonusWord(profile.expiring.points)} сгорят {fmtDay(profile.expiring.at)}
              </span>
            </div>
          )}
        </div>
      )}

      {profile.tier && <LevelPanel tier={profile.tier} />}

      <section className="aa-panel aa-qr" aria-label="QR-код для кассы">
        <span className="aa-eyebrow">Покажите кассиру</span>
        <div className="box">{code ? <QRCodeSVG value={code.payload} size={208} level="M" marginSize={0} /> : <div style={{ width: 208, height: 208 }} />}</div>
        <div className="code">{code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : "··· ···"}</div>
        {code && (
          <span className="timer">
            <Ring left={code.left} /> Код обновится через {code.left} с
          </span>
        )}
        <span className="aa-muted" style={{ fontSize: 13 }}>
          Или назовите номер телефона
        </span>
      </section>

      <section className="aa-facts" aria-label="Правила программы">
        <div className="aa-fact">
          <strong>{fmtPoints(profile.tier?.percent ?? p.earnPercent)}%</strong>
          <span>бонусами с каждой покупки</span>
        </div>
        <div className="aa-fact">
          <strong>{fmtPoints(p.maxRedeemPercent)}%</strong>
          <span>чека можно оплатить бонусами</span>
        </div>
        <div className="aa-fact">
          <strong>{p.pointsLifetimeMonths} мес.</strong>
          <span>живут бонусы за покупки</span>
        </div>
      </section>
      <p className="aa-muted" style={{ textAlign: "center", fontSize: 12.5, margin: 0 }}>
        1 бонус = 1 ₸. Тратить можно только в пекарнях Ar Amir.
      </p>

      <InstallHint />
    </>
  );
}

// The member's level and the way to the next one.
function LevelPanel({ tier }: { tier: LoyaltyTierDto }) {
  const next = tier.next;
  const share = next ? Math.max(0.03, Math.min(1, tier.spend / next.threshold)) : 1;
  return (
    <section className="aa-panel aa-level" aria-label="Уровень">
      <div className="head">
        <span className="aa-eyebrow">Ваш уровень</span>
        <b>
          {LOYALTY_TIER_LABELS_RU[tier.tier]} · {fmtPoints(tier.percent)}%
        </b>
      </div>
      <div className="bar" role="presentation">
        <i style={{ width: `${share * 100}%` }} />
      </div>
      <p>
        {next ? (
          <>
            До уровня «{LOYALTY_TIER_LABELS_RU[next.tier]}» ({fmtPoints(next.percent)}%) осталось <b>{fmtMoney(Math.ceil(next.remaining))}</b>
          </>
        ) : (
          "Это высший уровень"
        )}
      </p>
      {tier.heldUntil && <p className="note">Уровень сохраняется до {fmtDay(tier.heldUntil)}</p>}
      <p className="note">Считаются покупки за последние {tier.windowDays} дней</p>
    </section>
  );
}

function Ring({ left }: { left: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg className="aa-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="track" cx="8" cy="8" r={r} />
      <circle className="fill" cx="8" cy="8" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - left / CARD_CODE_STEP_SECONDS)} />
    </svg>
  );
}

// A stylised ear of wheat, drawn faintly on the card.
function WheatArt() {
  const grains = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg className="wheat" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M60 196 C 90 150, 120 100, 150 18" />
        {grains.map((i) => {
          const t = 0.18 + i * 0.1;
          const x = 60 + (150 - 60) * t + 2;
          const y = 196 - (196 - 18) * t;
          return (
            <g key={i}>
              <ellipse cx={x - 14} cy={y - 4} rx="7" ry="15" transform={`rotate(-38 ${x - 14} ${y - 4})`} fill="currentColor" fillOpacity="0.35" />
              <ellipse cx={x + 12} cy={y - 10} rx="7" ry="15" transform={`rotate(42 ${x + 12} ${y - 10})`} fill="currentColor" fillOpacity="0.35" />
            </g>
          );
        })}
        <ellipse cx="152" cy="10" rx="6" ry="13" fill="currentColor" fillOpacity="0.35" />
      </g>
    </svg>
  );
}

// «Add to home screen»: iPhone has no prompt of its own, so it is explained once.
function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      setShow(ios && !standalone && localStorage.getItem(HINT_KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <section className="aa-panel" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Share size={20} style={{ color: "var(--aa-wheat)", flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, fontSize: 14 }}>
        <b>Карта всегда под рукой.</b> Нажмите «Поделиться» внизу Safari, затем «На экран “Домой”».
      </div>
      <button
        type="button"
        aria-label="Скрыть"
        style={{ border: 0, background: "none", padding: 2, color: "var(--aa-muted)" }}
        onClick={() => {
          try {
            localStorage.setItem(HINT_KEY, "1");
          } catch {
            // the hint just comes back next time
          }
          setShow(false);
        }}
      >
        <X size={18} />
      </button>
    </section>
  );
}

// ── История ──────────────────────────────────────────────────────────────

function HistoryTab({ items }: { items: ClubHistoryItemDto[] }) {
  const groups = useMemo(() => {
    const out: { month: string; items: ClubHistoryItemDto[] }[] = [];
    for (const item of items) {
      const month = fmtMonth(item.at);
      if (out[out.length - 1]?.month !== month) out.push({ month, items: [] });
      out[out.length - 1].items.push(item);
    }
    return out;
  }, [items]);

  return (
    <>
      <h1 className="aa-h2">История</h1>
      {groups.length === 0 ? (
        <div className="aa-panel aa-empty">Здесь появятся ваши покупки и бонусы.</div>
      ) : (
        groups.map((g) => (
          <section key={g.month}>
            <div className="aa-month">{g.month}</div>
            <div className="aa-list">
              {g.items.map((item) => (
                <HistoryRow key={`${item.kind}:${item.id}`} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function HistoryRow({ item }: { item: ClubHistoryItemDto }) {
  const Icon = item.kind === "PURCHASE" ? Wheat : item.kind === "RETURN" ? RotateCcw : item.kind === "BONUS" ? Gift : item.kind === "EXPIRED" ? Hourglass : Sparkles;
  const tone = item.kind === "EXPIRED" || item.kind === "RETURN" ? "minus" : item.kind === "BONUS" ? "plus" : "";
  return (
    <div className="aa-item">
      <span className={`ic ${tone}`}>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <div className="main">
        <span className="title">{item.title}</span>
        <span className="meta">
          {fmtDayTime(item.at)}
          {item.place ? ` · ${item.place}` : ""}
        </span>
      </div>
      <div className="nums">
        {item.amount !== null && <span className="money">{fmtMoney(item.amount)}</span>}
        {item.points !== null && item.points !== 0 && (
          <span className={`pts ${item.points > 0 ? "up" : "down"}`}>
            {item.points > 0 ? "+" : "−"}
            {fmtPoints(Math.abs(item.points))} {bonusWord(item.points)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Профиль ──────────────────────────────────────────────────────────────

function ProfileTab({ profile, onRenamed, onLogout }: { profile: ClubProfileDto; onRenamed: (name: string | null) => void; onLogout: () => Promise<void> }) {
  const [name, setName] = useState(profile.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== (profile.name ?? "");
  const [color, setColor] = useCardColor();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await clubApi.rename(name);
      onRenamed(res.name);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ClubApiError ? err.message : "Не получилось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="aa-h2">Профиль</h1>
      <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="aa-field">
          <label htmlFor="aa-rename">Как к вам обращаться</label>
          <input
            id="aa-rename"
            className="aa-input"
            value={name}
            maxLength={60}
            placeholder="Имя"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        {error && <div className="aa-error">{error}</div>}
        <button type="button" className="aa-btn primary" disabled={!changed || saving} onClick={save}>
          {saved && !changed ? "Сохранено" : saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </section>
      <section className="aa-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--aa-ink2)" }}>Цвет карты</span>
        <div className="aa-swatches" role="radiogroup" aria-label="Цвет карты">
          {(Object.keys(CARD_COLORS) as CardColor[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={color === key}
              className={`aa-swatch${color === key ? " on" : ""}`}
              onClick={() => setColor(key)}
            >
              <span style={{ background: CARD_COLORS[key].vars["--c-bg"] }} />
              {CARD_COLORS[key].label}
            </button>
          ))}
        </div>
      </section>
      <section className="aa-panel" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="aa-row">
          <span className="k">Телефон</span>
          <span className="v">{prettyPhone(profile.phone)}</span>
        </div>
        <div className="aa-row">
          <span className="k">С нами с</span>
          <span className="v">{fmtDay(profile.memberSince)}</span>
        </div>
        <div className="aa-row">
          <span className="k">Покупок</span>
          <span className="v">{profile.visits}</span>
        </div>
      </section>
      <button type="button" className="aa-btn ghost" onClick={() => void onLogout()}>
        <LogOut size={18} /> Выйти
      </button>
      <p className="aa-muted" style={{ textAlign: "center", fontSize: 12.5, margin: 0 }}>
        <a href={privacyHref()} target="_blank" rel="noreferrer">
          Политика конфиденциальности
        </a>
      </p>
    </>
  );
}
