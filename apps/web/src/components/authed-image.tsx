"use client";

import { useEffect, useState } from "react";
import { fetchApiBlob } from "@/lib/api";

// A picture the API serves only to a signed-in user: loaded with the token and shown from memory.
export function AuthedImage({ path, alt, className, onClick }: { path: string; alt: string; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    setSrc(null);
    setFailed(false);
    fetchApiBlob(path)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed) return <div className={className} style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>Фото не загрузилось</div>;
  if (!src) return <div className={className} aria-busy="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onClick={onClick} draggable={false} />;
}
