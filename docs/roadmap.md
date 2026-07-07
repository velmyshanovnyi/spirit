# Roadmap

## Фаза 0 — Архітектура (поточна)

Документація в `docs/`: компоненти, протокол сигналінгу, дизайн E2EE, журнал рішень. Коду немає.

## Фаза 1 — MVP ✅ ЗАВЕРШЕНО

Повна специфікація та історія review — [specs/phase1/mvp.md](../specs/phase1/mvp.md).

- Клієнт (Секції 1-5, test-first, Vitest): identity/ECDH keygen, E2EE (ECDH → HKDF → AES-256-GCM), signaling client, WebRTC-оркестрація, мінімальний UI. `client/`.
- Сигнальний вузол (Секції 6-10, PHP, верифіковано живим деплоєм на `spirit.kibr.com.ua` — PHP/Composer недоступні локально, explicit test-first waiver): файлове сховище з атомарним записом і GC, invite-токени, CORS, rate-limiting, повний контролер дій + опційний `fetch_proof` (SSRF-захищений). `server/`.
- Живо верифіковано: повний P2P-хендшейк, одноразовість invite-токенів під конкурентним навантаженням (3/3 рази), коди помилок, CORS preflight, rate limiting, SSRF-блокування (decimal/hex/octal/IPv6-кодування).
- Персистентність: відсутня — суто ефемерна сесія в пам'яті вкладки (за задумом MVP).

## Фаза 2 — Профілі, backup та мультипристрій ✅ ЗАВЕРШЕНО

Специфікації та історія review — [specs/phase2/profiles.md](../specs/phase2/profiles.md) (Секції 1-10) і [specs/phase2/history-sync-accounts.md](../specs/phase2/history-sync-accounts.md) (Секції 11-15). Test-first, 221 тест у сумі по проєкту.

- IndexedDB-обгортка (`db.js`) + passphrase-шифрування сховища (PBKDF2-HMAC-SHA256 600k → AES-256-GCM, `vault.js`).
- Перманентні профілі (`profile.js`): створення/розблокування, non-extractable ключ після завантаження; **мультиакаунти** (записи за fingerprint-ключами, селектор у UI, лінива міграція legacy-запису).
- Backup identity-ключа: BIP39-подібна мнемоніка (24 слова) та зашифрований keyfile — обидва з відновленням; UI-флоу з backup-кроком.
- Мультипристрій (`deviceLinking.js`): device-сертифікати, приєднання нового пристрою через P2P/E2EE-канал, відкликання через версійований підписаний список (анти-replay монотонність), транспорт списку контактам у чат-хендшейку.
- **Автентифікований identity-announce** (`identityAnnounce.js`): TOFU-контакти (`contacts.js`), прив'язка до session-ECDH (анти-replay/reflection/MITM-transplant), гейтування вхідного тексту на верифіковану identity.
- **Зашифрована історія повідомлень** (`historyStore.js`): AES-GCM під vault-ключем, per-profile/per-contact неймспейс, рендер історії при верифікації відомого контакта.
- Онбординг-UX ([migration.md](migration.md)) — перенесено в наступні ітерації; латентне питання: per-profile scoping контактів (див. review Секції 15).

### Фаза 2b — Опційний імпорт (не блокує Фазу 2)

- Importer-модуль для контактів (Telegram/vCard/WhatsApp export) з ручною верифікацією збігів.
- Importer-модуль для історії переписки (Telegram JSON / WhatsApp .txt), позначення імпортованих повідомлень як історичних.
- Деталі — [migration.md](migration.md).

### Фаза 2c — Опційна верифікація зовнішньої ідентичності (не блокує Фазу 2)

- Генерація/публікація/перевірка URL-доказів (Telegram, вебсайт, GitHub gist тощо), бейджі підтвердження в UI контакту.
- Proof-set: доставка через P2P-хендшейк, періодична переперевірка, явне відкликання власником.
- Опційна `fetch_proof` proxy-дія на сигнальному вузлі (вимкнена за замовчуванням) — оновлення [signaling-protocol.md](signaling-protocol.md).
- Email/DKIM-доказ — не в цій фазі, можливе майбутнє розширення.
- Деталі — [identity-verification.md](identity-verification.md).

### Фаза 2d — OAuth-верифікація (Google/Yandex зараз, Telegram/FB — заплановано)

- Автоматизована, криптографічно сильніша версія [identity-verification.md](identity-verification.md): замість ручної публікації proof-тексту, підписаний провайдером ID-токен (JWT) прив'язується до Spirit-ключа через `nonce`.
- Google, Yandex: чистий клієнтський OIDC-флоу (без бекенду Spirit) — деталі в [oauth-verification.md](oauth-verification.md).
- Telegram, Facebook: вимагають server-side перевірки (bot-токен/app-secret не можна тримати в браузері) — заплановано як опційний endpoint на сигнальному вузлі, за тією ж моделлю підвищеного ризику, що й `fetch_proof`.
- Не замінює анонімний identity-ключ (D3 лишається чинним) — виключно опційний шар "визнаності" поверх нього.

## Фаза 3 — Десктоп (Tauri)

- Обгортка існуючого HTML/JS у Tauri (Rust-ядро) для Windows.
- Доступ до локальної файлової системи для резервних копій зашифрованих профілів.
- Без втрати P2P-логіки — той самий клієнтський код, інший shell.

## Фаза 4 — Розширення (опційно, після MVP і стабілізації)

- Автентифікований обмін ключами (підпис ECDH-ключа identity-ключем) замість ручного safety number.
- Групові чати (multi-party WebRTC mesh або SFU-подібна координація без сервера, що бачить контент).
- Передача файлів через DataChannel.
- UI для одночасного використання кількох сигнальних/TURN вузлів (федеративність, стійкість до відмови одного вузла).
