import { exportRawIdentity } from "./profile.js";
import { createInvite } from "./signalingClient.js";
import { encryptMessage } from "./e2ee.js";
import { generateEcdhKeyPair, fingerprint } from "./identity.js";
import {
  generateDeviceKeyPair,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant,
  appendDeviceToList,
  deriveLinkVerificationCode
} from "./deviceLinking.js";
import { formatSpiritId } from "./spiritId.js";
import { get, put, listKeys } from "./db.js";

const ownDeviceListKey = (profileId) => `deviceList:${profileId}`;

/**
 * Section G1 (specs/reviews/spirit-evaluation-triage.md): fourth module
 * extracted out of app.js's initApp() closure, and the riskiest so far --
 * unlike settingsPanelUI.js/sidebarFoldersUI.js/groupsUI.js, this one
 * genuinely reads AND WRITES the app's central `state` object
 * (state.identityKeyPair/state.senderKey are assigned inside the joiner's
 * grant-application callback, not just read), so `state` is passed in by
 * REFERENCE (the same mutable object app.js holds, not a copy) rather than
 * destructured -- writes here are immediately visible to app.js and vice
 * versa, exactly matching the pre-extraction behavior.
 *
 * startInitiatorSession/startJoinerSession/currentRtcConfig/randomSenderKey
 * and the four render-/reset-prefixed helpers all stay in app.js and are passed in
 * -- they're either core WebRTC session machinery shared with the ordinary
 * 1:1 chat flow, or render OTHER cards (notifications/recovery/guest
 * actions) that are out of scope for this extraction. `router` is app.js's
 * own router instance. Everything else (crypto/protocol/db primitives) is
 * imported directly here since it's stateless.
 */
