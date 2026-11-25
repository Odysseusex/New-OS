"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Send } from "lucide-react";
import type { Waybill } from "@/lib/waybill";
import { renderWaybillPng, waybillFileName } from "@/lib/waybill-image";
import { Modal } from "@/components/modal";

type Picture = { waybill: Waybill; file: File; url: string };

// «Отправить в WhatsApp»: each накладная becomes a picture, and the device's own «Поделиться» menu
// sends them all at once — the person picks WhatsApp and the chat there (the program does not post into
// a chat by itself). Where the browser cannot share files, the pictures are saved to attach by hand.
// `load` lets a caller that holds only the list (Продажи) fetch what the накладные need first.
export function WaybillShareModal({ load, onClose }: { load: () => Promise<Waybill[]>; onClose: () => void }) {
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    (async () => {
      const made: Picture[] = [];
      const names = new Set<string>();
      for (const waybill of await load()) {
        const blob = await renderWaybillPng(waybill);
        // Two накладные to one customer must not share a file name.
        let name = waybillFileName(waybill);
        for (let n = 2; names.has(name); n += 1) name = waybillFileName(waybill).replace(/\.png$/, ` (${n}).png`);
        names.add(name);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        made.push({ waybill, file: new File([blob], name, { type: "image/png" }), url });
      }
      if (alive) setPictures(made);
    })().catch((err) => alive && setError(err instanceof Error ? err.message : "Не удалось подготовить картинки"));
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canShare = useMemo(() => {
    if (!pictures || pictures.length === 0 || typeof navigator === "undefined" || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: pictures.map((p) => p.file) });
    } catch {
      return false;
    }
  }, [pictures]);

  async function share() {
    if (!pictures) return;
    setNote(null);
    try {
      await navigator.share({ files: pictures.map((p) => p.file) });
      onClose();
    } catch (err) {
      // The person closed the menu: nothing went wrong.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNote("Не получилось открыть меню «Поделиться». Скачайте картинки и прикрепите их в чате.");
    }
  }

  async function download() {
    if (!pictures || busy) return;
    setBusy(true);
    try {
      let blob: Blob;
      let name: string;
      if (pictures.length === 1) {
        blob = pictures[0].file;
        name = pictures[0].file.name;
      } else {
        // Several pictures travel as one archive: a browser asks about every separate file.
        const { zipSync } = await import("fflate");
        const entries: Record<string, Uint8Array> = {};
        for (const p of pictures) entries[p.file.name] = new Uint8Array(await p.file.arrayBuffer());
        blob = new Blob([zipSync(entries, { level: 0 })], { type: "application/zip" });
        name = `Накладные (${pictures.length}).zip`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNote(pictures.length === 1 ? "Картинка сохранена — прикрепите её в чате WhatsApp." : "Архив с картинками сохранён — откройте его и прикрепите картинки в чате WhatsApp.");
    } catch {
      setNote("Не удалось сохранить картинки");
    } finally {
      setBusy(false);
    }
  }

  const count = pictures?.length ?? 0;
  return (
    <Modal title="Отправить в WhatsApp" onClose={onClose} width="max-w-2xl">
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!pictures && !error && <p className="py-10 text-center text-sm text-muted">Готовим картинки…</p>}
      {pictures && pictures.length === 0 && <p className="py-10 text-center text-sm text-muted">Нет накладных для отправки</p>}
      {pictures && pictures.length > 0 && (
        <>
          <div className="mb-4 flex max-h-[52dvh] flex-wrap justify-center gap-3 overflow-y-auto rounded-2xl bg-surface-muted p-3">
            {pictures.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.waybill.id}
                src={p.url}
                alt={`Накладная № ${p.waybill.number}, ${p.waybill.recipient}`}
                className={pictures.length === 1 ? "w-full max-w-sm rounded-xl border border-border bg-white" : "w-40 rounded-xl border border-border bg-white sm:w-48"}
              />
            ))}
          </div>
          {note && <p className="mb-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-foreground">{note}</p>}
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <button type="button" data-submit onClick={share} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90">
                <Send className="h-4 w-4" strokeWidth={1.75} />
                Поделиться{count > 1 ? ` (${count})` : ""}
              </button>
            )}
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className={
                canShare
                  ? "flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
                  : "flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
              }
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {count > 1 ? `Скачать картинки (${count})` : "Скачать картинку"}
            </button>
          </div>
          <p className="mt-3 text-sm text-muted">
            {canShare ? "В меню «Поделиться» выберите WhatsApp и нужный чат." : "Это устройство не отправляет файлы через «Поделиться»: скачайте и прикрепите в чате."}
          </p>
        </>
      )}
    </Modal>
  );
}
