"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { CLUB_CHAT_MAX_LENGTH, type ClubChatMessageDto } from "@bakery-os/shared";
import { ClubApiError, clubApi } from "@/lib/club-api";
import { fmtDay, fmtDayTime } from "./format";

// The customer's chat with the bakery: their messages, our answers and every
// automatic notice (bonuses, birthdays, news) in one thread.
const POLL_MS = 12_000;
const timeOnly = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });

export function ChatTab({ onRead }: { onRead: () => void }) {
  const [messages, setMessages] = useState<ClubChatMessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shown = useRef(-1);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(() => {
    clubApi
      .chat()
      .then((c) => {
        setMessages(c.messages);
        setError(null);
        onReadRef.current();
      })
      .catch((e) => setError(e instanceof ClubApiError ? e.message : "Не удалось загрузить сообщения"));
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const total = messages?.length ?? 0;
  useEffect(() => {
    if (total !== shown.current) {
      shown.current = total;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [total]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const sent = await clubApi.chatSend(body);
      setMessages((m) => [...(m ?? []), sent]);
      setText("");
    } catch (e) {
      setError(e instanceof ClubApiError ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  let lastDay = "";
  return (
    <>
      <h1 className="aa-h2">Чат</h1>
      <div className="aa-chat">
        {messages === null && !error && <div className="aa-panel aa-empty">Загрузка…</div>}
        {messages?.length === 0 && <div className="aa-panel aa-empty">Напишите нам — ответим здесь же.</div>}
        {messages?.map((m) => {
          const day = fmtDay(m.at);
          const divider = day !== lastDay;
          lastDay = day;
          const mine = m.from === "CUSTOMER";
          return (
            <div key={m.id} className="aa-chat-item">
              {divider && <div className="aa-chat-day">{day}</div>}
              <div className={`aa-bubble ${mine ? "out" : "in"}${m.kind === "NOTICE" ? " notice" : ""}`}>
                {m.title && <b>{m.title}</b>}
                <span>{m.text}</span>
                <time dateTime={m.at} title={fmtDayTime(m.at)}>
                  {timeOnly.format(new Date(m.at))}
                </time>
              </div>
            </div>
          );
        })}
        <div ref={endRef} className="aa-chat-end" />
      </div>
      <form
        className="aa-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error && <div className="aa-error">{error}</div>}
        <div className="line">
          <textarea rows={1} maxLength={CLUB_CHAT_MAX_LENGTH} placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} aria-label="Сообщение" />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Отправить">
            <Send size={18} strokeWidth={2} />
          </button>
        </div>
      </form>
    </>
  );
}
