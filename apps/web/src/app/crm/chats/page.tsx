"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BellOff, Megaphone, MessagesSquare, Send, Smartphone } from "lucide-react";
import { CLUB_CHAT_MAX_LENGTH, type ClubChatMessageDto, type CrmChatListDto, type CrmChatOverviewDto, type CrmChatThreadDto } from "@bakery-os/shared";
import { api, ApiError } from "@/lib/api";
import { useCrm } from "@/components/crm/shell";
import { Avatar, CrmModal, ErrorBox, fmtPhone, fmtWhen, PageHeader, plural, Skeleton } from "@/components/crm/ui";

const POLL_MS = 15_000;
const clientsWord = (n: number) => plural(n, "клиент", "клиента", "клиентов");

export default function CrmChatsPage() {
  return (
    <Suspense>
      <Chats />
    </Suspense>
  );
}

function Chats() {
  const router = useRouter();
  const memberId = useSearchParams().get("m");
  const { refreshCounts } = useCrm();
  const [list, setList] = useState<CrmChatListDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const load = useCallback(() => {
    api.crm
      .chats()
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const changed = useCallback(() => {
    load();
    refreshCounts();
  }, [load, refreshCounts]);

  return (
    <div className="crm-wrap">
      <PageHeader icon={<MessagesSquare size={30} strokeWidth={1.6} />} tone="green" title="Чаты" subtitle={list && list.unread > 0 ? `Непрочитанных: ${list.unread}` : undefined}>
        <button type="button" className="crm-btn primary" onClick={() => setBroadcasting(true)}>
          <Megaphone size={15} /> Рассылка
        </button>
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={load} />}

      <div className={`crm-chat${memberId ? " open" : ""}`}>
        <aside className="crm-panel crm-chat-list" aria-label="Диалоги">
          {!list && !error && [0, 1, 2].map((i) => <Skeleton key={i} height={54} style={{ margin: 10 }} />)}
          {list && list.items.length === 0 && <div className="crm-empty" style={{ margin: 12 }}>Сообщений пока нет</div>}
          {list?.items.map((row) => (
            <button key={row.memberId} type="button" className={`crm-chat-row${row.memberId === memberId ? " on" : ""}`} onClick={() => router.replace(`/crm/chats?m=${row.memberId}`)}>
              <Avatar name={row.name ?? row.phone} size={34} />
              <span className="body">
                <span className="top">
                  <span className="name">{row.name ?? fmtPhone(row.phone)}</span>
                  <span className="muted when">{fmtWhen(row.lastAt)}</span>
                </span>
                <span className="top">
                  <span className={`last${row.unread ? " new" : ""}`}>
                    {row.lastFrom === "BAKERY" ? "Вы: " : ""}
                    {row.lastText}
                  </span>
                  {row.unread > 0 && <span className="crm-chat-badge">{row.unread}</span>}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <section className="crm-panel crm-chat-thread" aria-label="Переписка">
          {memberId ? (
            <Thread key={memberId} memberId={memberId} onChanged={changed} onBack={() => router.replace("/crm/chats")} />
          ) : (
            <div className="crm-chat-none muted">Выберите диалог</div>
          )}
        </section>
      </div>

      {broadcasting && (
        <BroadcastDialog
          onClose={() => setBroadcasting(false)}
          onSent={() => {
            setBroadcasting(false);
            changed();
          }}
        />
      )}
    </div>
  );
}

function Thread({ memberId, onChanged, onBack }: { memberId: string; onChanged: () => void; onBack: () => void }) {
  const [data, setData] = useState<CrmChatThreadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const count = useRef(-1);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(() => {
    api.crm
      .chatThread(memberId)
      .then((t) => {
        setData(t);
        setError(null);
        // Opening the thread reads the customer's messages: the counters follow.
        if (t.messages.length !== count.current) onChangedRef.current();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, [memberId]);
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const total = data?.messages.length ?? 0;
  useEffect(() => {
    if (total !== count.current) {
      count.current = total;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [total]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await api.crm.chatReply(memberId, body);
      setData((d) => (d ? { ...d, messages: [...d.messages, sent] } : d));
      setText("");
      onChanged();
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  if (error) return <div style={{ padding: 14 }}><ErrorBox message={error} onRetry={load} /></div>;
  if (!data) return <Skeleton height={120} style={{ margin: 14 }} />;
  const { member } = data;

  return (
    <>
      <header className="crm-chat-head">
        <button type="button" className="crm-ib crm-chat-back" onClick={onBack} aria-label="К списку">
          <ArrowLeft size={18} />
        </button>
        <Avatar name={member.name ?? member.phone} size={32} />
        <Link href={`/crm/clients/${member.id}`} className="who">
          <span className="name">{member.name ?? fmtPhone(member.phone)}</span>
          {member.name && <span className="muted num">{fmtPhone(member.phone)}</span>}
        </Link>
        {member.inApp && !member.notifications && (
          <span className="crm-mini" title="Клиент увидит сообщение, когда откроет приложение">
            <BellOff size={13} /> Уведомления выключены
          </span>
        )}
      </header>

      <div className="crm-chat-msgs">
        {data.messages.length === 0 && <div className="crm-chat-none muted">Сообщений пока нет</div>}
        {data.messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      {member.inApp ? (
        <form
          className="crm-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {sendError && <div className="crm-error">{sendError}</div>}
          <div className="line">
            <textarea
              className="crm-textarea"
              rows={2}
              maxLength={CLUB_CHAT_MAX_LENGTH}
              placeholder="Сообщение"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className="crm-btn primary" disabled={sending || !text.trim()} aria-label="Отправить">
              <Send size={15} />
            </button>
          </div>
        </form>
      ) : (
        <div className="crm-chat-off muted">
          <Smartphone size={15} /> Клиент не вошёл в приложение
        </div>
      )}
    </>
  );
}

function Bubble({ message: m }: { message: ClubChatMessageDto }) {
  const mine = m.from === "BAKERY";
  return (
    <div className={`crm-bubble ${mine ? "out" : "in"}${m.kind !== "TEXT" ? " auto" : ""}`}>
      {m.kind === "NOTICE" && <span className="kind">Уведомление</span>}
      {m.kind === "BROADCAST" && <span className="kind">Рассылка</span>}
      {m.title && <b>{m.title}</b>}
      <span className="text">{m.text}</span>
      <span className="meta">
        {mine && m.byName ? `${m.byName} · ` : ""}
        {fmtWhen(m.at)}
        {mine ? (m.read ? " · прочитано" : " · не прочитано") : ""}
      </span>
    </div>
  );
}

function BroadcastDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [overview, setOverview] = useState<CrmChatOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState("ALL");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.crm
      .chatsOverview()
      .then(setOverview)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить"));
  }, []);

  const chosen = overview?.audiences.find((a) => a.key === audience);
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await api.crm.chatBroadcast(audience, text.trim());
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить");
      setSending(false);
    }
  };

  return (
    <CrmModal
      title="Рассылка в приложение"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="crm-btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="crm-btn primary" onClick={send} disabled={sending || !text.trim() || !chosen || chosen.members === 0}>
            {sending ? "Отправляю…" : chosen ? `Отправить · ${chosen.members} ${clientsWord(chosen.members)}` : "Отправить"}
          </button>
        </>
      }
    >
      {error && <div className="crm-error">{error}</div>}
      {!overview && !error && <Skeleton height={90} />}
      {overview && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="crm-label">Кому</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {overview.audiences.map((a) => (
                <button key={a.key} type="button" className={`crm-choice${audience === a.key ? " on" : ""}`} onClick={() => setAudience(a.key)} disabled={a.members === 0}>
                  {a.label} <span className="muted num">{a.members}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="crm-label">
            Сообщение
            <textarea className="crm-textarea" rows={4} maxLength={CLUB_CHAT_MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {overview.broadcasts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="crm-label">Отправленные</span>
              {overview.broadcasts.slice(0, 5).map((b) => (
                <div key={b.id} className="crm-chat-sent">
                  <span className="text">{b.text}</span>
                  <span className="muted">
                    {b.audience} · {b.recipients} {clientsWord(b.recipients)} · {fmtWhen(b.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </CrmModal>
  );
}
