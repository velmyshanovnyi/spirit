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
      onRestricted?.(route);
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

  function navigate(route) {
    // Set the hash for deep-linking/back-button support, but don't wait for
    // the browser's own (potentially async) hashchange event -- render
    // synchronously so callers can rely on the screen having switched.
    doc.defaultView.location.hash = `#/${route}`;
    render();
  }

  for (const item of navItems) {
    item.addEventListener("click", () => navigate(item.dataset.route));
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
  const hashChangeListener = () => render();
  win.__spiritRouterHashListener = hashChangeListener;
  win.addEventListener("hashchange", hashChangeListener);

  render();

  return { navigate };
}
