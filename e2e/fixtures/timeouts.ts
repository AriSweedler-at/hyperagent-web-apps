// Bounded waits for the two network steps WebRTC needs (docs/ARCHITECTURE.md "Testing pyramid"):
// a Peer registering on the broker, and a data channel opening between two contexts. Everything
// else in the specs is a locator or expect.poll with the default expect timeout.
import { HB_GRACE_MS, HB_MS } from '../../web/shared/net/liveness.ts';

export const BROKER_TIMEOUT = 20_000;
export const WEBRTC_TIMEOUT = 30_000;
/**
 * A peer that died without closing its channel is reported gone by the sessions' silence watch
 * (web/shared/net/liveness.ts): at most the grace after the last frame heard, which was at most
 * one heartbeat period before the death, plus slack for the wire and the paint.
 */
export const LIVENESS_TIMEOUT = HB_GRACE_MS + HB_MS + 5000;
