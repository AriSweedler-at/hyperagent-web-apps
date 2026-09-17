// Bounded waits for the two network steps WebRTC needs (docs/ARCHITECTURE.md "Testing pyramid"):
// a Peer registering on the broker, and a data channel opening between two contexts. Everything
// else in the specs is a locator or expect.poll with the default expect timeout.
export const BROKER_TIMEOUT = 20_000;
export const WEBRTC_TIMEOUT = 30_000;
