/**
 * Minimal hash-based router: shows exactly one `[data-screen]` element at a
 * time, driven by `location.hash` (`#/<route>`). No history-API dependency
 * (hash routing works from a plain `file://` preview too), no external deps.
 */

function parseRoute(hash) {
  // "#/room" -> "room"; "" / "#" / "#/" -> "".
  return hash.replace(/^#\/?/, "");
}

export function initRouter(
  doc,
  {
    routes,
    defaultRoute,
    gatedRoutes = [],
    hasIdentity,
    // Section SM3 (specs/ui/simplified-ephemeral-mode.md): a second,
    // independent gate -- same shape as gatedRoutes/hasIdentity, different
    // predicate (advanced-mode-unlocked vs. has-identity), own callback so
    // a caller can surface a "this section is hidden" notice. Deliberately
    // NOT merged into gatedRoutes: the two gates redirect for unrelated
    // reasons and a future caller may want only one of them.
    //
    // Section GE2 (specs/ui/granular-feature-flags.md): isRestricted is
    // called AS isRestricted(route) -- the route currently being checked --
    // so a caller can restrict routes individually (per-feature flags) on
    // top of a coarser master gate, not just all-or-nothing. Existing
    // callers that pass a zero-arg predicate are unaffected (the extra
    // argument is simply ignored).
    restrictedRoutes = [],
    isRestricted = () => false,
    // Deliberately independent from defaultRoute: the caller may want the
    // identity gate and the restricted-mode gate to bounce to different
    // screens (Section SM3 sends restricted routes to "conversation", not
    // to the identity gate's "account" fallback -- "conversation" is
    // itself identity-gated, so a route that's simultaneously fresh
    // (no identity yet) AND restricted correctly cascades through both
    // gates in one settle rather than looping between them).
    restrictedRedirectRoute = defaultRoute,
    onRestricted
  }
) {
  const screens = new Map();
  for (const el of doc.querySelectorAll("[data-screen]")) {
    screens.set(el.dataset.screen, el);
  }
  const navItems = [...doc.querySelectorAll(".nav-item[data-route]")];

  // Section SM3 exec review (specs/reviews/simplified-ephemeral-mode-SM2-SM3-iter1.md,
  // finding 3): each gate's own misconfiguration guard only checks ITS OWN
  // route list, so a redirect target that's gated by the OTHER gate (not
  // restricted by its own) slips past both guards -- e.g.
  // restrictedRedirectRoute identity-gated, and the identity gate's
  // defaultRoute itself restricted, cycles server -> conversation ->
  // account -> server forever without either guard ever tripping. A hop
  // counter is the only check that's correct regardless of how many gates
  // exist or how they're configured relative to each other.
  const MAX_REDIRECT_HOPS = 10;

  // True only for the duration of a navigation the USER actively triggered:
  // a nav-item click, a caller passing { userInitiated: true }, or a TRUSTED
  // hashchange (Back/Forward, address bar, bookmark, session restore). Read
  // by render() when reporting a restricted route -- see onRestricted below.
  // Safe as a plain flag rather than a parameter threaded through render()'s
  // recursion because render() is fully synchronous: nothing else can run
  // between setting and clearing it. Declared ABOVE render() (its only
  // reader) so an early call could never hit its temporal dead zone.
  let navigationWasUserInitiated = false;

  function render(hopCount = 0) {
    if (hopCount > MAX_REDIRECT_HOPS) {
      throw new Error(
        `initRouter: too many redirect hops (>${MAX_REDIRECT_HOPS}) -- likely a cycle between gatedRoutes/restrictedRoutes redirect targets`
      );
    }
    let route = parseRoute(doc.defaultView.location.hash);
    if (!routes.includes(route)) {
      route = defaultRoute;
    }
    if (gatedRoutes.includes(route) && !hasIdentity()) {
      if (gatedRoutes.includes(defaultRoute)) {
        // Misconfiguration guard: a gated defaultRoute would recurse forever.
        throw new Error(`initRouter: defaultRoute "${defaultRoute}" must not be a gated route`);
      }
      // Reflect the redirect in the address bar, then render the corrected
      // route immediately -- callers (e.g. navigate()) must see the right
      // screen synchronously, not only after the browser's own (possibly
      // async, e.g. in jsdom) hashchange for this new hash fires.
      doc.defaultView.location.hash = `#/${defaultRoute}`;
      render(hopCount + 1);
      return;
    }
    if (restrictedRoutes.includes(route) && isRestricted(route)) {
      if (restrictedRoutes.includes(restrictedRedirectRoute)) {
        // Misconfiguration guard: a restricted redirect target would
        // recurse forever against ITS OWN gate. (It may legitimately be
        // gated by the identity check above -- that's a different gate,
        // handled by cascading through this function again, not a loop.)
        throw new Error(`initRouter: restrictedRedirectRoute "${restrictedRedirectRoute}" must not itself be a restricted route`);
      }
      // Backlog A2+A3 (docs/backlog.md): this is a RENDER-level hook, so it
      // fires the same whether the user clicked a nav item, the app
      // navigated itself (postIdentityRoute() after login/recovery), or a
      // re-render was triggered by LOCKING advanced mode. Callers that
      // answer a restricted route with a password prompt must only do so
      // for a genuine user click -- otherwise an ordinary login pops an
      // unrequested admin-password modal, and locking instantly re-prompts
      // (and, once unlocked, undoes the very lock the user asked for).
      onRestricted?.(route, { userInitiated: navigationWasUserInitiated });
      doc.defaultView.location.hash = `#/${restrictedRedirectRoute}`;
      render(hopCount + 1);
      return;
    }

    for (const [name, el] of screens) {
      el.hidden = name !== route;
    }
    for (const item of navItems) {
      if (item.dataset.route === route) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
      // A gated item (no identity yet) is dead weight -- clicking it would
      // just redirect right back to the identity gate's own fallback, so
      // hide it instead. A RESTRICTED item (Section SM3, advanced mode
      // locked) is deliberately NOT hidden the same way (user decision
      // 2026-07-31): the render()-level restrictedRoutes gate above still
      // redirects back with a "розділ вимкнено" notice on click, so hiding
      // the nav item itself only hid the affordance without changing that
      // behavior -- the user wants the full menu visible, with clicking a
      // locked item being the feedback mechanism, not its disappearance.
      item.hidden = gatedRoutes.includes(item.dataset.route) && !hasIdentity();
    }
  }

  function navigate(route, { userInitiated = false } = {}) {
    navigationWasUserInitiated = userInitiated;
    try {
      // Set the hash for deep-linking/back-button support, but don't wait for
      // the browser's own (potentially async) hashchange event -- render
      // synchronously so callers can rely on the screen having switched.
      doc.defaultView.location.hash = `#/${route}`;
      render();
    } finally {
      // Defense in depth, deliberately NOT load-bearing: every entry point
      // into render() (this function, the hashchange listener, and the
      // init-time call below) assigns the flag before rendering, so no
      // stale value can be read even without this reset -- a mutation that
      // deletes it correctly survives the suite. Kept because it costs
      // nothing and makes the flag's lifetime obvious to a reader.
      navigationWasUserInitiated = false;
    }
  }

  for (const item of navItems) {
    item.addEventListener("click", (event) => {
      // Bug report (2026-08-08): nav items are real <a href="#/..."> (needed
      // for deep-linking and Ctrl/Cmd/Shift-click "open in new tab/window",
      // preserved by the modifier-key bail-out below), but ALSO carry this
      // JS listener. On a RESTRICTED route (SM3's own gate), without
      // preventDefault() a plain click double-fires: navigate()'s own
      // synchronous render() redirects away and shows the "розділ вимкнено"
      // notice once, then the browser's native anchor default action (once
      // the click event finishes dispatching) navigates AGAIN -- now to a
      // hash genuinely different from the just-redirected current one --
      // triggering a second async hashchange, a second notice, and a junk
      // back-button history entry. (On the common, non-restricted path this
      // was harmless -- a same-hash anchor click is a no-op -- but the
      // restricted-route double-fire is exactly the kind of "did that
      // actually do anything?" confusion a real user would report as
      // "clicking does nothing.")
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(item.dataset.route, { userInitiated: true });
    });
  }

  // Re-initializing (HMR, multiple app instances in one window/tests) must
  // not stack hashchange listeners -- only the latest initRouter call's
  // render() should ever run.
  const win = doc.defaultView;
  if (win.__spiritRouterHashListener) {
    win.removeEventListener("hashchange", win.__spiritRouterHashListener);
  }
  // Exec review iter2 (specs/reviews/simplified-ephemeral-mode-SM2-SM3-iter1.md,
  // finding 3 follow-up): render was registered DIRECTLY as the listener,
  // so the browser's Event object landed in render's hopCount parameter on
  // every hashchange-driven call -- Event > MAX_REDIRECT_HOPS is always
  // false and hopCount + 1 string-concatenates onto the Event's string
  // form, so the hop-counter guard silently never tripped on the one path
  // (real navigation) it most needed to cover; only the init-time and
  // navigate()-time calls (both call render() with no args) were ever
  // actually protected. Wrapping ensures hopCount always starts at its
  // real default (0) regardless of caller.
  const hashChangeListener = (event) => {
    // Exec review finding 2 (backlog A2+A3): a TRUSTED hashchange is a real
    // user action that simply doesn't route through navigate() -- Back/
    // Forward, an edited address bar, a bookmarked or shared deep link, a
    // restored session. Treating those as programmatic silently denied the
    // password prompt to precisely the person this feature is for: someone
    // who knows the password and opens #/server directly. A SYNTHETIC event
    // (app.js dispatches one after locking advanced mode) is untrusted and
    // must stay programmatic, which is what keeps A3 fixed.
    navigationWasUserInitiated = event?.isTrusted === true;
    try {
      render();
    } finally {
      navigationWasUserInitiated = false;
    }
  };
  win.__spiritRouterHashListener = hashChangeListener;
  win.addEventListener("hashchange", hashChangeListener);

  render();

  return { navigate };
}
