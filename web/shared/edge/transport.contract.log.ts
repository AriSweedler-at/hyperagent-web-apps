// The log `runContract` (transport.contract.ts) must produce over any Transport. Kept in a module
// of its own, with no imports, so the node-side integration test can pin it without pulling the
// PeerJS-typed adapter into the node project.
export const EXPECTED_CONTRACT_LOG: ReadonlyArray<string> = [
  'host:open',
  'guest:open',
  'connected',
  'peers:ok',
  'host:got ping 1',
  'host:got ping 2',
  'guest:got pong 2',
  'isolated',
  'host:closed',
  'guest:closed',
  'destroyed',
];
