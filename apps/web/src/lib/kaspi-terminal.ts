// Talking to the Kaspi Smart POS standing next to the till.
//
// This is the one part of the app that does NOT go through our own server.
// It cannot: the terminal is a device on the shop's local network, and our
// API runs in a data centre in another country. The browser on the monoblock
// is the only thing that can reach both, so it is the client here — which is
// exactly the role Kaspi's documentation assigns to the cash register.
//
// Everything below follows «Smart POS. Документация по интеграции»: HTTPS on
// port 8080, a GET per operation, a JSON envelope of
// {statusCode, data?, errorText?} where statusCode 0 means success.
//
// The terminal must be addressed by NAME, never by its number: its
// certificate is issued to *.kaspipos.kz, and a page's request to a
// mismatched certificate is refused silently, with no way to click through.
// The name is pointed at the terminal in the machine's hosts file.

export interface KaspiTokens {
  accessToken: string;
  refreshToken: string;
  // "YYYY-MM-DD HH:mm:ss" in the terminal's own local time. Tokens live 24h.
  expirationDate: string;
}

// What a finished transaction gives back. Kaspi returns more than this for
// the printed slip; these are the fields a sale has to keep.
export interface KaspiTransaction {
  // "qr", "card" or "alaqan". A refund MUST go back by the same method, so
  // this is not cosmetic — without it the money cannot be returned.
  method: string;
  // The identifier a refund quotes: the order number for QR, the RRN for a
  // card. The terminal already picks the right one for us.
  transactionId: string;
  amount?: string;
  date?: string;
  cardMask?: string;
  rrn?: string;
  authorizationCode?: string;
  terminalId?: string;
}

export type KaspiStatus = "wait" | "success" | "fail" | "unknown";

export interface KaspiStatusResult {
  status: KaspiStatus;
  processId: string;
  transaction: KaspiTransaction | null;
  // Present on fail/unknown; English, from the terminal.
  message?: string;
}

const STORAGE_URL = "aramir.kaspiTerminalUrl";
const STORAGE_TOKENS = "aramir.kaspiTerminalTokens";

// Registered on the terminal under this name, listed there under «Клиенты
// интеграции», and validated on every token refresh. Changing it would
// orphan the existing pairing.
export const CLIENT_NAME = "ArAmirOS";

export class KaspiError extends Error {
  constructor(
    message: string,
    // The terminal's own statusCode. 105 is "the service refused" — the
    // errorText carries the reason.
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "KaspiError";
  }
}

// ── Per-machine settings ──────────────────────────────────────────────
//
// The address and the token belong to THIS till standing next to THIS
// terminal, not to the organization — a second shop has its own of both. So
// they live in the browser on the monoblock rather than in our database.
// Every accessor is guarded: a browser set to block site data throws on
// localStorage itself, and a till that cannot remember its terminal must
// still open.

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do — the caller degrades to "not configured".
  }
}

export function getTerminalUrl(): string {
  return (readStorage(STORAGE_URL) ?? "").replace(/\/+$/, "");
}

export function setTerminalUrl(url: string) {
  writeStorage(STORAGE_URL, url.trim());
}

