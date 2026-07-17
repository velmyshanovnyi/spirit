// Section PN3 (specs/phase5/push-notifications.md): the Service Worker that
// receives Web Push events while the tab is closed and turns them into a
// system notification, whose click reopens Spirit straight at the invite
// link the push carried (the same zero-click auto-join as Section F4 --
// this file adds no new "receive a message" logic of its own).
//
// Runs in the ServiceWorkerGlobalScope (`self`), a different global than
// app.js's `window`. The pure, easily-testable logic is factored into
// exported functions below; the `self.addEventListener(...)` wiring at the
// bottom is thin glue that jsdom-based tests don't exercise directly (jsdom
// has no PushEvent/NotificationEvent/Clients API to construct), but is
// harmless to load under jsdom (registering a listener for an event type
// that jsdom simply never fires).

export const NOTIFICATION_TAG = "spirit-invite";

/**
 * @param {unknown} rawJson whatever PushEvent.data.json() returned.
 * @returns {{ room: string, token: string } | null} null for anything that
 *   isn't a well-formed Spirit invite payload -- the push provider or an
 *   unrelated sender could in principle deliver garbage; never throw on it.
 */
export function parsePushData(rawJson) {
  if (!rawJson || typeof rawJson !== "object") return null;
  const { room, token } = rawJson;
  if (typeof room !== "string" || !room || typeof token !== "string" || !token) return null;
  return { room, token };
}

/**
 * @param {{ room: string, token: string }} invite
 * @returns {NotificationOptions & { data: { room: string, token: string } }}
 */
export function buildNotificationOptions(invite) {
  return {
    body: "Хтось хоче поговорити з вами в Spirit",
    tag: NOTIFICATION_TAG, // a second push before the first is opened replaces it, not stacks
    data: invite,
    requireInteraction: false
  };
}

/**
 * @param {{ room: string, token: string }} invite
 * @returns {string} a relative URL matching Section F4's existing zero-click
 *   auto-join query-param contract (?room=&token=#/room).
 */
export function buildJoinUrl({ room, token }) {
  return `/?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}#/room`;
}

/**
 * Prefer focusing an already-open Spirit tab (navigating it to the invite
 * URL) over opening a new one -- avoids tab pile-up from repeated pushes.
 * @param {Array<{ url: string, focus: () => Promise<unknown>, navigate?: (url: string) => Promise<unknown> }>} windowClients
 * @param {string} joinUrl
 * @param {{ openWindow: (url: string) => Promise<unknown> }} clientsApi
 */
export async function focusOrOpenClient(windowClients, joinUrl, clientsApi) {
  for (const client of windowClients) {
    if (typeof client.focus === "function") {
      if (typeof client.navigate === "function") {
        // A rejected navigate() (out-of-scope client, already-navigated-away
        // client, etc. -- exec review finding) must not abort the whole
        // click handler: still focus the tab even if navigating it failed,
        // rather than leaving the notification click doing nothing at all.
        try {
          await client.navigate(joinUrl);
        } catch {
          // fall through to focus() below regardless
        }
      }
      return client.focus();
    }
  }
  return clientsApi.openWindow(joinUrl);
}

/* c8 ignore start -- runtime glue, not exercised by jsdom-based unit tests
   (no PushEvent/NotificationEvent/Clients constructors available there) */
if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("push", (event) => {
    event.waitUntil(
      (async () => {
        let rawJson = null;
        try {
          rawJson = event.data ? event.data.json() : null;
        } catch {
          rawJson = null;
        }
        const invite = parsePushData(rawJson);
        if (!invite) return;
        await self.registration.showNotification("Spirit", buildNotificationOptions(invite));
      })()
    );
  });

  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const invite = parsePushData(event.notification.data);
    if (!invite) return;
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windowClients) => focusOrOpenClient(windowClients, buildJoinUrl(invite), self.clients))
    );
  });
}
/* c8 ignore stop */
