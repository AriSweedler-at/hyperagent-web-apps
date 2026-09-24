// Page-side script installed by Playwright (context.addInitScript). Keeps every WebSocket the page
// opens in window.__sockets so a spec can close the PeerJS broker socket from outside, the way a
// blink of the connection service would, while the WebRTC data channel underneath stays up
// (e2e/shell-liveness.spec.ts: a guest's reconnect must not open a second channel beside a live
// one). The subclass keeps the prototype and `instanceof` intact.
(() => {
  const sockets = [];
  window.__sockets = sockets;
  const Real = window.WebSocket;
  window.WebSocket = class WebSocket extends Real {
    constructor(...args) {
      super(...args);
      sockets.push(this);
    }
  };
})();
