// Page-side script installed by Playwright (context.addInitScript). Records every `new Peer(...)`
// the page makes in window.__peerCalls (arguments as JSON clones) so a spec can assert that the
// ?peer= broker override and the ?ice= configuration reached PeerJS. The PeerJS bundle assigns
// window.Peer when it loads (after this script), so the recorder is an accessor property that
// wraps whatever gets assigned; until then `typeof Peer` stays 'undefined', as the pages expect.
(() => {
  const calls = [];
  window.__peerCalls = calls;
  let real;
  const clone = (value) =>
    typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value;
  function Peer(...args) {
    calls.push(args.map(clone));
    return new real(...args);
  }
  Object.defineProperty(window, 'Peer', {
    configurable: true,
    enumerable: true,
    get: () => (real === undefined ? undefined : Peer),
    set: (value) => {
      real = value;
      Peer.prototype = value.prototype;
      Object.setPrototypeOf(Peer, value);
    },
  });
})();
