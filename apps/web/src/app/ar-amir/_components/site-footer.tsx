import Image from "next/image";
import Link from "next/link";
import { SITE_INFO } from "../site-info";

export function SiteFooter() {
  const legal = [SITE_INFO.legalName, SITE_INFO.taxId && `ИИН/БИН ${SITE_INFO.taxId}`, SITE_INFO.legalAddress].filter(Boolean);
  const contacts = [
    SITE_INFO.phone && { label: SITE_INFO.phone, href: `tel:${SITE_INFO.phone.replace(/[^\d+]/g, "")}` },
    SITE_INFO.email && { label: SITE_INFO.email, href: `mailto:${SITE_INFO.email}` },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <footer className="s-footer">
      <div className="s-wrap">
        <div className="s-footer__top">
          <div className="s-footer__brand">
            <Image src="/site/logo-256.png" alt="" width={72} height={72} style={{ borderRadius: 999 }} />
            <div>
              <strong>{SITE_INFO.brand}</strong>
              <span>{SITE_INFO.tagline}</span>
            </div>
          </div>
          <div>
            <h4>Разделы</h4>
            <ul className="s-footer__list">
              <li>
                <a href="/ar-amir#about">О нас</a>
              </li>
              <li>
                <a href="/ar-amir#bakery">Выпечка</a>
              </li>
              <li>
                <a href="/ar-amir#bonus">Бонусная программа</a>
              </li>
              <li>
                <Link href="/ar-amir/privacy">Политика конфиденциальности</Link>
              </li>
            </ul>
          </div>
          <div>
            {(legal.length > 0 || contacts.length > 0) && <h4>Реквизиты</h4>}
            <ul className="s-footer__list">
              {legal.map((line) => (
                <li key={line as string}>{line}</li>
              ))}
              {contacts.map((c) => (
                <li key={c.href}>
                  <a href={c.href}>{c.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="s-footer__bottom">
          <span>
            © {new Date().getFullYear()} {SITE_INFO.legalName || SITE_INFO.brand}
          </span>
          <span>{SITE_INFO.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
