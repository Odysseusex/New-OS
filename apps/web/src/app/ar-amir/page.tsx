import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "./_components/site-header";
import { SiteFooter } from "./_components/site-footer";
import { Reveal } from "./_components/reveal";
import { BONUS, SITE_INFO } from "./site-info";

const MARQUEE = [
  "Хлеб",
  "Багеты",
  "Круассаны",
  "Сладкая выпечка",
  "Свежее каждое утро",
];

const GALLERY = [
  {
    src: "/site/baguettes.jpg",
    alt: "Багеты с хрустящей корочкой",
    caption: "Багеты",
    cls: "s-tile--tall",
  },
  {
    src: "/site/croissant-coffee.jpg",
    alt: "Круассан и чашка кофе",
    caption: "Круассаны",
    cls: "",
  },
  {
    src: "/site/croissant-cream.jpg",
    alt: "Круассан с кремом",
    caption: "С начинкой",
    cls: "s-tile--tall",
  },
  {
    src: "/site/baguette-basket.jpg",
    alt: "Корзина свежих багетов",
    caption: "Хлеб к столу",
    cls: "s-tile--tall",
  },
  {
    src: "/site/chocolate.jpg",
    alt: "Тесто, какао и шоколад",
    caption: "Сладкая выпечка",
    cls: "",
  },
];

