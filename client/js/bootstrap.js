// Section G3 (specs/reviews/spirit-evaluation-triage.md): extracted verbatim
// from client/index.html's former inline <script type="module"> so a strict
// Content-Security-Policy script-src ('self', no 'unsafe-inline') doesn't
// block the app's own entry point -- an inline <script type="module"> is
// still an inline script for CSP purposes and needs 'unsafe-inline'/a
// nonce/a hash unless externalized like this.
import { initApp } from "./app.js";
import { getSetting } from "./settingsRegistry.js";

// autoStartChat: true matches the previous bare initApp(document) call's
// implicit default (Section H5). localMediaPreviewDelayMs: real
// production delay before the camera/mic permission prompt appears
// (Section F6 follow-up, bug report 2026-07-17) -- app.js's own default
// is 0 (instant), matching this file's test suite's expectations.
// iceTimeoutMs/answerWaitTimeoutMs (Section RF13): read from the
// user-tunable settings registry here rather than app.js's own
// (test-only) defaults, so production actually honors whatever the
// user set on the settings screen.
initApp(document, {
  autoStartChat: true,
  localMediaPreviewDelayMs: 1500,
  iceTimeoutMs: getSetting("iceTimeoutMs"),
  answerWaitTimeoutMs: getSetting("answerWaitTimeoutMs")
});

// Section PN3 (specs/phase5/push-notifications.md): register the push
// Service Worker eagerly so it's ready by the time a permanent-profile
// user opts into notifications (Section PN4, not yet wired up). A
// missing navigator.serviceWorker (older/restricted browsers) is a
// silent no-op -- notifications are an optional enhancement, never
// required for the chat itself to work.
if ("serviceWorker" in navigator) {
  // Served from the site ROOT (not js/sw.js) deliberately: a Service
  // Worker's default scope is the directory it's served from, and a
  // scope narrower than "/" means it never controls the main tab --
  // WindowClient.navigate() then rejects on every client, silently
  // breaking the notification-click "focus the open tab" path
  // (exec review finding, Section PN3).
  // sw.js uses top-level ES-module `export` statements (needed so
  // client/tests/sw.test.js can import its pure logic directly) --
  // without { type: "module" }, browsers parse the script as classic
  // (non-module) JS, where `export` is a SyntaxError, and registration
  // fails with "ServiceWorker script evaluation failed" (caught live
  // in production on spirit.kolo.media, Section PN3 post-deploy check).
  // "/sw.js" (root-absolute, not "./sw.js"): this file now lives under
  // js/, and a relative path here would register the worker with scope
  // js/ instead of site-root "/" -- the exact narrow-scope bug the
  // comment above warns about, just reintroduced via this file's own
  // new location (Section G3 extraction).
  navigator.serviceWorker.register("/sw.js", { type: "module" }).catch(() => {});
}
