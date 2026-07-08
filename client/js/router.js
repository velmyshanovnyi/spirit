/**
 * Minimal hash-based router: shows exactly one `[data-screen]` element at a
 * time, driven by `location.hash` (`#/<route>`). No history-API dependency
 * (hash routing works from a plain `file://` preview too), no external deps.
 */

function parseRoute(hash) {
  // "#/room" -> "room"; "" / "#" / "#/" -> "".
  return hash.replace(/^#\/?/, "");
}

export function initRouter(doc, { routes, defaultRoute, gatedRoutes = [], hasIdentity }) {
  const screens = new Map();
  for (const el of doc.querySelectorAll("[data-screen]")) {
    screens.set(el.dataset.screen, el);
  }
  const navItems = [...doc.querySelectorAll(".nav-item[data-route]")];

  function render() {
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
      render();
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
  win.__spiritRouterHashListener = render;
  win.addEventListener("hashchange", render);

  render();

  return { navigate };
}
