"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE_INFO } from "../site-info";

const LINKS = [
  ["О нас", "/ar-amir#about"],
  ["Выпечка", "/ar-amir#bakery"],
  ["Бонусы", "/ar-amir#bonus"],
  ["Контакты", "/ar-amir#contacts"],
] as const;

export function SiteHeader({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className={`s-header ${solid || scrolled || open ? "is-solid" : ""}`}>
        <div className="s-wrap s-header__bar">
          <Link href="/ar-amir" className="s-brand" onClick={() => setOpen(false)}>
            <Image src="/site/logo-256.png" alt="" width={44} height={44} priority />
            {SITE_INFO.brand}
          </Link>
          <nav className="s-nav" aria-label="Разделы">
            {LINKS.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className={`s-burger ${open ? "is-open" : ""}`}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>
      <div className={`s-menu ${open ? "is-open" : ""}`} aria-hidden={!open}>
        {LINKS.map(([label, href]) => (
          <a key={href} href={href} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            {label}
          </a>
        ))}
        <p className="s-menu__foot">{SITE_INFO.tagline}</p>
      </div>
    </>
  );
}