export function initDeviceLinkingUI({
  doc,
  el,
  t,
  state,
  withBusyButton,
  currentRtcConfig,
  randomSenderKey,
  startInitiatorSession,
  startJoinerSession,
  setDynamicText,
  resetOwnProofsState,
  renderGuestQuickActions,
  renderNotificationsCard,
  renderRecoveryCard,
  router
}) {
  async function snapshotContacts() {
    const keys = await listKeys("contacts");
    return Promise.all(keys.map(async (key) => ({ key, value: await get("contacts", key) })));
  }

  const setDeviceLinkStatus = (text) => {
    el("device-link-status").textContent = text;
  };

  withBusyButton(el("btn-link-device"), async () => {
    const passphrase = el("link-passphrase").value;
    if (!passphrase) {
      setDeviceLinkStatus(t("unlock.needPassphrase"));
      return;
    }
    if (!state.senderKey) {
      setDeviceLinkStatus(t("link.needProfile"));
      return;
    }
    // The active profile id is the identity fingerprint (= senderKey).
    const activeProfileId = state.senderKey;
    // Re-deriving the raw identity from the vault both unlocks the bytes to
    // hand over AND makes linking require passphrase confirmation.
    const identityRaw = await exportRawIdentity(activeProfileId, passphrase);
    el("link-passphrase").value = "";
    // Section B6: optional extra factor, checked before the SAS confirmation
    // is even shown -- empty means no PIN required.
    const configuredPin = el("link-pin").value.trim();

    const serverUrl = el("server-url").value;
    const rtcConfig = currentRtcConfig();
    const senderKey = randomSenderKey();

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey, {
      onPowStart: () => setDeviceLinkStatus(t("status.solvingPow"))
    });
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;
    setDeviceLinkStatus(t("link.shareRoom"));

    startInitiatorSession({
      senderKey,
      ecdhKeyPair,
      roomId,
      inviteToken,
      serverUrl,
      rtcConfig,
      channelOptions: {
        // Section B6 (specs/reviews/spirit-evaluation-triage.md): a
        // well-formed device-link-request used to get an automatic grant
        // (the raw identity private key) with zero human confirmation --
        // possession of the invite token alone was treated as sufficient
        // authorization. Now: an optional PIN gate, then a MANDATORY SAS
        // (deriveLinkVerificationCode) the human must visually compare
        // against the new device's screen and explicitly confirm before
        // createLinkGrant() is ever called.
        onDecryptedMessage: async (text) => {
          let message;
          try {
            message = JSON.parse(text);
          } catch {
            return; // not a linking message; nothing else is expected on this channel
          }
          if (!message || message.type !== "device-link-request") return;

          if (configuredPin && message.pin !== configuredPin) {
            setDeviceLinkStatus(t("link.pinMismatch"));
            return;
          }

          // Section B6 exec-review finding F2: capture the connection this
          // SAS code actually describes -- resetActiveConnection() clears the
          // block on any connection change, but this is a defense-in-depth
          // check against the click handler ever firing against a DIFFERENT
          // channel/sessionKey than the one whose code the human compared.
          const linkConnectionId = state.activeConnectionId;
          const linkChannel = state.channel;
          const linkSessionKey = state.sessionKey;

          const code = await deriveLinkVerificationCode(
            state.sessionEcdhWires.localEcdhWire,
            state.sessionEcdhWires.peerEcdhWire
          );
          el("link-verification-code").textContent = code;
          el("link-verification-block").hidden = false;

          el("btn-confirm-device-link").onclick = async () => {
            el("link-verification-block").hidden = true;
            if (state.activeConnectionId !== linkConnectionId) return; // stale -- session changed since this code was shown
            const contacts = await snapshotContacts();
            const grant = await createLinkGrant(identityRaw, message, { contacts });
            linkChannel.send(await encryptMessage(linkSessionKey, JSON.stringify(grant)));
            // Record the new device in the own signed device list (Section 13):
            // contacts receiving the updated list will accept the new device.
            const currentOwnList = (await get("profile", ownDeviceListKey(activeProfileId))) ?? null;
            const updatedOwnList = await appendDeviceToList(identityRaw, currentOwnList, grant.certificate);
            await put("profile", ownDeviceListKey(activeProfileId), updatedOwnList);
            setDeviceLinkStatus(t("link.done"));
          };
          el("btn-reject-device-link").onclick = () => {
            el("link-verification-block").hidden = true;
          };
        }
      }
    });
  });

  withBusyButton(el("btn-join-as-device"), async () => {
    const localPassphrase = el("device-local-passphrase").value;
    if (!localPassphrase) {
      setDeviceLinkStatus(t("device.needPassphrase"));
      return;
    }

    const devicePair = await generateDeviceKeyPair();
    const pin = el("device-link-pin").value.trim();

    // The request can only go out once BOTH the channel is open and the
    // session key is derived; those two complete in either order.
    let linkRequestSent = false;
    const maybeSendLinkRequest = async () => {
      if (linkRequestSent || !state.channel || !state.sessionKey) return;
      linkRequestSent = true;
      const request = pin ? await createLinkRequest(devicePair.publicKey, { pin }) : await createLinkRequest(devicePair.publicKey);
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(request)));
      setDeviceLinkStatus(t("device.waitingGrant"));
      // Section B6: show this device's own SAS code so the human can compare
      // it against the primary's screen before the primary confirms anything.
      const code = await deriveLinkVerificationCode(
        state.sessionEcdhWires.localEcdhWire,
        state.sessionEcdhWires.peerEcdhWire
      );
      el("device-verification-code").textContent = code;
      el("device-verification-block").hidden = false;
    };

    await startJoinerSession({
      senderKey: randomSenderKey(),
      roomId: el("room-id").value,
      inviteToken: el("invite-token").value,
      serverUrl: el("server-url").value,
      rtcConfig: currentRtcConfig(),
      onSessionReady: maybeSendLinkRequest,
      channelOptions: {
        afterChannelOpen: maybeSendLinkRequest,
        onDecryptedMessage: async (text) => {
          let message;
          try {
            message = JSON.parse(text);
          } catch {
            return;
          }
          if (!message || message.type !== "device-link-grant") return;

          const { identityKeyPair } = await applyLinkGrant(message, localPassphrase, {
            devicePublicKey: devicePair.publicKey
          });
          el("device-local-passphrase").value = "";
          state.identityKeyPair = identityKeyPair;
          state.senderKey = await fingerprint(identityKeyPair.publicKey);
          resetOwnProofsState();
          renderGuestQuickActions();
          renderNotificationsCard();
          renderRecoveryCard();
          setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
          setDeviceLinkStatus(t("device.done"));
          router.navigate("profile");
        }
      }
    });
  });
}
