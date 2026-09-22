// Reads back what e2e/browser/record-pc.js captured: every RTCPeerConnection the page built, as
// the selected candidate pair of each (the candidate types of its two ends), read off the real
// connection's getStats() by e2e/browser/selected-pairs.js. The pages expose no PeerConnection
// (the transport keeps it behind `peerConnection()`), so the recorder is the one way a spec can see
// which path a data channel took, beyond the "Connected via relay" toast the page writes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

export const RECORD_PC_SCRIPT = resolve(import.meta.dirname, '..', 'browser', 'record-pc.js');
const SELECTED_PAIRS_SCRIPT = readFileSync(
  resolve(import.meta.dirname, '..', 'browser', 'selected-pairs.js'),
  'utf8',
);

/** The candidate types (`host`, `srflx`, `prflx`, `relay`) at the two ends of a selected pair; nulls when none is selected. */
export type CandidatePair = Readonly<{ local: string | null; remote: string | null }>;

const typeOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const decodePair = (value: unknown): CandidatePair => {
  if (typeof value !== 'object' || value === null)
    throw new Error(`selected-pairs.js returned a non-object: ${JSON.stringify(value)}`);
  const record = value as Readonly<Record<string, unknown>>;
  return { local: typeOrNull(record['local']), remote: typeOrNull(record['remote']) };
};

/** One entry per RTCPeerConnection the page has built so far, in construction order. */
export const selectedPairs = async (page: Page): Promise<ReadonlyArray<CandidatePair>> => {
  const raw = await page.evaluate<unknown>(SELECTED_PAIRS_SCRIPT);
  if (!Array.isArray(raw))
    throw new Error('window.__peerConnections is missing: was record-pc.js installed?');
  return raw.map(decodePair);
};
