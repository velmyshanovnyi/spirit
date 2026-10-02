// Section C4 (specs/phase5/core-dispatch.md, backlog A4): the five
// per-contact announcement handlers -- device list, proof set, push
// subscription, recovery share (all gated on a verified peer + a vault to
// persist into) and the gate-less safety-display-mode -- extracted verbatim
// out of app.js's initApp() closure. `state` is the same mutable object
// app.js holds; renderSafetyHint is an app.js closure (it owns the hint DOM).
import { getContact, updateContactDeviceList, updateContactProofSet, updateContactPushSubscription } from "./contacts.js";
import { acceptNewerDeviceList } from "./deviceLinking.js";
import { acceptNewerProofSet } from "./proofSet.js";
import { parsePushSubscriptionAnnounce } from "./pushSubscription.js";
import { parseRecoveryShareAnnounce } from "./recoveryShare.js";
import { saveTrustedShare } from "./trustedShares.js";

export function initPeerAnnouncements({ state, renderSafetyHint }) {
  async function onDeviceListAnnounce(control) {
    // Meaningless before the peer proved its identity (nothing to verify
    // the list against), and pointless in ephemeral mode (nothing persists).
    if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    const contact = await getContact(state.peerFingerprint);
    const heldList = contact ? contact.deviceList : null;
    const accepted = await acceptNewerDeviceList(state.peerIdentityPublicKey, heldList, control.list);
    if (accepted !== heldList) {
      await updateContactDeviceList(state.peerFingerprint, accepted);
    }
    return;
  }

  async function onSafetyDisplayMode(control) {
    // Section RF10: applies the PEER's chosen display mode to this side
    // too, so both ends look at the same kind of value at the same
    // time -- no identity gate needed, this is a display preference,
    // not a trust decision.
    state.safetyDisplayMode = control.mode === "shared" ? "shared" : "peer";
    renderSafetyHint();
    return;
  }

  async function onProofSetAnnounce(control) {
    // Same gate as device-list-announce: meaningless before identity is
    // verified, pointless in ephemeral mode (nothing persists).
    if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    const contact = await getContact(state.peerFingerprint);
    const heldSet = contact ? contact.proofSet : null;
    const accepted = await acceptNewerProofSet(state.peerIdentityPublicKey, heldSet, control.set);
    if (accepted !== heldSet) {
      await updateContactProofSet(state.peerFingerprint, accepted);
    }
    return;
  }

  async function onPushSubscriptionAnnounce(control) {
    // Same gate as device-list-announce/proof-set-announce: meaningless
    // before identity is verified, pointless in ephemeral mode (nothing
    // persists, and ephemeral "spirits" have nowhere to store a subscription).
    if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    const parsed = parsePushSubscriptionAnnounce(control);
    if (!parsed) return;
    await updateContactPushSubscription(state.peerFingerprint, parsed);
    return;
  }

  async function onRecoveryShareAnnounce(control) {
    // Section S2 (specs/phase5/social-recovery.md): same trust gate as
    // device-list-announce/push-subscription-announce -- meaningless
    // before the peer's identity is verified (nothing to attribute the
    // share to), and pointless in ephemeral mode (nothing persists).
    if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    const parsed = parseRecoveryShareAnnounce(control);
    if (!parsed) return;
    await saveTrustedShare({ ownerFingerprint: state.peerFingerprint, ...parsed, receivedAt: Date.now() });
    return;
  }

  const announcementHandlers = {
    "device-list-announce": onDeviceListAnnounce,
    "proof-set-announce": onProofSetAnnounce,
    "push-subscription-announce": onPushSubscriptionAnnounce,
    "recovery-share-announce": onRecoveryShareAnnounce,
    "safety-display-mode": onSafetyDisplayMode
  };
  return { announcementHandlers };
}