export function getTokens(): KaspiTokens | null {
  const raw = readStorage(STORAGE_TOKENS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KaspiTokens;
    return parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: KaspiTokens | null) {
  writeStorage(STORAGE_TOKENS, tokens ? JSON.stringify(tokens) : null);
}

export function isConfigured(): boolean {
  return Boolean(getTerminalUrl()) && getTokens() !== null;
}

// ── Finding the terminal ──────────────────────────────────────────────
//
// The terminal has to be addressed by name, and a name only resolves through
// the machine's hosts file — which pins it to one address. On a phone hotspot
// the terminal's address moves whenever the phone re-shares its connection,
// and every move meant editing a system file again. That is not a thing a
// cashier can do at eight in the morning.
//
// So instead every address the hotspot can hand out gets its own name, once,
// and the till tries them all and keeps whichever answers. The certificate is
// a wildcard, so all of these names validate against it equally.
//
// An iPhone hotspot is always 172.20.10.0/28: the phone itself is .1, and
// everything it hands out lands between .2 and .14.
export const HOTSPOT_SUBNET_PREFIX = "172.20.10";
export const HOTSPOT_LAST_OCTETS = Array.from({ length: 13 }, (_, i) => i + 2);

export function hostForOctet(octet: number): string {
  return `pos${octet}.kaspipos.kz`;
}

// The block to paste into the machine's hosts file. Written once and then
// good for as long as the shop stays on this hotspot.
export function hostsFileBlock(): string {
  return HOTSPOT_LAST_OCTETS.map(
    (octet) => `${HOTSPOT_SUBNET_PREFIX}.${octet}  ${hostForOctet(octet)}`,
  ).join("\n");
}

// Probes /v2/status WITHOUT a token on purpose. It answers 401, which is
// answer enough — something on that address is a Smart POS — and unlike
// /v2/register it starts nothing and puts no approval prompt on the
// terminal's screen. Probing register would pop a dialog on the terminal for
// every address tried.
async function looksLikeTerminal(candidate: string, timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await fetch(`${candidate}/v2/status?processId=0`, { signal: abort.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Tries every name at once and returns the first that answers. Parallel
// because the misses are the slow part: an address with nothing on it does
// not refuse, it goes quiet until the attempt is given up on.
export async function discoverTerminal(
  port = "8080",
  timeoutMs = 5000,
): Promise<string | null> {
  const candidates = HOTSPOT_LAST_OCTETS.map((octet) => `https://${hostForOctet(octet)}:${port}`);
  const results = await Promise.all(
    candidates.map(async (candidate) => ((await looksLikeTerminal(candidate, timeoutMs)) ? candidate : null)),
  );
  return results.find((found) => found !== null) ?? null;
}

// ── The wire ──────────────────────────────────────────────────────────

async function call(
  url: string,
  path: string,
  params: Record<string, string>,
  opts: { accessToken?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params).toString();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 15000);
  // A caller's own cancellation (the cashier closing the dialog) has to reach
  // the request too, not just our timeout.
  const onAbort = () => abort.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${url}${path}?${query}`, {
      signal: abort.signal,
      headers: opts.accessToken ? { accesstoken: opts.accessToken } : undefined,
    });

    if (res.status === 401) throw new KaspiError("Терминал не принял ключ доступа. Подключите терминал заново.");
    if (res.status === 403) throw new KaspiError("Ключ доступа к терминалу истёк. Подключите терминал заново.");

    const body = (await res.json()) as {
      statusCode?: number;
      data?: Record<string, unknown>;
      errorText?: string;
    };

    if (body.statusCode !== 0) {
      // The useful sentence is usually in data.message; errorText is the
      // generic wrapper around it.
      const detail =
        (body.data?.message as string | undefined) ?? body.errorText ?? "Терминал вернул ошибку";
      throw new KaspiError(detail, body.statusCode);
    }
    return body.data ?? {};
  } catch (err) {
    if (err instanceof KaspiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new KaspiError("Терминал не ответил вовремя");
    }
    throw new KaspiError("Нет связи с терминалом. Проверьте, что он включён и в той же сети.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function toTokens(data: Record<string, unknown>): KaspiTokens {
  return {
    accessToken: String(data.accessToken ?? ""),
    refreshToken: String(data.refreshToken ?? ""),
    expirationDate: String(data.expirationDate ?? ""),
  };
}

// Pairing. The terminal does not answer this until somebody presses
// «Разрешить» on its screen, so it is given minutes rather than seconds —
// and the caller is expected to be telling the user to go and press it.
//
// A terminal that already knows this name refuses with statusCode 105
// instead of issuing a fresh token, and there is no way to ask it for one
// again. Re-pairing therefore means removing the old entry on the terminal
// first («Настройка доступа» → «Запретить»), which the card explains.
export async function register(url: string, signal?: AbortSignal): Promise<KaspiTokens> {
  const data = await call(url, "/v2/register", { name: CLIENT_NAME }, { timeoutMs: 180000, signal });
  return toTokens(data);
}

export async function revoke(url: string, refreshToken: string): Promise<KaspiTokens> {
  const data = await call(url, "/v2/revoke", { name: CLIENT_NAME, refreshToken });
  return toTokens(data);
}

// The terminal's expiry is a local-time string with no zone. Parsed
// leniently and treated as already expired when unreadable: refreshing a
// token that did not need it costs one request, while missing an expiry
// fails a sale in front of a customer.
function expiresWithin(expirationDate: string, ms: number): boolean {
  const parsed = Date.parse(expirationDate.replace(" ", "T"));
  if (Number.isNaN(parsed)) return true;
  return parsed - Date.now() < ms;
}

// Returns a token good for the next few minutes, refreshing it if not.
// Stores whatever it gets, so the refresh happens once rather than per sale.
export async function ensureAccessToken(url: string): Promise<string> {
  const tokens = getTokens();
  if (!tokens) throw new KaspiError("Терминал не подключён");
  if (!expiresWithin(tokens.expirationDate, 5 * 60 * 1000)) return tokens.accessToken;

  const refreshed = await revoke(url, tokens.refreshToken);
  setTokens(refreshed);
  return refreshed.accessToken;
}

// ── Payment ───────────────────────────────────────────────────────────

// Starts a payment and returns the processId to follow it by. The amount is
// a whole number of tenge — the terminal has no tiyn.
//
// `owncheque` is true because our own till prints the slip. Letting the
// terminal print as well would hand the buyer two receipts for one purchase.
export async function startPayment(url: string, accessToken: string, amount: number): Promise<string> {
  const data = await call(
    url,
    "/v2/payment",
    { amount: String(Math.round(amount)), owncheque: "true" },
    { accessToken },
  );
  const processId = String(data.processId ?? "");
  if (!processId) throw new KaspiError("Терминал не вернул номер операции");
  return processId;
}

function toStatusResult(data: Record<string, unknown>): KaspiStatusResult {
  const status = String(data.status ?? "wait") as KaspiStatus;
  const transactionId = data.transactionId ? String(data.transactionId) : "";
  return {
    status,
    processId: String(data.processId ?? ""),
    message: data.message ? String(data.message) : undefined,
    // Only a finished, successful transaction carries the identifiers a
    // refund needs; anything else has nothing worth keeping.
    transaction:
      status === "success" && transactionId
        ? {
            method: String(data.method ?? ""),
            transactionId,
            amount: data.amount ? String(data.amount) : undefined,
            date: data.date ? String(data.date) : undefined,
            cardMask: data.cardMask ? String(data.cardMask) : undefined,
            rrn: data.rrn ? String(data.rrn) : undefined,
            authorizationCode: data.authorizationCode ? String(data.authorizationCode) : undefined,
            terminalId: data.terminalId ? String(data.terminalId) : undefined,
          }
        : null,
  };
}

export async function getStatus(
  url: string,
  accessToken: string,
  processId: string,
): Promise<KaspiStatusResult> {
  return toStatusResult(await call(url, "/v2/status", { processId }, { accessToken }));
}

// Asks the terminal to settle a transaction it lost track of. Only ever
// valid for an "unknown", and Kaspi require at least 10s between attempts.
export async function actualize(
  url: string,
  accessToken: string,
  processId: string,
): Promise<KaspiStatusResult> {
  return toStatusResult(await call(url, "/v2/actualize", { processId }, { accessToken }));
}

// Follows a payment to its end. Polls once a second, as Kaspi recommend.
//
// Deliberately has no overall deadline: the buyer is standing there choosing
// between a card and a QR, and a till that gave up early would leave a
// payment running on the terminal with nothing watching it. Stopping is the
// cashier's decision, through `signal`.
export async function waitForResult(
  url: string,
  accessToken: string,
  processId: string,
  opts: { signal?: AbortSignal; onTick?: (status: KaspiStatus) => void } = {},
): Promise<KaspiStatusResult> {
  for (;;) {
    if (opts.signal?.aborted) throw new KaspiError("Ожидание оплаты прервано");
    const result = await getStatus(url, accessToken, processId);
    opts.onTick?.(result.status);
    if (result.status !== "wait") return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
