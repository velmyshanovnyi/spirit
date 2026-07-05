---
spec: phase1/mvp
section: "Секція 10: Сигнальний вузол — actions і fetch_proof"
iter: 1
agent: opus
files-reviewed:
  - server/library/SignalingController.php
  - server/public/index.php
  - server/config.php
  - server/library/InviteManager.php
  - server/library/Storage.php
  - server/library/RateLimiter.php
  - server/verify/section7_invite_manager.php
---

## Контекст

Фінальна секція, що інтегрує всі попередні (6-9) в реальний HTTP entrypoint. Живо верифіковано на `spirit.kibr.com.ua/spirit/public/index.php`: повний happy-path (5 дій), одноразовість токена, **3/3 раунди конкурентної гонки** `submit_answer` з одним токеном (рівно один 200, інший 403 — закриває TOCTOU з Секції 7), коди помилок 400/403/404/405/429, CORS preflight (204), rate limiting (429 після вичерпання бюджету), `fetch_proof` (успішний фетч реального URL + SSRF-блокування приватних IP, повернено у вимкнений стан).

## Знахідки

1. **[High] Відносні redirect у `fetch_proof` ламали протокол** — `Location: /path` чи `//host/path` призводили до "invalid URL" замість переходу. Виправлено: `resolveRedirectLocation()` для absolute/protocol-relative/absolute-path/relative форм.
2. **[Medium] Ненадійна перевірка IP-літералів** — `filter_var(FILTER_VALIDATE_IP)` не гарантує відхилення decimal/hex/octal-кодувань IP. Виправлено: канонікалізація через `inet_pton`/`inet_ntop` як авторитетний парсер, і той самий канонічний рядок іде і у валідацію, і в `CURLOPT_RESOLVE` — без розбіжності.
3. **[Medium] IPv6/AAAA ніколи не резолвились** — задокументований блок `::1`/`fc00::/7` фактично не перевірявся (хоч і випадково безпечно, бо підключення йшло лише через IPv4). Виправлено: резолвляться й валідуються і A, і AAAA записи; IPv6-only цілі свідомо відхиляються, а не намагаються підключитись через складніший IPv6-синтаксис `CURLOPT_RESOLVE`.
4. **[Low, dismissed] Дублювання внутрішніх `save()` у `gcSessions`/`enforceMaxSessions` поверх фінального `save()` контролера** — підтверджено безпечним (усе під одним локом), лише зайвий I/O. Не чіпаємо вже конвергований `Storage`.
5. **[Low, без змін] `check_answer`/`get_offer` не звіряють `sender_key` з ініціатором** — відповідає специфікації (немає такого поля в протоколі), захист — невгадуваність `room_id`.
6. **[Medium] Крихка класифікація 403 vs 502 через `str_contains` на тексті помилки** — виправлено: явний булевий прапорець `reject` на кожному шляху повернення з `fetchProofUrl`.
7. **[Medium] Повернене значення `Storage::save()` ігнорувалось у трьох мутуючих гілках** — невдалий запис (диск заповнено, права) мовчки повертав би `200 success`, хоча нічого не збереглося. Виправлено: перевірка `save()` і `500` при невдачі у `create_invite`/`create_offer`/`submit_answer`.

## Статус

Усі знахідки виправлені в тому ж коміті. Живо перевірено після фіксів (decimal/hex/octal IP-кодування, IPv6 loopback) — знайдено й одразу виправлено 8-й баг (дужки навколо IPv6-літералу не знімались перед `inet_pton`). Перехід до ітерації 2.
