// Per-page collectors for the two smoke invariants every spec inherits: zero uncaught exceptions
// and zero failed requests (network failures and HTTP 4xx/5xx) outside an allowlist.
import type { Page } from '@playwright/test';

export type Watched = Readonly<{
  errors: () => ReadonlyArray<string>;
  failures: () => ReadonlyArray<string>;
  /** URL and status of every response seen, for "was shared/ice.js loaded" checks. */
  responses: () => ReadonlyArray<Readonly<{ url: string; status: number }>>;
}>;

export const watchPage = (page: Page, allow: ReadonlyArray<RegExp>): Watched => {
  const errors: string[] = [];
  const failures: string[] = [];
  const responses: { url: string; status: number }[] = [];
  const allowed = (url: string): boolean => allow.some((pattern) => pattern.test(url));
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    if (!allowed(request.url()))
      failures.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    responses.push({ url: response.url(), status: response.status() });
    if (response.status() >= 400 && !allowed(response.url()))
      failures.push(`${response.url()} HTTP ${String(response.status())}`);
  });
  return { errors: () => errors, failures: () => failures, responses: () => responses };
};
