// Result for the fidice domain (docs/MIGRATION.md step 8): the shared Result<T, E> from
// web/shared/lib, re-exported under the names the legacy bundle used (legacy/fidice/index.html
// lines 551-556, bundle section "// src/domain/result.ts") so no caller changes. The `@shared/*`
// alias the architecture names is not configured for the build, the tests or the import-x
// resolver yet, so the import is relative (docs/MIGRATION.md "Deviations", step 8).
import { err, ok, type Result } from '../../../../shared/lib/result.ts';

/**
 * Unwrap an Ok or throw. The host session (net/host) uses it where an Err is a programming error
 * (seating the host, autostart), not a rule violation a player could see, so it is the one
 * throwing path the domain keeps: the pure profile bans `throw`, and the exception is recorded in
 * docs/MIGRATION.md "Deviations" (step 8).
 */
const expect = <T, E>(r: Result<T, E>, context = 'result'): T => {
  if (r.ok) return r.value;
  // eslint-disable-next-line functional/no-throw-statements -- legacy unwrap for the host's impossible-Err paths (see above)
  throw new Error(`${context}: ${String(r.error)}`);
};

export { ok, err, expect };
export type { Result };
