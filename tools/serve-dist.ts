// Static server for the browser harness (docs/ARCHITECTURE.md "Two origins"): mounts a directory
// at a base path so local URLs match GitHub Pages (`/hyperagent-web-apps/games/fidice/` on :4173).
// The directory is dist/ (the output of `npm run build`), so the harness exercises exactly what
// Pages serves. An alias publishes one file from anywhere on disk under a path inside the mount
// (the e2e ICE fixture); alias targets are resolved against the working directory, not the root.
//   node --experimental-strip-types tools/serve-dist.ts --base /hyperagent-web-apps/ \
//     --alias e2e-ice.json=e2e/fixtures/e2e-ice.json [--root dist] [--host 127.0.0.1] [--port 4173]
// Like GitHub Pages, a directory URL without its trailing slash redirects to it, and every response
// carries `Access-Control-Allow-Origin: *` so the proxy origin can fetch the ICE fixture.
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type ServeOptions = Readonly<{
  /** Absolute path of the directory to mount. */
  root: string;
  /** URL path prefix with leading and trailing slash, e.g. `/hyperagent-web-apps/`. */
  base: string;
  host: string;
  port: number;
  /** Path under `base` -> absolute file path; an alias target may live outside `root`. */
  aliases: Readonly<Record<string, string>>;
}>;

export type Route =
  | Readonly<{ kind: 'redirect'; location: string }>
  | Readonly<{ kind: 'path'; relPath: string; trailingSlash: boolean }>
  | Readonly<{ kind: 'alias'; path: string }>
  | Readonly<{ kind: 'notFound' }>;

export type Served =
  | Readonly<{ kind: 'redirect'; location: string }>
  | Readonly<{ kind: 'file'; path: string }>
  | Readonly<{ kind: 'notFound' }>;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const contentTypeFor = (path: string): string =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const decodePath = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
};

/** A path segment that could escape the root, or a NUL byte, is refused outright. */
const isUnsafe = (relPath: string): boolean =>
  relPath.includes('\0') || relPath.split('/').some((segment) => segment === '..');

/** Pure: what a request pathname means under `base`, before touching the file system. */
export const routeFor = (
  pathname: string,
  base: string,
  aliases: Readonly<Record<string, string>>,
): Route => {
  const decoded = decodePath(pathname);
  if (decoded === null) return { kind: 'notFound' };
  if (decoded === base.slice(0, -1)) return { kind: 'redirect', location: base };
  if (!decoded.startsWith(base)) return { kind: 'notFound' };
  const rel = decoded.slice(base.length);
  if (isUnsafe(rel)) return { kind: 'notFound' };
  const alias = aliases[rel];
  if (alias !== undefined) return { kind: 'alias', path: alias };
  return {
    kind: 'path',
    relPath: rel === '' ? '.' : rel,
    trailingSlash: rel === '' || rel.endsWith('/'),
  };
};

const fileOrNothing = async (path: string): Promise<'file' | 'dir' | 'missing'> => {
  try {
    const s = await stat(path);
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'missing';
  } catch {
    return 'missing';
  }
};

/** Resolve a route against the mounted directory: the file to send, a slash redirect, or nothing. */
export const serveFor = async (
  options: ServeOptions,
  pathname: string,
  route: Route,
): Promise<Served> => {
  if (route.kind === 'redirect' || route.kind === 'notFound') return route;
  if (route.kind === 'alias')
    return (await fileOrNothing(route.path)) === 'file'
      ? { kind: 'file', path: route.path }
      : { kind: 'notFound' };
  const abs = resolve(options.root, route.relPath);
  if (abs !== options.root && !abs.startsWith(options.root + sep)) return { kind: 'notFound' };
  const found = await fileOrNothing(abs);
  if (found === 'file') return { kind: 'file', path: abs };
  if (found === 'missing') return { kind: 'notFound' };
  if (!route.trailingSlash) return { kind: 'redirect', location: `${pathname}/` };
  const index = resolve(abs, 'index.html');
  return (await fileOrNothing(index)) === 'file'
    ? { kind: 'file', path: index }
    : { kind: 'notFound' };
};

const send = (
  res: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body?: Buffer,
): void => {
  res.writeHead(status, { ...COMMON_HEADERS, ...headers });
  res.end(body);
};

const handle = async (
  options: ServeOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    send(
      res,
      405,
      { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
      Buffer.from('method not allowed'),
    );
    return;
  }
  const url = new URL(req.url ?? '/', 'http://serve-dist.invalid');
  const served = await serveFor(
    options,
    url.pathname,
    routeFor(url.pathname, options.base, options.aliases),
  );
  if (served.kind === 'redirect') {
    send(res, 301, { Location: served.location + url.search }, Buffer.alloc(0));
    return;
  }
  if (served.kind === 'notFound') {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('not found'));
    return;
  }
  const body = await readFile(served.path);
  res.writeHead(200, {
    ...COMMON_HEADERS,
    'Content-Type': contentTypeFor(served.path),
    'Content-Length': String(body.byteLength),
  });
  res.end(method === 'HEAD' ? undefined : body);
};

export type Running = Readonly<{ server: Server; url: string; close: () => Promise<void> }>;

/** Start listening; `port: 0` picks a free port (tests). `url` has no trailing slash. */
export const startServer = (options: ServeOptions): Promise<Running> =>
  new Promise((resolveStarted, reject) => {
    const server = createServer((req, res) => {
      handle(options, req, res).catch((error: unknown) => {
        console.error('serve-dist:', error);
        if (!res.headersSent)
          send(
            res,
            500,
            { 'Content-Type': 'text/plain; charset=utf-8' },
            Buffer.from('server error'),
          );
        else res.end();
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

const parseAlias = (entry: string): readonly [string, string] => {
  const at = entry.indexOf('=');
  if (at <= 0 || at === entry.length - 1)
    throw new Error(`--alias expects path=file, got: ${entry}`);
  return [entry.slice(0, at), entry.slice(at + 1)];
};

const normaliseBase = (base: string): string => {
  const withLeading = base.startsWith('/') ? base : `/${base}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
};

export const parseServeArgs = (argv: ReadonlyArray<string>): ServeOptions => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      root: { type: 'string', default: 'dist' },
      base: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '4173' },
      alias: { type: 'string', multiple: true, default: [] },
    },
    strict: true,
  });
  if (values.base === undefined)
    throw new Error('--base is required, e.g. --base /hyperagent-web-apps/');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`--port must be 0..65535, got: ${values.port}`);
  return {
    root: resolve(values.root),
    base: normaliseBase(values.base),
    host: values.host,
    port,
    aliases: Object.fromEntries(
      values.alias.map(parseAlias).map(([path, file]) => [path, resolve(file)]),
    ),
  };
};

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const options = parseServeArgs(process.argv.slice(2));
  // A missing tree would serve 404 on every URL, and Playwright's health check would wait out its
  // whole webServer timeout without saying why; exiting here surfaces the cause at once.
  if (!existsSync(resolve(options.root, 'index.html'))) {
    console.error(
      `serve-dist: ${options.root} has no index.html; run \`npm run build\` (dist/) or \`npm run build:next\` (dist-next/) first`,
    );
    process.exit(1);
  }
  startServer(options).then(
    ({ url }) => {
      console.log(`serve-dist: ${url}${options.base} -> ${options.root}`);
    },
    (error: unknown) => {
      console.error('serve-dist failed to start:', error);
      process.exitCode = 1;
    },
  );
}
