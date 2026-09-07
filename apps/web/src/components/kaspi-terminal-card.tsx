"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

// The name this till registers under on the Smart POS. It is stored in the
// terminal's «Клиенты интеграции» list and validated on every token refresh,
// so it must stay exactly this string once registered.
const CLIENT_NAME = "ArAmirOS";
const STORAGE_KEY = "aramir.kaspiTerminalUrl";
const DEFAULT_URL = "https://172.20.10.3:8080";
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
  // failure. What separates them is the address — see isBareIp below. The
  // address is carried here rather than re-parsed at render time, so that
  // editing the field afterwards cannot leave the instructions quoting a
  // different address than the one that failed — or throw on a half-typed one.
  | { kind: "certificate"; ip: string; port: string }
  | { kind: "unreachable" };

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

// Checks whether this browser can talk to the Kaspi Smart POS on the shop's
// network, and — the part that cannot be answered any other way — whether the
// terminal lets a web page talk to it at all.
//
// Reaching the terminal by typing its address into the address bar proves
// nothing about this: a page asking for another address is a different kind of
// request, and browsers restrict those far more tightly than they restrict a
// person navigating. So the probe runs twice. A normal request that succeeds
// means the terminal returns the permission header a page needs. If it fails,
// the same request is repeated in "no-cors" mode, which is exempt from that
// permission — if THAT one gets through, the terminal is reachable and only
// the permission is missing, which is a completely different problem with a
// completely different fix (a small local helper) than the terminal not
// answering at all.
//
// The probe is /v2/register, the one route that needs no token. Repeating it
// is harmless: once this name is in the terminal's list it simply answers
// "already allowed". It moves no money and starts no payment.
export function KaspiTerminalCard() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  // Per-machine, not per-organization: this address belongs to the till
  // standing next to this particular terminal. Wrapped because a browser set
  // to block site data throws on the accessor itself.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setUrl(saved);
    } catch {
      // Storage unavailable — the default address stands.
    }
  }, []);

  function remember(next: string) {
    setUrl(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the address is not worth an error.
    }
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

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-muted" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold text-foreground">Терминал Kaspi</h2>
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
          className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-60"
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
          <p className="mt-1 text-sm text-red-800">
            Проверьте, что терминал и моноблок в одной сети, а адрес выше совпадает с «IP терминала».
          </p>
        </div>
      )}
    </div>
  );
}
