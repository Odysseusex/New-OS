"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import {
  CLIENT_NAME,
  KaspiError,
  getTerminalUrl,
  getTokens,
  register,
  setTerminalUrl,
  setTokens,
  type KaspiTokens,
} from "@/lib/kaspi-terminal";

const DEFAULT_URL = "https://pos.kaspipos.kz:8080";
// Any single label under kaspipos.kz matches the terminal's wildcard
// certificate, so the name is ours to choose — it only has to be pointed at
// the terminal's address in the machine's hosts file.
const SUGGESTED_HOST = "pos.kaspipos.kz";

type Outcome =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "reachable"; body: string }
  | { kind: "blocked" }
  // `certificate` is a strong suspicion, not a measurement: a browser reports
  // a rejected certificate and an unreachable host as the same opaque
  // failure. What separates them is the address — see bareIpAddress below. The
  // address is carried here rather than re-parsed at render time, so that
  // editing the field afterwards cannot leave the instructions quoting a
  // different address than the one that failed — or throw on a half-typed one.
  | { kind: "certificate"; ip: string; port: string }
  | { kind: "unreachable" };

type Pairing =
  | { kind: "unpaired" }
  | { kind: "waiting" }
  // The terminal already knows this name and will not issue a second token,
  // so the old entry has to be removed on the terminal before retrying.
  | { kind: "alreadyPaired" }
  | { kind: "failed"; message: string }
  | { kind: "paired"; tokens: KaspiTokens };

