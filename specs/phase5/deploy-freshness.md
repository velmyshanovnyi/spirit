# Свіжість коду після деплою (backlog A11 системно, G7 побічно)

## Проблема

Обидва хости віддають статику без `Cache-Control` (лише `Last-Modified`/`ETag`,
перевірено живо 2026-09-18: nginx, `.htaccess` ігнорується). Браузер застосовує
евристичну свіжість (~10% віку файлу): що давніший файл, то довше браузер
**мовчки не ревалідує** його після деплою. Наслідки: (A11) жива перевірка після
деплою може тестувати старий код — уже двічі давала хибні висновки; (G7)
користувач бачить оновлення із запізненням у дні.

## Рішення

У проєкті вже є service worker на кореневому scope (`/sw.js`, PN3, push) — а
sw.js сам оновлюється браузером **повз HTTP-кеш** при кожній навігації, тобто
є самовиліковним каналом доставки. Додаємо в нього `fetch`-обробник:

- same-origin **GET** → `fetch(request, { cache: "no-cache" })` — примусова
  ревалідація умовним запитом (`If-None-Match`/`If-Modified-Since`); свіжий
  файл = 304, дешево; змінений = 200 з новим тілом. Жодного власного кешу,
  жодного стану (інваріант zero-database не зачеплено навіть по духу).
- Збій мережі → фолбек `fetch(request)` без опцій — та сама поведінка
  офлайн, що й без SW (HTTP-кеш може віддати евристично-свіже).
- Не-GET і cross-origin — не перехоплюємо взагалі (без `respondWith`).
- `self.skipWaiting()` при install + `clients.claim()` при activate — новий
  SW бере контроль одразу, без «закрийте всі вкладки».

Рішення в чистих функціях, глю — тонке, як у PN3. Примітка (виправлено в
F2): за специфікацією конструювання Request з init від navigate-запиту скидає
mode у "same-origin", але Chrome на практиці кидає TypeError — навігації
запитуються за URL (`revalidateFetchArgs`).

Перехідний період: перший reload після цього деплою ще виконує старий кеш
(але вже встановлює новий SW), з другого — гарантована свіжість. Практика №1
з A11 (порівняння cached vs no-store) лишається чинною для самої перевірки
цього деплою.

## Секція F1: fetch-обробник примусової ревалідації в sw.js

- [x] **Tests**: `client/tests/sw.test.js` — `shouldForceRevalidate`: GET same-origin → true; POST/PUT same-origin → false; GET cross-origin → false; GET того ж хоста з іншою схемою/портом → false.
- [x] **Impl**: `client/sw.js` — експортована `shouldForceRevalidate(request, origin)`; глю: `fetch`-обробник з no-cache + офлайн-фолбеком, `install`→`skipWaiting`, `activate`→`clients.claim`.
- [x] **Exec review**: iter1 — [reviews/deploy-freshness-F1-iter1.md](../reviews/deploy-freshness-F1-iter1.md). PASS_WITH_NOTES, 0 знахідок, 3 нотатки (1 прийнята як трейдофф, 1 виправлена, жива перевірка — у артефакті).

## Секція F2: навігації таки потребують окремої гілки (баг F1)

**Знахідка (2026-10-02, жива перевірка A13).** На обох хостах свіжа вкладка
отримала СТАРИЙ `index.html` (encodedBodySize 53123 = попередній коміт) при
`workerStart > 0` і `PerformanceNavigationTiming.deliveryType === "cache"`, тоді
як `fetch("/")` зі сторінки через той самий SW повертав свіжий документ. Тобто
примітка F1 «окремої гілки для навігацій не треба» хибна на практиці: Chrome
відкидає `new Request(navigateRequest, init)` (TypeError), `fetch(...)`
повертає rejected promise → спрацьовує офлайн-фолбек `fetch(event.request)` →
евристичний HTTP-кеш → застарілий документ. Субресурси (mode ≠ navigate)
ревалідуються коректно.

**Фікс.** Чиста функція `revalidateFetchArgs(request)` повертає аргументи
для `fetch`: для `mode === "navigate"` — `[request.url, { cache: "no-cache",
credentials: "same-origin", redirect: "manual" }]` (запит за URL, без
копіювання navigate-Request; `redirect: "manual"` — бо `respondWith` відкидає
followed-redirect відповідь для навігації, а opaqueredirect браузер слідує сам —
знахідка review iter1);
для решти — `[request, { cache: "no-cache" }]`. Обробник: `fetch(...revalidateFetchArgs(event.request)).catch(() => fetch(event.request))`.
Офлайн-фолбек лишається.

Residual: до фіксу у вкладці, відкритій ДО деплою, `location.reload()`
віддав `i18n.js` з `workerStart 0` / старим тілом. Після фіксу не відтворюється
(той самий reload — усі модулі через SW, свіжі): тінь того самого бага
(застарілий документ з кешу тягнув і свої субресурси з кешу).

- [x] **Tests**: `client/tests/sw.test.js` — `revalidateFetchArgs`: navigate-запит → `[url, {cache:"no-cache", credentials:"same-origin", redirect:"manual"}]`; звичайний GET → `[request, {cache:"no-cache"}]` (той самий об'єкт). RED до впровадження.
- [x] **Impl**: `client/sw.js` — експорт `revalidateFetchArgs`, обробник використовує її; хибну примітку в розділі «Рішення» виправлено.
- [x] **Exec review**: iter1 — [reviews/deploy-freshness-F2-iter1.md](../reviews/deploy-freshness-F2-iter1.md): 1 знахідка (redirect) — виправлено; iter2 — [reviews/deploy-freshness-F2-iter2.md](../reviews/deploy-freshness-F2-iter2.md): PASS, 0 знахідок; жива перевірка (до/після, обидва хости, редирект) — в iter2.
