// Reads back what e2e/browser/record-peer.js captured: the arguments of every `new Peer(...)`.
// Gin passes (id, options) for the host and (options) for the guest; Fidice passes (id, options)
// with an undefined id for the guest. The options object is always the last argument.
import type { Page } from '@playwright/test';

export type PeerCall = Readonly<{ id: string | null; options: Readonly<Record<string, unknown>> }>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeCall = (call: unknown): PeerCall => {
  if (!Array.isArray(call))
    throw new Error(`window.__peerCalls entry is not an argument list: ${JSON.stringify(call)}`);
  const args: ReadonlyArray<unknown> = call;
  const first = args[0];
  const last = args.at(-1);
  return { id: typeof first === 'string' ? first : null, options: isRecord(last) ? last : {} };
};

export const readPeerCalls = async (page: Page): Promise<ReadonlyArray<PeerCall>> => {
  const raw = await page.evaluate<unknown>('window.__peerCalls');
  if (!Array.isArray(raw))
    throw new Error('window.__peerCalls is missing: was record-peer.js installed?');
  return raw.map(decodeCall);
};