// The terminal's certificate is issued to *.kaspipos.kz, so it only validates
// when the terminal is addressed by a name. Reached by its number the
// certificate cannot match, and a page's request is refused silently — no
// prompt, no way to click through, unlike typing the address by hand. So a
// failure against a bare address is the certificate until proven otherwise.
function bareIpAddress(raw: string): { ip: string; port: string } | null {
  try {
    const parsed = new URL(raw);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) return null;
    return { ip: parsed.hostname, port: parsed.port || "8080" };
  } catch {
    return null;
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

// A name rather than a number means the address is resolved through the
// machine's hosts file, which pins it to one number — so a failure has a
// cause, and a fix, that a numeric address does not.
function isHostname(raw: string): boolean {
  return Boolean(hostOf(raw)) && bareIpAddress(raw) === null;
}

// Setting up the payment terminal: where it is, whether this browser can
// reach it, and the one-time pairing that gives the till a key to use it.
//
// All of it lives in the browser on the monoblock, because the terminal is on
// the shop's local network and our server is not.
export function KaspiTerminalCard() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [pairing, setPairing] = useState<Pairing>({ kind: "unpaired" });

  useEffect(() => {
    const saved = getTerminalUrl();
    if (saved) setUrl(saved);
    const tokens = getTokens();
    if (tokens) setPairing({ kind: "paired", tokens });
  }, []);

  function remember(next: string) {
    setUrl(next);
    setTerminalUrl(next);
  }

  // A wrong address does not fail — it hangs, until the operating system
  // gives up on the connection a minute or so later. Cutting it short keeps
  // the answer inside the attention span of the person who pressed the
  // button; on a shop network the terminal answers in milliseconds, so
  // anything past a few seconds is already a "no".
  async function probeOnce(target: string, init?: RequestInit) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);
    try {
      return await fetch(target, { ...init, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Probes /v2/register — the one route needing no token, harmless to repeat
  // (an already-known name simply gets refused), and it starts no payment.
  //
  // It runs twice on purpose. A normal request getting through means the
  // terminal returns the permission a page needs to talk to it at all. If
  // only the no-cors repeat gets through, the terminal is reachable and
  // withholding that permission — a different problem with a different fix.
  async function check() {
    setOutcome({ kind: "checking" });
    const probe = `${url.replace(/\/+$/, "")}/v2/register?name=${encodeURIComponent(CLIENT_NAME)}`;

    try {
      const res = await probeOnce(probe);
      const body = await res.text();
      setOutcome({ kind: "reachable", body: body.slice(0, 400) });
      return;
    } catch {
      // Falls through — a failure here is either the permission or the
      // connection, and the next request tells them apart.
    }

    try {
      await probeOnce(probe, { mode: "no-cors" });
      setOutcome({ kind: "blocked" });
    } catch {
      // no-cors is exempt from the permission check but not from the
      // certificate one, so this failing against a bare address points at the
      // certificate rather than at the network.
      const bare = bareIpAddress(url);
      setOutcome(bare ? { kind: "certificate", ...bare } : { kind: "unreachable" });
    }
  }

  // The terminal does not answer this call until somebody presses
  // «Разрешить» on its screen, so the wait is expected and the button says so
  // while it happens.
  async function pair() {
    setPairing({ kind: "waiting" });
    try {
      const tokens = await register(url.replace(/\/+$/, ""));
      setTokens(tokens);
      setPairing({ kind: "paired", tokens });
    } catch (err) {
      const message = err instanceof KaspiError ? err.message : "Не удалось подключить терминал";
      // 105 with this wording is the terminal saying it already has an entry
      // under our name — recoverable, but only from the terminal's screen.
      setPairing(
        /already allowed/i.test(message) ? { kind: "alreadyPaired" } : { kind: "failed", message },
      );
    }
  }

  function unpair() {
    setTokens(null);
    setPairing({ kind: "unpaired" });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold text-foreground">Терминал Kaspi</h2>
        </div>
        {pairing.kind === "paired" && (
          <span className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Подключён
          </span>
        )}
      </div>

      <label className="mb-1.5 block text-sm font-medium text-foreground">Адрес терминала</label>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => remember(e.target.value)}
          placeholder={DEFAULT_URL}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={check}
          disabled={outcome.kind === "checking"}
          className="flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-60"
        >
          {outcome.kind === "checking" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
          Проверить связь
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Адрес виден на терминале: Настройки → Kaspi Гид → О терминале → «IP терминала»
      </p>

      {outcome.kind === "reachable" && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3">
          <p className="text-sm font-medium text-emerald-900">Связь есть, терминал отвечает кассе</p>
          <p className="mt-2 break-all font-mono text-xs text-emerald-800">{outcome.body}</p>
        </div>
      )}

      {outcome.kind === "blocked" && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">Терминал найден, но не пускает кассу напрямую</p>
          <p className="mt-1 text-sm text-amber-800">
            Нужна небольшая программа-посредник на моноблоке. Сообщите об этом — она ставится один раз.
          </p>
        </div>
      )}

      {outcome.kind === "certificate" && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            К терминалу нельзя обращаться по цифровому адресу
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Сертификат терминала выписан на имя, поэтому по цифрам касса до него не достучится. Нужно
            один раз задать терминалу имя на этом компьютере:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-amber-800">
            <li>Откройте «Блокнот» правой кнопкой → «Запуск от имени администратора»</li>
            <li>
              Файл → Открыть → вставьте путь{" "}
              <span className="font-mono text-xs">C:\Windows\System32\drivers\etc\hosts</span> (внизу
              выберите «Все файлы»)
            </li>
            <li>
              В конец файла добавьте строку:{" "}
              <span className="font-mono text-xs">
                {outcome.ip} {SUGGESTED_HOST}
              </span>
            </li>
            <li>Сохраните, а сюда впишите адрес из поля ниже и проверьте снова</li>
          </ol>
          <p className="mt-2 break-all font-mono text-xs text-amber-900">
            https://{SUGGESTED_HOST}:{outcome.port}
          </p>
        </div>
      )}

      {outcome.kind === "unreachable" && (
        <div className="mt-4 rounded-xl bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-900">Терминал не отвечает</p>
          {/* Told apart deliberately. Against a name the old advice — "сверьте
              адрес с IP терминала" — was useless, because a name never looks
              like an address: the number it stands for is buried in the hosts
              file, and that is precisely what goes stale when the terminal
              gets a new one. */}
          {isHostname(url) ? (
            <>
              <p className="mt-1 text-sm text-red-800">
                Скорее всего у терминала сменился IP. Имя <span className="font-mono text-xs">{hostOf(url)}</span>{" "}
                привязано к одному адресу в файле hosts, и при смене адреса связь пропадает.
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-red-800">
                <li>
                  На терминале посмотрите текущий адрес: Настройки → Kaspi Гид → О терминале → «IP
                  терминала»
                </li>
                <li>
                  Если он отличается — поправьте строку в{" "}
                  <span className="font-mono text-xs">C:\Windows\System32\drivers\etc\hosts</span> на новый
                </li>
                <li>Заодно проверьте, что терминал включён, не спит и подключён к той же сети</li>
              </ol>
            </>
          ) : (
            <p className="mt-1 text-sm text-red-800">
              Проверьте, что терминал и моноблок в одной сети, а адрес выше совпадает с «IP терминала».
            </p>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        {pairing.kind === "paired" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-foreground">Касса зарегистрирована на терминале</p>
              <p className="mt-0.5 text-xs text-muted">
                Ключ доступа действует до {pairing.tokens.expirationDate || "—"} и продлевается сам
              </p>
            </div>
            <button
              type="button"
              onClick={unpair}
              className="shrink-0 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
            >
              Отключить
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-foreground">Терминал не подключён к кассе</p>
                <p className="mt-0.5 text-xs text-muted">
                  После нажатия подтвердите доступ на экране терминала
                </p>
              </div>
              <button
                type="button"
                onClick={pair}
                disabled={pairing.kind === "waiting"}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {pairing.kind === "waiting" && (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                )}
                {pairing.kind === "waiting" ? "Ждём подтверждения…" : "Подключить терминал"}
              </button>
            </div>

            {pairing.kind === "waiting" && (
              <p className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-foreground">
                На терминале появился запрос доступа — нажмите на нём «Разрешить»
              </p>
            )}

            {pairing.kind === "alreadyPaired" && (
              <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">Терминал уже знает эту кассу</p>
                <p className="mt-1 text-sm text-amber-800">
                  Новый ключ он выдаст только заново. На терминале: Панель администратора → «Защита
                  интеграции» → «Настроить доступ» → напротив «{CLIENT_NAME}» нажмите «Запретить». Потом
                  вернитесь сюда и нажмите «Подключить терминал» ещё раз.
                </p>
              </div>
            )}

            {pairing.kind === "failed" && (
              <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{pairing.message}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
