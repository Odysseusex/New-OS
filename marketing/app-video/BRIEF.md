# Video brief — «Бонусная карта Ar Amir: как установить приложение»

## What it is for
Ar Amir is a bakery chain in Aktobe, Kazakhstan. Its bonus card is a web app (PWA) at **ar-amir.com/app**:
the customer scans a QR, adds the app to the phone's home screen, signs in with their phone number
and shows the card's QR at the till to earn and spend bonuses.

The cashiers do not explain this to customers. So a **silent, looping video** will play on the
**buyer's screen** — the second monitor of the till (a POS monoblock), facing the customer. It plays
while nobody is being served and while people wait. Nobody can touch that screen.

Viewing conditions (assume the worst): a 10–15" landscape monitor, 16:9, seen from 0.5–1.2 m, shop
lighting, **no sound**, the viewer arrives at a random moment of the loop and looks for 10–60 seconds.
Viewers are ordinary bakery customers of every age, many 50+, mostly on Android, many on iPhone.

The video's job: make a customer (1) understand there is a bonus card worth having, (2) scan the QR
with the phone camera, (3) put the app on the phone — the steps differ on iPhone and Android —
(4) sign in, (5) show the card at the till. The owner asked for it to look genuinely impressive.

## Facts — must be shown truthfully (do not invent steps or benefits)
- Address / QR target: `https://ar-amir.com/app`. A real QR for it is available as an asset.
- The QR opens the page in the phone's browser (Safari on iPhone, Chrome on Android).
- **iPhone (Safari):** «Поделиться» (the square with an arrow up, bottom toolbar) → «На экран «Домой»» →
  «Добавить». The icon «Ar Amir» appears on the home screen. **On iPhone a sign-in made in Safari does
  NOT carry over to the installed icon, so installing must come BEFORE signing in.**
- **Android (Chrome):** menu «⋮» (top right) → «Добавить на гл. экран» → «Установить». The icon appears.
  (Order relative to sign-in does not matter on Android.)
- **Sign-in (inside the app):** type the phone number (+7 …), name, tick the consent box → «Продолжить» →
  screen «Отправьте нам одно сообщение» with the button «Открыть Telegram» → Telegram opens the bakery's
  bot → «Начать» → the bot says «Чтобы войти в приложение Ar Amir, нажмите кнопку ниже и отправьте свой
  номер.» with the button «📱 Отправить мой номер» → the customer confirms sharing the number → back in the
  app the sign-in happens by itself. No password, no SMS. Today sign-in is via **Telegram only**.
- **At the till:** the app's first tab shows the card and a QR under «Покажите кассиру» (or the customer
  just names their phone number). The cashier scans it; bonuses are added after the purchase.
- **Programme (live figures):** 1 бонус = 1 ₸. Levels by purchases over 90 days: **Бронза 2 % → Серебро 3 % →
  Золото 4 % → Платина 5 %** бонусами с каждой покупки. Up to **30 %** of a check can be paid with bonuses.
  **5 000 бонусов за первую покупку** with the card (usable from the next day, for 10 days) — may be
  mentioned only in exactly these words: «5 000 бонусов за первую покупку». Bonuses for purchases live 12 months.
- The app also has: history of purchases, a chat with the bakery, notifications about bonuses.

## Brand rules (the owner's explicit decisions — breaking them gets the video rejected)
- Look of the printed poster (see `assets/ref/poster.png`): warm paper `#fbf7ef`, ink `#1f1712`,
  muted `#6b6058`, gold `#a8823f` hairlines and small caps, generous air.
- Fonts: **Tenor Sans** for headings and big numerals, **Manrope** for text. Never Cormorant/Playfair for titles.
- The brand red exists ONLY inside the logo (`assets/logo.png`). No red fills, no red text.
- **No sage / green as a brand colour.** The app's card is terracotta.
- **No slogans, no advertising taglines, no exclamation hype** («Успей!», «Выгодно!» …). Plain factual
  phrases only: what to do and what you get. The owner called slogans «кринжовые».
- **No photographs** of food or people. Typography, the logo, phone mockups, the real app screens.
- Everything on screen is in **Russian**. Latin only for: Ar Amir, ar-amir.com/app, Telegram, iPhone, Android, QR.
- No emoji except where they exist in the real UI (the bot's «📱 Отправить мой номер»).

## Production constraints
- 1920×1080, 30 fps, silent, seamless loop, H.264 MP4. Built as one HTML page animated with GSAP
  (a paused master timeline, rendered frame by frame with headless Chromium) — so anything expressible
  in HTML/CSS/SVG + GSAP tweens is possible; video footage, 3D and photos are not.
- Real screens of the app are captured (invented demo customer «Айгерим», +7 701 123 45 67):
  `assets/app/*.png` at 1170 px wide (390 pt × 3) — see `assets/ref/app-screens-sheet.png`:
  login-empty, login-phone, login-filled, login-confirm (code + «Открыть Telegram»), card (5 000 бонусов,
  Бронза · 2 %), card-zero, card-full / card-zero-full (whole scrolling page, no tab bar), tabbar,
  card-only (just the terracotta card), history, chat, profile.
- Screens of the phone's own system (Safari share sheet, home screen, Chrome menu, the Telegram chat,
  the camera viewfinder) will be **drawn** as simplified, clean HTML mockups — recognisable, not pixel copies.
- Minimum sizes for legibility on a small monitor at 1 m: headline ≥ 64 px, supporting text ≥ 40 px,
  nothing meaningful below 32 px (text inside phone mockups is illustration, not meant to be read,
  except the one control being pointed at, which must be enlarged or called out).
