// Local stand-in for games.sweedler.com (docs/ARCHITECTURE.md "Two origins"): a node http server
// that runs the real Cloudflare Worker handler from infra/games-proxy/worker.js against a local
// upstream, so the Playwright project `proxy` exercises exactly the path mapping the live proxy
// applies. Only transport plumbing lives here (node request <-> fetch Request/Response); every
// routing decision is the Worker's.
//   node --experimental-strip-types tools/proxy-dev.ts --upstream http://127.0.0.1:4173 \
//     [--host 127.0.0.1] [--port 8787]
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import worker from '../infra/games-proxy/worker.js';

export type ProxyOptions = Readonly<{ host: string; port: number; upstream: string }>;

/** Hop-by-hop and connection-level headers that belong to the browser<->proxy leg only. */
const NOT_FORWARDED: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolveBody(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });

const forwardedHeaders = (req: IncomingMessage): Headers =>
  Object.entries(req.headers).reduce((headers, [name, value]) => {
    if (NOT_FORWARDED.has(name) || value === undefined) return headers;
    (Array.isArray(value) ? value : [value]).forEach((v) => {
      headers.append(name, v);
    });
    return headers;
  }, new Headers());

/** The node request as the fetch Request the Worker sees, addressed to this proxy's origin. */
export const toFetchRequest = async (req: IncomingMessage, origin: string): Promise<Request> => {
  const method = req.method ?? 'GET';
  const headers = forwardedHeaders(req);
  if (method === 'GET' || method === 'HEAD')
    return new Request(new URL(req.url ?? '/', origin), { method, headers });
  const body = new Uint8Array(await readBody(req));
  return new Request(new URL(req.url ?? '/', origin), { method, headers, body });
};

const writeFetchResponse = async (
  response: Response,
  res: ServerResponse,
  headOnly: boolean,
): Promise<void> => {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(
    [...response.headers.entries()].filter(([name]) => !NOT_FORWARDED.has(name)),
  );
  res.writeHead(response.status, response.statusText, {
    ...headers,
    'content-length': String(body.byteLength),
  });
  res.end(headOnly ? undefined : body);
};

const handle = async (
  options: ProxyOptions,
  origin: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const request = await toFetchRequest(req, origin);
  const response = await worker.fetch(request, { UPSTREAM: options.upstream });
  await writeFetchResponse(response, res, request.method === 'HEAD');
};

export type Running = Readonly<{ server: Server; url: string; close: () => Promise<void> }>;

/** Start listening; `port: 0` picks a free port (tests). `url` has no trailing slash. */
export const startProxy = (options: ProxyOptions): Promise<Running> =>
  new Promise((resolveStarted, reject) => {
    const server = createServer((req, res) => {
      const address = server.address() as AddressInfo;
      const origin = `http://${options.host}:${String(address.port)}`;
      handle(options, origin, req, res).catch((error: unknown) => {
        console.error('proxy-dev:', error);
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('upstream error');
      });
    });
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address() as AddressInfo;
      resolveStarted({
        server,
        url: `http://${options.host}:${String(address.port)}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => {
              if (error) fail(error);
              else done();
            });
          }),
      });
    });
  });

export const parseProxyArgs = (argv: ReadonlyArray<string>): ProxyOptions => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8787' },
      upstream: { type: 'string' },
    },
    strict: true,
  });
  if (values.upstream === undefined)
    throw new Error('--upstream is required, e.g. --upstream http://127.0.0.1:4173');
  const upstream = new URL(values.upstream);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`--port must be 0..65535, got: ${values.port}`);
  return { host: values.host, port, upstream: upstream.origin };
};

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const options = parseProxyArgs(process.argv.slice(2));
  startProxy(options).then(
    ({ url }) => {
      console.log(`proxy-dev: ${url} -> ${options.upstream} (infra/games-proxy/worker.js)`);
    },
    (error: unknown) => {
      console.error('proxy-dev failed to start:', error);
      process.exitCode = 1;
    },
  );
}
