// The shared peer plumbing under its gin name (design.md §5.3 peerjs.ts): eslint's EDGES glob and
// the sessions beside it name `net/peerjs.ts`, and the body lives in web/shared/edge/peer.ts since
// it serves every game (P1, landed in #51).
export * from '../../../../shared/edge/peer.ts';
