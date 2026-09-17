// The room-code literals in web/shared/lib/roomCode.ts are read back out of the legacy pages here
// (docs/MIGRATION.md step 5: "roomCode constants equal the legacy literals"). Each assertion greps
// the exact source line, so a page edit that changed an alphabet, a length, a prefix or a join
// error would fail this suite before the TypeScript port could drift from it.
import { describe, expect, test } from 'vitest';

import { readRepoFile } from '../../tools/legacy/extract.ts';
import { ROOM_CODE } from '../../web/shared/lib/roomCode.ts';

const gin = readRepoFile('legacy/gin-rummy/index.html');
const fidice = readRepoFile('legacy/fidice/index.html');

/** The single capture of `pattern` in `page`; fails loudly if the line is missing or ambiguous. */
const capture = (page: string, pattern: RegExp): string => {
  const matches = [...page.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  expect(matches, `exactly one match for ${String(pattern)}`).toHaveLength(1);
  const value = matches[0]?.[1];
  if (value === undefined) throw new Error(`no capture group in ${String(pattern)}`);
  return value;
};

describe('gin (legacy/gin-rummy/index.html)', () => {
  const spec = ROOM_CODE['gin-rummy'];

  test('PEER_PREFIX', () => {
    expect(capture(gin, /const PEER_PREFIX = '([^']*)';/)).toBe(spec.peerPrefix);
  });

  test('CODE_ALPHABET', () => {
    expect(capture(gin, /const CODE_ALPHABET = '([^']*)';/)).toBe(spec.alphabet);
  });

  test('genCode draws 4 characters', () => {
    expect(Number(capture(gin, /function genCode\(\) \{[^}]*i < (\d+); i\+\+/))).toBe(spec.length);
  });

  test('the join button checks the length and says so', () => {
    expect(Number(capture(gin, /if \(code\.length !== (\d+)\) \{ toast\(/))).toBe(spec.length);
    expect(capture(gin, /if \(code\.length !== \d+\) \{ toast\('([^']*)'\)/)).toBe(
      spec.lengthError,
    );
  });

  test('the input handler keeps upper-case letters, at most 4', () => {
    expect(capture(gin, /toUpperCase\(\)\.replace\(\/\[\^A-Z\]\/g, ''\)\.slice\(0, (\d+)\)/)).toBe(
      String(spec.length),
    );
  });

  test('the host id is PEER_PREFIX + code, upper case as shown', () => {
    expect(gin).toContain('new Peer(PEER_PREFIX + app.code, peerOptsFor(ice))');
    expect(gin).toContain('peer.connect(PEER_PREFIX + code, { reliable: true })');
    expect(spec.peerCase).toBe('upper');
  });
});

describe('fidice (legacy/fidice/index.html)', () => {
  const spec = ROOM_CODE.fidice;

  test('peerIdFor lower-cases the code after the prefix', () => {
    expect(
      capture(fidice, /var peerIdFor = \(code\) => `([^`]*)\$\{code\.toLowerCase\(\)\}`;/),
    ).toBe(spec.peerPrefix);
    expect(spec.peerCase).toBe('lower');
  });

  test('CODE_ALPHABET', () => {
    expect(capture(fidice, /var CODE_ALPHABET = "([^"]*)";/)).toBe(spec.alphabet);
  });

  test('randomCode draws 5 characters', () => {
    expect(Number(capture(fidice, /randomCode: \(\) => Array\.from\(\{ length: (\d+) \}/))).toBe(
      spec.length,
    );
  });

  test('the join form checks the length and says so', () => {
    expect(
      Number(capture(fidice, /if \(code\.length !== (\d+)\) \{\n\s*this\.set\(\{ error:/)),
    ).toBe(spec.length);
    expect(
      capture(
        fidice,
        /this\.set\(\{ error: "([^"]*)" \}\);\n\s*return;\n\s*\}\n\s*this\.set\(\{ joinCode: code/,
      ),
    ).toBe(spec.lengthError);
  });
});
