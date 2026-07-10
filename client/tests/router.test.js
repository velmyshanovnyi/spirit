// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
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
});
