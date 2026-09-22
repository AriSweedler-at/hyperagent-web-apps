// Evaluated by e2e/fixtures/peer-connections.ts (page.evaluate, as an expression): the selected
// candidate pair of every RTCPeerConnection e2e/browser/record-pc.js kept, as the candidate types
// of its two ends, read the way web/shared/edge/ice.ts describe() reads a stats report: the
// transport's selectedCandidatePairId first, else the nominated pair that succeeded. A connection
// without a selected pair (or whose getStats rejects) reports two nulls.
(async () => {
  const none = { local: null, remote: null };
  const pairOf = (stats) => {
    const all = [...stats.values()];
    const byId = new Map(all.map((stat) => [stat.id, stat]));
    const transport = all
      .filter((stat) => stat.type === 'transport' && byId.has(stat.selectedCandidatePairId))
      .at(-1);
    const pair =
      transport === undefined
        ? all.find(
            (stat) =>
              stat.type === 'candidate-pair' &&
              (stat.selected === true || stat.nominated === true) &&
              stat.state === 'succeeded',
          )
        : byId.get(transport.selectedCandidatePairId);
    const typeOf = (id) => byId.get(id)?.candidateType ?? null;
    return pair === undefined
      ? none
      : { local: typeOf(pair.localCandidateId), remote: typeOf(pair.remoteCandidateId) };
  };
  const connections = window.__peerConnections ?? [];
  return Promise.all(
    connections.map((connection) => connection.getStats().then(pairOf, () => none)),
  );
})();
