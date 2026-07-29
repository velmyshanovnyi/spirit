// Section G3 (specs/reviews/spirit-evaluation-triage.md): extracted verbatim
// from client/index.html's former inline <script> so a strict
// Content-Security-Policy script-src can drop 'unsafe-inline' -- this file
// itself is loaded as a plain (non-module) script, still parsed and run
// synchronously before CSS paints, same timing as the inline version it
// replaces. Deliberately NOT a module (modules defer) -- the whole point is
// running before the stylesheet applies, to avoid a light->dark flash.
try {
  var stored = localStorage.getItem("spirit.theme");
  document.documentElement.dataset.theme =
    stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
