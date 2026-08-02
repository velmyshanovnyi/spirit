// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initRouter } from "../js/router.js";

const ROUTES = ["account", "profile", "server", "room", "conversation", "contacts", "history"];

function buildDom() {
  document.body.innerHTML = `
    <nav>
      ${ROUTES.map((r) => `<a class="nav-item" data-route="${r}" href="#/${r}">${r}</a>`).join("")}
    </nav>
    <main>
      ${ROUTES.map((r) => `<section data-screen="${r}">${r} screen</section>`).join("")}
    </main>
  `;
}

function visibleScreens() {
  return [...document.querySelectorAll("[data-screen]")].filter((s) => !s.hidden).map((s) => s.dataset.screen);
}

beforeEach(() => {
  location.hash = "";
  buildDom();
});

describe("initRouter", () => {
  it("shows exactly one screen and hides the rest, defaulting when the hash is empty", () => {
    initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });
    expect(visibleScreens()).toEqual(["account"]);
  });

  it("switches the visible screen when the hash changes", () => {
    initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["server"]);

    location.hash = "#/room";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["room"]);
  });

  it("falls back to the default route for an unknown hash", () => {
    initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    location.hash = "#/does-not-exist";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["account"]);
  });

  it("redirects a gated route to account when there is no identity", () => {
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["profile", "conversation", "contacts", "history"],
      hasIdentity: () => false
    });

    location.hash = "#/profile";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["account"]);
    expect(location.hash).toBe("#/account");
  });

  it("allows a gated route once an identity exists", () => {
    let identity = false;
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["profile"],
      hasIdentity: () => identity
    });

    identity = true;
    location.hash = "#/profile";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["profile"]);
  });

  it("hides gated nav items when there is no identity, and shows them once one exists", () => {
    let identity = false;
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["profile", "conversation", "contacts", "history"],
      hasIdentity: () => identity
    });

    const navItem = (route) => document.querySelector(`.nav-item[data-route="${route}"]`);
    for (const route of ["profile", "conversation", "contacts", "history"]) {
      expect(navItem(route).hidden).toBe(true);
    }
    expect(navItem("account").hidden).toBe(false);
    expect(navItem("server").hidden).toBe(false);
    expect(navItem("room").hidden).toBe(false);

    identity = true;
    location.hash = "#/profile";
    window.dispatchEvent(new Event("hashchange"));
    for (const route of ["profile", "conversation", "contacts", "history"]) {
      expect(navItem(route).hidden).toBe(false);
    }
  });

  it("marks the active nav item with aria-current and clears it from the others", () => {
    initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    location.hash = "#/contacts";
    window.dispatchEvent(new Event("hashchange"));

    const current = [...document.querySelectorAll(".nav-item")].filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.dataset.route)).toEqual(["contacts"]);
  });

  it("navigate() to a gated route without identity renders the redirect synchronously, not just the old screen", () => {
    const { navigate } = initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["profile"],
      hasIdentity: () => false
    });
    // Start somewhere other than defaultRoute, so a stale (non-recursed)
    // render() leaving the old screen visible is actually observable.
    navigate("room");
    expect(visibleScreens()).toEqual(["room"]);

    navigate("profile");

    // No async hashchange dispatch in this test -- if navigate() only set
    // location.hash and relied on the browser event, "room" would still be
    // the visible screen right here instead of the redirect target.
    expect(visibleScreens()).toEqual(["account"]);
    expect(location.hash).toBe("#/account");
  });

  it("re-initializing on the same document only reacts through the latest instance's screens/nav", () => {
    initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    // Second app instance: fresh DOM, fresh initRouter call.
    buildDom();
    const second = initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    location.hash = "#/room";
    window.dispatchEvent(new Event("hashchange"));

    expect(visibleScreens()).toEqual(["room"]);
    second.navigate("history");
    expect(visibleScreens()).toEqual(["history"]);
  });

  it("exposes navigate() to change route programmatically", () => {
    const { navigate } = initRouter(document, { routes: ROUTES, defaultRoute: "account", hasIdentity: () => true });

    navigate("history");
    expect(location.hash).toBe("#/history");
    expect(visibleScreens()).toEqual(["history"]);
  });

  // Section SM3 (specs/ui/simplified-ephemeral-mode.md): a second,
  // independent gate from gatedRoutes/hasIdentity -- same mechanism shape,
  // different predicate, own callback for a UI notice. Defaults ([], () =>
  // false) keep every existing test above byte-for-byte unaffected.
  it("redirects a restricted route to the default route and calls onRestricted, independent of the identity gate", () => {
    const onRestricted = vi.fn();
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "conversation",
      hasIdentity: () => true,
      restrictedRoutes: ["profile", "server", "room", "history"],
      isRestricted: () => true,
      onRestricted
    });

    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));

    expect(visibleScreens()).toEqual(["conversation"]);
    expect(location.hash).toBe("#/conversation");
    expect(onRestricted).toHaveBeenCalledWith("server");
  });

  it("allows a restricted route once isRestricted() returns false, without touching onRestricted", () => {
    let restricted = true;
    const onRestricted = vi.fn();
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "conversation",
      hasIdentity: () => true,
      restrictedRoutes: ["server"],
      isRestricted: () => restricted,
      onRestricted
    });

    restricted = false;
    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));

    expect(visibleScreens()).toEqual(["server"]);
    expect(onRestricted).not.toHaveBeenCalled();
  });

  it("cascades correctly (no infinite loop) when the restricted redirect target is itself identity-gated", () => {
    // Mirrors app.js's real shape: restricted routes redirect to
    // "conversation", but "conversation" is ALSO identity-gated and no
    // identity exists yet -- must settle on the identity gate's own
    // defaultRoute ("account"), not loop between the two gates.
    const onRestricted = vi.fn();
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["conversation"],
      hasIdentity: () => false,
      restrictedRoutes: ["server", "profile", "room", "history"],
      isRestricted: () => true,
      restrictedRedirectRoute: "conversation",
      onRestricted
    });

    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));

    expect(visibleScreens()).toEqual(["account"]);
    expect(location.hash).toBe("#/account");
    expect(onRestricted).toHaveBeenCalledWith("server");
    expect(onRestricted).toHaveBeenCalledTimes(1);
  });

  it("throws instead of hanging on a redirect cycle between the two gates (defense-in-depth, exec review finding 3)", () => {
    // Contrived but reachable-by-misconfiguration: restrictedRedirectRoute
    // is itself identity-gated, and the identity gate's OWN defaultRoute is
    // itself restricted -- neither per-gate misconfiguration guard trips
    // (each only checks its own list), so without a hop limit render()
    // would cycle server -> conversation -> account -> server forever.
    // This exercises the INIT-time render() call (initRouter's own final
    // render() at setup) -- see the next test for the hashchange-driven
    // entry point, which had its own separate bug.
    expect(() => {
      initRouter(document, {
        routes: ROUTES,
        defaultRoute: "account",
        gatedRoutes: ["conversation"],
        hasIdentity: () => false,
        restrictedRoutes: ["server", "account"],
        isRestricted: () => true,
        restrictedRedirectRoute: "conversation"
      });
    }).toThrow(/redirect/i);
  });

  it("registers a hashchange listener that starts hopCount at 0, not at the Event object itself (exec review iter2 finding)", () => {
    // Iter2 exec review: render was previously registered DIRECTLY as the
    // hashchange listener (`win.addEventListener("hashchange", render)`),
    // so the browser passes an Event object as render's FIRST argument on
    // every event-driven call -- which IS render's hopCount parameter.
    // `Event > MAX_REDIRECT_HOPS` is always false and `hopCount + 1`
    // string-concatenates onto the Event's string form, so the hop-counter
    // guard silently never tripped on the one path (real navigation) it
    // most needed to cover -- only the init-time and navigate()-time calls
    // (both call render() with zero arguments) were ever actually
    // protected. This calls the ACTUAL registered listener directly with a
    // real Event (exactly what the browser does), bypassing dispatchEvent's
    // (correct, but test-inconvenient) swallowing of synchronous throws
    // from listeners.
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    let cyclic = false;
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["conversation"],
      hasIdentity: () => !cyclic,
      restrictedRoutes: ["server", "account"],
      isRestricted: () => cyclic,
      restrictedRedirectRoute: "conversation"
    });
    const hashchangeCall = addEventListenerSpy.mock.calls.find((call) => call[0] === "hashchange");
    const registeredListener = hashchangeCall[1];
    addEventListenerSpy.mockRestore();

    cyclic = true;
    location.hash = "#/server";
    expect(() => registeredListener(new Event("hashchange"))).toThrow(/redirect/i);
  });

  // User decision 2026-07-31 (follow-up to keeping the settings gear
  // itself always visible): the menu's nav items stay visible too, even
  // for a restricted route -- clicking one still redirects back with the
  // "розділ вимкнено" notice (the render()-level restrictedRoutes gate
  // above, untouched by this), so hiding the item itself only hid the
  // affordance without changing what clicking it does. Restricted-ness
  // no longer affects nav-item visibility at all; only the identity gate
  // (gatedRoutes/hasIdentity) still does, a genuinely different concern
  // (no identity yet vs. advanced mode locked).
  it("does NOT hide restricted nav items -- only the identity gate affects nav-item visibility", () => {
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "conversation",
      hasIdentity: () => true,
      restrictedRoutes: ["profile", "server"],
      isRestricted: () => true
    });

    expect(document.querySelector('.nav-item[data-route="profile"]').hidden).toBe(false);
    expect(document.querySelector('.nav-item[data-route="server"]').hidden).toBe(false);
    expect(document.querySelector('.nav-item[data-route="room"]').hidden).toBe(false);
  });

  it("still hides identity-gated nav items when there is no identity, independent of restrictedRoutes", () => {
    initRouter(document, {
      routes: ROUTES,
      defaultRoute: "account",
      gatedRoutes: ["profile"],
      hasIdentity: () => false,
      restrictedRoutes: ["server"],
      isRestricted: () => true
    });

    expect(document.querySelector('.nav-item[data-route="profile"]').hidden).toBe(true);
    // restricted but NOT identity-gated -- visible despite isRestricted() being true.
    expect(document.querySelector('.nav-item[data-route="server"]').hidden).toBe(false);
  });
});
