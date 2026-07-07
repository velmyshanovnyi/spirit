---
spec: ui/redesign-i18n
section: "Секції U1+U2: i18n/теми ядро + редизайн і дротування"
iter: 2
agent: opus
files-reviewed:
  - client/js/app.js
  - client/js/i18n.js
  - client/index.html
---

## Знахідки

Немає нових. Фікси підтверджено повними:

1. `setDynamicText` покриває ОБИДВА runtime-елементи з `data-i18n` у реальній розмітці (`connection-status` через setStatus і всі чотири місця запису `pub-key-display`); решта runtime-цілей (`google-verify-status`, `profile-status`, `device-link-status`, `mnemonic-display`, `keyfile-display`, `chat-log`) не несуть `data-i18n` (перевірено grep-ом усіх 34 атрибутів) — прогалин немає.
2. `data-i18n-title` виставляє title+aria-label, не чіпає контент — коректно для icon-only перемикача теми.

## Статус

**Конвергенція досягнута.** Секції U1+U2 готові до коміту.
