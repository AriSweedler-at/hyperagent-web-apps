// Page-side script installed by Playwright (context.addInitScript). Keeps every RTCPeerConnection
// the page constructs in window.__peerConnections so a spec can read getStats() off the real
// connection (e2e/browser/selected-pairs.js): the pages expose no PeerConnection themselves, and
// PeerJS builds one per DataConnection. The subclass keeps the prototype and `instanceof` intact.
(() => {
  const connections = [];
  window.__peerConnections = connections;
  const Real = window.RTCPeerConnection;
  window.RTCPeerConnection = class RTCPeerConnection extends Real {
    constructor(...args) {
      super(...args);
      connections.push(this);
    }
  };
})();
