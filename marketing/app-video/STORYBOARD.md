# Storyboard (final) — «Бонусная карта Ar Amir»

Three independent storyboards (conversion at the till / clarity for everyone / premium brand film) agreed on
the structure below; the judging panel did not run (usage limit), so the synthesis is the author's.

**Layout, 1920 × 1080.** The poster's double gold hairline frame. Right third — a permanent, motionless poster
column: «Бонусная карта», «5 000 бонусов за первую покупку», the real QR for ar-amir.com/app at 16 px a module
(464 px of code, 528 px with its quiet zone), «Наведите камеру телефона на код», the address. Left — a page of
text (step label, headline, numbered rows whose key caps repeat the exact button names) and ONE phone that does
what the page says; a gold line joins the lit row to the control on the phone. The phone's body changes
Android ↔ iPhone; nothing else moves between scenes.

**Why the code never leaves the screen.** A customer looks up at a random second and needs 5–10 s to get the
camera out; a code that came and went would be missed, and a moving code is hard to lock on.

**Order (one order for both phones): code → icon on the home screen → sign in → till.** On iPhone a sign-in made
in Safari does not carry over to the installed icon, so the icon comes first («Сначала значок — потом вход»).

| # | Page | Phone |
|---|------|-------|
| 0 | «Бонусы с каждой покупки» · Бронза 2 % … Платина 5 % · до 30 % чека · 1 бонус = 1 ₸ | the signed-in card (the state the film ends in) |
| 1 | Шаг 1 из 4 · «Наведите камеру на код справа» · 1 Откройте камеру телефона · 2 Нажмите на ссылку `ar-amir.com` | camera reads the code, the link, the page opens |
| 2a | Шаг 2 из 4 · **Android** · «Добавьте значок на экран телефона» · 1 `⋮ Меню` · 2 `Добавить на гл. экран` (или «Установить приложение») · 3 `Установить` | Chrome → menu → dialog → home screen |
| 2b | Шаг 2 из 4 · **iPhone** · same headline · 1 `Поделиться` (на новых iPhone — сначала •••) · 2 `На экран «Домой»` · 3 `Добавить` · «Сначала значок — потом вход» | Safari → share sheet → add → home screen |
| 3 | Шаг 3 из 4 · «Войдите по номеру телефона» · 1 `Ar Amir` значок · 2 Введите номер и имя · 3 `Открыть Telegram` · 4 `Отправить мой номер` · 5 Вернитесь в приложение | icon → the real sign-in screens → the bot → the card |
| 4 | Шаг 4 из 4 · «Покажите карту на кассе» · Кассир считает код с экрана · Или назовите номер телефона · «Бонусы начисляются после покупки» | the card's QR is read, +5 000 бонусов |

**Wording checked against the real systems (12.11.2026).** iOS 26's default Safari layout hides «Поделиться»
behind «•••» — hence the note on the iPhone page. Chrome for Android names the menu item either «Добавить на гл.
экран» or «Установить приложение» depending on its version — hence the «или». Sign-in is via Telegram only today
(`V.cfg.signInVia`). Every figure comes from `src/config.js`, mirrored from the live `GET /api/club/info`.

**Loop.** The film ends on the phone showing the card with its bonuses; a one-second preroll before frame 0
brings the timeline to that same state, so the seam is inside a hold.