export default function SitePage() {
  return (
    <>
      <SiteHeader />
      <Reveal />

      <main>
        {/* hero */}
        <section className="s-hero">
          <div className="s-wrap s-hero__grid">
            <div className="s-hero__text">
              <span className="s-eyebrow">{SITE_INFO.tagline}</span>
              <h1 className="s-h1">
                Хлеб, который
                <br />
                пекут <em>с утра</em>
              </h1>
              <p className="s-lead">
                {SITE_INFO.brand} — традиционная пекарня. Хлеб, багеты,
                круассаны и сладкая выпечка собственного производства — тёплые,
                как только что из печи.
              </p>
              <div className="s-hero__actions">
                <a href="#bakery" className="s-btn">
                  Наша выпечка
                </a>
                <a href="#bonus" className="s-link">
                  Бонусная программа <span aria-hidden>→</span>
                </a>
              </div>
            </div>

            <div className="s-hero__media">
              <div className="s-arch">
                <Image
                  src="/site/hero-loaves.jpg"
                  alt="Два круглых хлеба на мраморном столе"
                  fill
                  priority
                  sizes="(min-width: 900px) 520px, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="s-seal" aria-hidden>
                <svg className="s-seal__ring" viewBox="0 0 120 120">
                  <defs>
                    <path
                      id="s-seal-path"
                      d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0"
                    />
                  </defs>
                  <text>
                    <textPath href="#s-seal-path">
                      СВЕЖАЯ ВЫПЕЧКА • КАЖДЫЙ ДЕНЬ •
                    </textPath>
                  </text>
                </svg>
                <WheatMark />
              </div>
            </div>
          </div>
        </section>

        {/* marquee */}
        <div className="s-marquee" aria-hidden>
          <div className="s-marquee__track">
            {[...MARQUEE, ...MARQUEE, ...MARQUEE, ...MARQUEE].map((word, i) => (
              <span key={i}>{word}</span>
            ))}
          </div>
        </div>

        {/* about */}
        <section id="about" className="s-section">
          <div className="s-wrap s-about">
            <div className="s-about__media s-reveal">
              <div className="s-img-a">
                <Image
                  src="/site/kneading.jpg"
                  alt="Руки пекаря замешивают тесто"
                  fill
                  sizes="(min-width: 900px) 380px, 64vw"
                  className="object-cover"
                />
              </div>
              <div className="s-img-b">
                <Image
                  src="/site/oven.jpg"
                  alt="Хлеб на противнях в печи"
                  fill
                  sizes="(min-width: 900px) 290px, 48vw"
                  className="object-cover"
                />
              </div>
            </div>

            <div className="s-about__text">
              <span className="s-eyebrow s-reveal">О нас</span>
              <h2
                className="s-h2 s-reveal"
                style={{ ["--d" as string]: "0.06s" }}
              >
                Тесто любит <em>терпение</em>
              </h2>
              <div className="s-reveal" style={{ ["--d" as string]: "0.12s" }}>
                <p className="s-lead">
                  Мы печём так, как пекли всегда: замешиваем тесто, даём ему
                  время подойти и отправляем в печь, чтобы утром на полках был
                  тёплый хлеб.
                </p>
                <p className="s-lead">
                  Всё, что вы видите на витрине, сделано на нашем собственном
                  производстве.
                </p>
              </div>
              <ul
                className="s-values s-reveal"
                style={{ ["--d" as string]: "0.18s" }}
              >
                <li>
                  <b>01</b>
                  <div>
                    <strong>Каждый день свежее</strong>
                    <p>
                      Выпекаем каждый день, чтобы хлеб попадал к вам тёплым.
                    </p>
                  </div>
                </li>
                <li>
                  <b>02</b>
                  <div>
                    <strong>Своё производство</strong>
                    <p>От замеса до витрины — всё делаем сами.</p>
                  </div>
                </li>
                <li>
                  <b>03</b>
                  <div>
                    <strong>Традиционные рецепты</strong>
                    <p>
                      Дәстүрлі наубайхана — пекарня, которая бережёт вкус
                      настоящего хлеба.
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* gallery */}
        <section id="bakery" className="s-section s-section--cream">
          <div className="s-wrap">
            <div className="s-gallery__head s-reveal">
              <div>
                <span className="s-eyebrow">Выпечка</span>
                <h2 className="s-h2">
                  Наша <em>выпечка</em>
                </h2>
              </div>
              <p className="s-lead" style={{ maxWidth: "26em" }}>
                Хрустящие багеты, слоёные круассаны, хлеб к столу и сладкое к
                чаю — приходите за любимым.
              </p>
            </div>
            <div className="s-gallery">
              {GALLERY.map((g, i) => (
                <figure
                  key={g.src}
                  className={`s-tile ${g.cls} s-reveal`}
                  style={{ ["--d" as string]: `${(i % 4) * 0.07}s` }}
                >
                  <Image
                    src={g.src}
                    alt={g.alt}
                    fill
                    sizes="(min-width: 900px) 25vw, 50vw"
                    className="object-cover"
                  />
                  <figcaption>{g.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* proverb */}
        <section className="s-proverb">
          <Image
            src="/site/dough-leaves.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="s-proverb__text s-reveal">
            <blockquote>«Нан — дастарқанның көркі»</blockquote>
            <p>Хлеб — украшение дастархана</p>
          </div>
        </section>

        {/* bonus */}
        <section id="bonus" className="s-section s-bonus">
          <div className="s-wrap s-bonus__grid">
            <div>
              <span className="s-eyebrow s-reveal">Бонусная программа</span>
              <h2
                className="s-h2 s-reveal"
                style={{ marginTop: 22, ["--d" as string]: "0.06s" }}
              >
                Возвращаем <em>баллами</em>
              </h2>
              <p
                className="s-bonus__lead s-reveal"
                style={{ ["--d" as string]: "0.12s" }}
              >
                Каждая покупка приносит баллы, а баллами можно оплатить часть
                следующей. 1 балл = 1 ₸.
              </p>
              <div
                className="s-stats s-reveal"
                style={{ ["--d" as string]: "0.18s" }}
              >
                <div>
                  <b>{BONUS.firstPurchasePercent}%</b>
                  <span>баллами с первой покупки</span>
                </div>
                <div>
                  <b>{BONUS.earnPercent}%</b>
                  <span>с каждой следующей</span>
                </div>
                <div>
                  <b>{BONUS.maxRedeemPercent}%</b>
                  <span>чека можно оплатить баллами</span>
                </div>
                <div>
                  <b>{BONUS.lifetimeMonths} мес.</b>
                  <span>действуют баллы</span>
                </div>
              </div>
              <p
                className="s-bonus__note s-reveal"
                style={{ ["--d" as string]: "0.24s" }}
              >
                <i />
                Чтобы стать участником, просто назовите на кассе свой номер
                телефона — это займёт минуту.
              </p>
            </div>
            <div className="s-bonus__media s-reveal">
              <div className="s-arch">
                <Image
                  src="/site/wheat-flour.jpg"
                  alt="Колосья пшеницы на муке"
                  fill
                  sizes="(min-width: 900px) 460px, 100vw"
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* contacts */}
        <Contacts />
      </main>

      <SiteFooter />
    </>
  );
}

function Contacts() {
  const { locations, phone, email, whatsapp, instagram } = SITE_INFO;
  const direct = [
    phone && {
      label: "Телефон",
      value: phone,
      href: `tel:${phone.replace(/[^\d+]/g, "")}`,
    },
    whatsapp && {
      label: "WhatsApp",
      value: whatsapp,
      href: `https://wa.me/${whatsapp.replace(/\D/g, "")}`,
    },
    email && { label: "Почта", value: email, href: `mailto:${email}` },
    instagram && {
      label: "Instagram",
      value: `@${instagram.replace(/^@/, "")}`,
      href: `https://instagram.com/${instagram.replace(/^@/, "")}`,
    },
  ].filter(Boolean) as { label: string; value: string; href: string }[];

  return (
    <section id="contacts" className="s-section">
      <div className="s-wrap s-visit">
        <div>
          <span className="s-eyebrow s-reveal">Контакты</span>
          <h2
            className="s-h2 s-reveal"
            style={{ marginTop: 22, ["--d" as string]: "0.06s" }}
          >
            Ждём вас <em>в гости</em>
          </h2>
          {locations.length > 0 || direct.length > 0 ? (
            <div className="s-contacts">
              {locations.map((l) => (
                <div key={l.address} className="s-contact s-reveal">
                  <h3>{l.name}</h3>
                  <p>{l.address}</p>
                  {l.hours && <p>{l.hours}</p>}
                </div>
              ))}
              {direct.map((d) => (
                <div key={d.label} className="s-contact s-reveal">
                  <h3>{d.label}</h3>
                  <p>
                    <a
                      href={d.href}
                      className="s-link"
                      style={{
                        borderBottomColor: "transparent",
                        fontWeight: 500,
                      }}
                    >
                      {d.value}
                    </a>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="s-lead s-reveal" style={{ marginTop: 24 }}>
              Адреса наших пекарен скоро появятся здесь.
            </p>
          )}
          <p className="s-reveal" style={{ marginTop: 40 }}>
            <Link href="/ar-amir/privacy" className="s-link">
              Политика конфиденциальности <span aria-hidden>→</span>
            </Link>
          </p>
        </div>
        <div className="s-visit__media s-reveal">
          <Image
            src="/site/croissant-cup.jpg"
            alt="Круассан и кофе с собой"
            fill
            sizes="(min-width: 900px) 440px, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}

function WheatMark() {
  return (
    <svg
      className="s-seal__mark"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M16 29V9" />
      <path d="M16 9c-2.5-1.5-3.5-4-3-6.5 2.4.6 3.8 2.6 3 6.5zM16 9c2.5-1.5 3.5-4 3-6.5-2.4.6-3.8 2.6-3 6.5z" />
      <path d="M16 15c-3-0.6-5-3-5.2-5.8 2.8.4 4.8 2.6 5.2 5.8zM16 15c3-.6 5-3 5.2-5.8-2.8.4-4.8 2.6-5.2 5.8z" />
      <path d="M16 21c-3-.6-5-3-5.2-5.8 2.8.4 4.8 2.6 5.2 5.8zM16 21c3-.6 5-3 5.2-5.8-2.8.4-4.8 2.6-5.2 5.8z" />
    </svg>
  );
}
