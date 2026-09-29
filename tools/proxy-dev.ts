// Local stand-in for games.sweedler.com (docs/ARCHITECTURE.md "Two origins"): a node http server
// that runs the real Cloudflare Worker handler from infra/games-proxy/worker.ts against a local
// upstream, so the Playwright project `proxy` exercises exactly the path mapping the live proxy
// applies. Only transport plumbing lives here (node request <-> fetch Request/Response); every
// routing decision is the Worker's. The island scoreboard's bindings (docs/ARCHITECTURE.md "The
// island scoreboard") are stubbed beside it: a Map-backed RPS_PAIRS, a throwaway signing key, and
// a stub APNs on its own port that takes every push and lists them at GET /pushes, so the `proxy`
// e2e can pair a fake clip and post moods without Apple.
//   node --experimental-strip-types tools/proxy-dev.ts --upstream http://127.0.0.1:4173 \
//     [--host 127.0.0.1] [--port 8787]
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { PairStore } from '../infra/games-proxy/rps-push.ts';
import worker, { type Env } from '../infra/games-proxy/worker.ts';

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
  env: Env,
  origin: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const request = await toFetchRequest(req, origin);
  const response = await worker.fetch(request, env);
  await writeFetchResponse(response, res, request.method === 'HEAD');
};

export type Running = Readonly<{ server: Server; url: string; close: () => Promise<void> }>;

/** Listen; `port: 0` picks a free port (tests). `url` has no trailing slash. */
const listen = (server: Server, host: string, port: number): Promise<Running> =>
  new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolveStarted({
        server,
        url: `http://${host}:${String(address.port)}`,
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

// ---- The island scoreboard's stubs ----------------------------------------------------------

type Row = Readonly<{ value: string; expiresAt: number | undefined }>;

/** A Map-backed RPS_PAIRS (rps-push.ts PairStore) whose rows expire against the wall clock, as KV's do. */
export const memoryPairStore = (): PairStore => {
  const rows = new Map<string, Row>();
  return {
    get: (key) => {
      const row = rows.get(key);
      if (row === undefined) return Promise.resolve(null);
      if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) {
        rows.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(row.value);
    },
    put: (key, value, options) => {
      const ttl = options?.expirationTtl;
      rows.set(key, { value, expiresAt: ttl === undefined ? undefined : Date.now() + ttl * 1_000 });
      return Promise.resolve();
    },
    delete: (key) => {
      rows.delete(key);
      return Promise.resolve();
    },
  };
};

/** A throwaway ES256 key in the .p8 PEM shape the Worker expects; the stub never checks a signature. */
export const devApnsKey = async (): Promise<string> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64',
  );
  const lines = der.match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
};

/** One push the stub took: the token from the path, the headers as sent, the raw JSON body. */
export type ApnsPush = Readonly<{
  token: string;
  headers: IncomingHttpHeaders;
  body: string;
  at: number;
}>;

const DEVICE_PATH = /^\/3\/device\/([0-9a-fA-F]+)$/;

/**
 * A stand-in for api.push.apple.com: every `POST /3/device/<token>` is a 200 and is remembered;
 * `GET /pushes` lists them (JSON, oldest first); anything else is Apple's 404 `{"reason": "BadPath"}`.
 */
export const startApnsStub = (host: string): Promise<Running> => {
  const pushes: ApnsPush[] = [];
  const server = createServer((req, res) => {
    const respond = (status: number, body: string): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/pushes') {
      respond(200, JSON.stringify(pushes));
      return;
    }
    const token = req.method === 'POST' ? DEVICE_PATH.exec(req.url ?? '')?.[1] : undefined;
    if (token === undefined) {
      respond(404, JSON.stringify({ reason: 'BadPath' }));
      return;
    }
    readBody(req).then(
      (buffer) => {
        const body = buffer.toString('utf8');
        pushes.push({ token, headers: req.headers, body, at: Date.now() });
        console.log(`apns-stub: push to …${token.slice(-6)} ${body}`);
        respond(200, '');
      },
      (error: unknown) => {
        console.error('apns-stub:', error);
        respond(500, JSON.stringify({ reason: 'InternalServerError' }));
      },
    );
  });
  return listen(server, host, 0);
};

export type RunningProxy = Running & Readonly<{ apns: string }>;

/**
 * Start the proxy with the island scoreboard's stubs behind it; `port: 0` picks a free port
 * (tests). `url` has no trailing slash; `apns` is the stub's origin. `close` stops both.
 */
export const startProxy = async (options: ProxyOptions): Promise<RunningProxy> => {
  const apns = await startApnsStub(options.host);
  const env: Env = {
    UPSTREAM: options.upstream,
    RPS_PAIRS: memoryPairStore(),
    APNS_HOST: apns.url,
    APNS_TEAM_ID: 'DEVTEAM000',
    APNS_KEY_ID: 'DEVKEY0000',
    APNS_AUTH_KEY: await devApnsKey(),
  };
  const server = createServer((req, res) => {
    const address = server.address() as AddressInfo;
    const origin = `http://${options.host}:${String(address.port)}`;
    handle(env, origin, req, res).catch((error: unknown) => {
      console.error('proxy-dev:', error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('upstream error');
    });
  });
  const proxy = await listen(server, options.host, options.port).catch(async (error: unknown) => {
    await apns.close();
    throw error;
  });
  return {
    ...proxy,
    apns: apns.url,
    close: async () => {
      await proxy.close();
      await apns.close();
    },
  };
};

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
    ({ url, apns }) => {
      console.log(`proxy-dev: ${url} -> ${options.upstream} (infra/games-proxy/worker.ts)`);
      console.log(
        `proxy-dev: /api/rps/* pushes go to the stub APNs at ${apns} (GET ${apns}/pushes)`,
      );
    },
    (error: unknown) => {
      console.error('proxy-dev failed to start:', error);
      process.exitCode = 1;
    },
  );
}
