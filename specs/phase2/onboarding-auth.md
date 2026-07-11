# Спека: Проста методологія підключення (створення акаунта / логін / сесія / нікнейм)

Переробка першого екрана («Акаунт»): чітка розвилка створення-акаунта-вперше vs. логін-в-наявний, коротке ім'я (нікнейм), яким користувач представляється іншим, і "запам'ятовування" останнього профілю на 24 години (за замовчуванням, налаштовується).

## Рішення (узгоджено з користувачем)

1. **Сесія 24 год = "простіший localStorage-прапорець"**: passphrase як і раніше запитується при КОЖНОМУ завантаженні сторінки (vaultKey лишається non-extractable і ніде не персистується поза пам'яттю вкладки — жодних змін у vault.js). Прапорець зберігає лише `{ lastProfileId, expiresAt }` у `localStorage`; поки не протух, екран логіну одразу показує passphrase-поле для ЦЬОГО профілю (не список профілів на вибір). TTL — налаштовуване поле на екрані «Профіль» (`settings:sessionTtlHours` у сховищі `profile`), за замовчуванням 24.
2. **Нікнейм транслюється в identity-announce**: підписане поле поруч з `identityPubkey`, тож недовірений сигнальний вузол не може підмінити чуже ім'я непомітно (сама сесія однаково TOFU — новий контакт довіряється при першій зустрічі, як і зараз). Локально нікнейм зберігається НЕ зашифрованим (сховище `profile`, ключ `nickname:<profileId>`) — сенсу шифрувати немає: він і так призначений бути публічним.
3. Spirit ID (`spirit0001<fingerprint>`) лишається справжнім системним ідентифікатором — нікнейм лише UI-шар поверх нього, ніде не замінює його як ключ пошуку/зберігання.

## Секція 16: Нікнейм — зберігання, підпис, відображення

- [x] **Tests**:
  - `client/tests/profile.test.js` (доповнення) — `setNickname(profileId, nickname)`/`getNickname(profileId)` пишуть/читають незашифрований запис `nickname:<profileId>`; `getNickname` для профілю без нікнейму повертає `null`.
  - `client/tests/identityAnnounce.test.js` (доповнення) — `createIdentityAnnounce` приймає новий параметр `nickname` і включає його в підписаний payload; `verifyIdentityAnnounce` повертає `nickname` у результаті; підроблений (несинхронний з підписом) нікнейм → верифікація провалюється (`null`).
  - `client/tests/contacts.test.js` (доповнення) — `rememberContact` приймає й зберігає `nickname`; повторна зустріч з ОНОВЛЕНИМ нікнеймом (той самий fingerprint) оновлює збережений нікнейм контакту (нікнейми можна міняти, на відміну від fingerprint).
  - `client/tests/app.test.js` — власний нікнейм передається в `createIdentityAnnounce`; вхідний нікнейм показується РАЗОМ з fingerprint (ніколи замість нього — виправлено в exec review, п.1).
- [x] **Impl**: `client/js/profile.js` (`setNickname`/`getNickname`, прямий незашифрований запис — НЕ через `persistRawIdentity`/vault), `client/js/identityAnnounce.js` (`nickname` — необов'язковий рядок у сигнатурах `createIdentityAnnounce`/`verifyIdentityAnnounce`, `""` якщо не задано, включений у `announcePayload`), `client/js/contacts.js` (`rememberContact` приймає `nickname`, зберігає й оновлює при повторній зустрічі), `client/js/app.js` (передає власний нікнейм у `createIdentityAnnounce`, зберігає нікнейм контакту з верифікованого announce, статус завжди показує `нікнейм (spirit ID)`), `client/js/i18n.js` (нові ключі × 11 локалей: `label.nickname`, `nickname.placeholder`).
- [x] **Exec review**: iter1 — [reviews/onboarding-auth-16-18-iter1.md](../reviews/onboarding-auth-16-18-iter1.md). 1 знахідка для цієї секції (nickname маскував fingerprint у статусі) — виправлено.

## Секція 17: Екран «Акаунт» — розвилка створення/логіну

Контекст: наразі екран завжди показує «Швидкий чат» + «Створити профіль» незалежно від того, чи є вже збережені профілі — новачок і той, хто повертається, бачать однаковий екран. **Виявлено під час імплементації**: старий UI розблокування (`profile-select`/`unlock-passphrase`/`btn-profile-unlock`) фізично лежав на гейтованому екрані `#/profile`, куди неможливо потрапити без уже наявної ідентичності — тобто повертний користувач не мав робочого шляху увійти в наявний акаунт через навігацію взагалі. Ця секція переносить цей блок на негейтований екран `#/account`, що й вирішує основну проблему.

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — немає збережених профілів → блок логіну прихований; є збережені профілі → блок логіну показаний (селектор профілів, passphrase, кнопка «Увійти»); одразу після створення профілю в цій сесії блок логіну лишається прихованим, навіть якщо `listProfiles()` тепер поверне цей профіль (немає сенсу логінитись у вже активну ідентичність — виправлено під час живої перевірки). Наявний flow «Швидкий чат (ефемерний)» / «Створити профіль» → `profile-setup` (тепер з полем нікнейму) лишився без змін, щоб не ламати наявні тести.
- [x] **Impl**: `client/index.html` (`#account-login-block` перенесений на екран `account`, поле `#nickname-input` у `#profile-setup`, TTL-поле на екрані `profile`), `client/js/app.js` (`refreshProfileSelector` тепер керує видимістю `#account-login-block` за `listProfiles().length` і `!!state.senderKey`; `btn-profile-confirm` зберігає нікнейм через `setNickname`), `client/js/i18n.js` (нові ключі × 11 локалей: `account.loginHeading`, `btn.login`).
- [x] **Exec review**: iter1 — [reviews/onboarding-auth-16-18-iter1.md](../reviews/onboarding-auth-16-18-iter1.md). Конвергенція без нових знахідок для цієї секції (окрім живо-виявленого login-block-after-create кейсу, вже виправленого до review).

## Секція 18: Пам'ять сесії (24 год, налаштовується)

- [x] **Tests**: `client/tests/session.test.js` (новий файл) — `rememberSession(profileId, ttlHours)` пише `{ profileId, expiresAt }` у `localStorage`; `getRememberedProfileId()` повертає id, поки не минув `expiresAt`, і `null` після/за відсутності запису/за пошкодженого JSON; `forgetSession()` очищує запис.
  `client/tests/app.test.js` (доповнення) — при завантаженні з дійсною пам'яттю сесії логін-блок одразу preselect-ить запам'ятований профіль у селекторі; успішний unlock викликає `rememberSession` з поточним TTL, і саме з МІГРОВАНИМ `profile.profileId`, не з selector-значенням (виправлено в exec review, п.2); поле TTL зберігає значення й використовується для наступного unlock; від'ємний TTL не призводить до `expiresAt` у минулому (виправлено в exec review, п.3).
- [x] **Impl**: `client/js/session.js` (новий модуль, чисті функції над `localStorage`, без крипто — сам passphrase не зберігається ніде), `client/js/app.js` (`readSessionTtlHours()` — клампована читання TTL-поля, `rememberSession`/`getRememberedProfileId` навколо `btn-profile-unlock` та `refreshProfileSelector`, поле `session-ttl-hours` на екрані «Профіль» зі збереженням у `profile`-сховище через `get`/`put`), `client/index.html` (поле TTL на екрані «Профіль»), `client/js/i18n.js` (`label.sessionTtl` × 11 локалей).
- [x] **Exec review**: iter1 — [reviews/onboarding-auth-16-18-iter1.md](../reviews/onboarding-auth-16-18-iter1.md). 2 знахідки для цієї секції (legacy-migration id, від'ємний TTL) — обидві виправлено.

## Верифікація

Test-first, jsdom + fake-indexeddb (як решта проєкту); `localStorage` — нативний jsdom API, без моків. Фінал: жива перевірка в preview (створення нового акаунта з нікнеймом, логін у наявний з попереднім вибором профілю, перегляд нікнейму співрозмовника в чаті після identity-announce) + деплой на обидва хости.
