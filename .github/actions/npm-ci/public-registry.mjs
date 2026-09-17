// Rewrite every "resolved" tarball URL in a lockfile to the public npm registry, keeping the
// standard `<name>/-/<file>.tgz` tail. Used ONLY on CI runners against their checked-out copy; the
// committed lockfile is never changed (see action.yml). Prints what it did so the CI log shows it.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const PUBLIC = 'https://registry.npmjs.org/';
// Any host and path prefix, up to the package tail: "@scope/name/-/file.tgz" or "name/-/file.tgz".
const RESOLVED = /"resolved": "https?:\/\/[^"]*?\/((?:@[^/"]+\/)?[^/"]+\/-\/[^"]+\.tgz)"/g;

const path = process.argv[2] ?? 'package-lock.json';
const before = readFileSync(path, 'utf8');
const hosts = [
  ...new Set([...before.matchAll(/"resolved": "(https?:\/\/[^/"]+\/)/g)].map((m) => m[1])),
];
const after = before.replace(RESOLVED, (_m, tail) => `"resolved": "${PUBLIC}${tail}"`);
JSON.parse(after);
writeFileSync(path, after);
const rewritten = [...before.matchAll(RESOLVED)].length;
console.log(
  `${path}: ${rewritten} resolved URLs now on ${PUBLIC} (hosts seen: ${hosts.join(', ')})`,
);
