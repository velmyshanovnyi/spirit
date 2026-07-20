---
spec: phase2b/import
section: I1 (pure parsers)
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/importParsers.js
  - client/tests/importParsers.test.js
  - specs/phase2b/import.md
---

Focus: unhandled-exception safety on malformed/adversarial input, ReDoS risk in the WhatsApp
`.txt` line regex, whether documented format assumptions are honestly flagged as assumptions
rather than presented as verified fact, Unicode/surrogate-pair safety, and general correctness
including test-coverage gaps against claimed behavior.

Five checks performed:

1. **Unhandled native exceptions on adversarial input** -- no findings. Every parser type-guards
   before dereferencing (`data`, `data.contacts`, `Array.isArray(...)`, per-entry object checks,
   `typeof ... === "string"` on every field read) before touching nested fields. All malformed
   shapes route to the `fail()` helper, which always throws a clear `importParsers:`-prefixed
   `Error`. `parseJson` wraps `JSON.parse` and re-throws with a descriptive message.
   `extractTelegramText` safely returns `""` for any non-string/non-array `text` instead of
   throwing. `parseVcardField` uses `indexOf`+`slice`, which cannot throw on any string input.

2. **ReDoS / catastrophic backtracking in `WHATSAPP_LINE_RE`** -- no findings. Every quantifier is
   bounded or non-nested; the one lazy group (`[^:\n]{1,200}?` for the sender name) is capped at
   200 chars and uses a negated class that excludes the following `:` delimiter, so there is no
   overlap/ambiguity between the sender-name match and the separator that could trigger
   backtracking blowup. The trailing `[\s\S]*$` is a single greedy run anchored to end-of-string
   with no following token to backtrack against. A long non-matching line degrades at worst
   linearly.

3. **Documented format assumptions honestly flagged** -- no findings. The header comment block
   explicitly labels confidence levels and limitations rather than asserting fact: Telegram field
   names as "MEDIUM-HIGH confidence... NOT verified against a live export"; vCard line-folding as
   "NOT implemented in this first cut... a known, deliberate limitation, not an oversight";
   WhatsApp-contacts-as-vCard as "ASSUMPTION (low-to-medium confidence, not verified)... a
   documented judgment call, not a verified fact"; WhatsApp 12-hour time as "a known limitation,
   not implemented".

4. **Unicode / surrogate-pair safety** -- no findings. No `charCodeAt`/`codePointAt`/
   `fromCharCode`/byte-level operations anywhere in the file. The only index-based slicing
   (`parseVcardField`) cuts at the position of an ASCII `:`, so it can never bisect a multi-byte
   character or surrogate pair. `toUpperCase()` is applied only to the ASCII field-name part
   (`FN`/`TEL`/etc.), never to values. Tests confirm Cyrillic and emoji round-trip correctly.

5. **General correctness / test coverage** -- **finding (fixed)**: two documented `fail()` throw
   paths were unexercised by the original test suite:
   - `client/js/importParsers.js` (vCard: FN present but no TEL/EMAIL) -- no test covered this
     branch; the suite only tested the inverse (TEL present, no FN).
   - `client/js/importParsers.js` (Telegram contact: neither `phone_number` nor `user_id`
     present) -- no test covered this branch; the suite only tested the `user_id`-fallback
     success case.

   **Fix applied**: added `"throws a clear Error when a vCard has FN but no TEL or EMAIL"` and
   `"throws a clear Error when neither phone_number nor user_id is present"` to
   `client/tests/importParsers.test.js`. Suite grew from 23 to 25 tests, still green.

   No incorrect assertions were found elsewhere: multi-line WhatsApp message joining, two
   consecutive multi-line messages from different senders staying separate, Telegram
   text-entity-array flattening, and service-message skipping are all genuinely exercised against
   the corresponding implementation branches.

Overall verdict: **converged** after the one test-coverage fix above. No implementation changes
were needed -- exception-safety, ReDoS resistance, assumption-honesty, and Unicode handling were
all sound on first pass.
