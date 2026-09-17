#!/bin/sh
# Verify the git hook chain described in docs/ARCHITECTURE.md "Git hooks":
#   1. core.hooksPath points at .githooks (set by `npm run hooks`, which is also the `prepare`
#      script, so `npm ci` installs it);
#   2. both shims are executable and parse (`sh -n`);
#   3. the owner's template hook .git/hooks/pre-commit exists, so the pre-commit shim has
#      something to chain to. CI checkouts have no template hook, so under CI=… that is reported
#      rather than failed.
# Exits non-zero on the first failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

fail() {
  echo "hooks:verify: $1" >&2
  exit 1
}

path="$(git config --get core.hooksPath || true)"
[ "$path" = ".githooks" ] || fail "core.hooksPath is '${path:-unset}', expected '.githooks'; run: npm run hooks"

for hook in .githooks/pre-commit .githooks/pre-push; do
  [ -x "$hook" ] || fail "$hook is missing or not executable"
  sh -n "$hook" || fail "$hook does not parse"
done

template="$(git rev-parse --git-dir)/hooks/pre-commit"
if [ -x "$template" ]; then
  echo "hooks:verify: ok (core.hooksPath=.githooks; pre-commit chains to $template)"
elif [ -n "${CI:-}" ]; then
  echo "hooks:verify: ok (core.hooksPath=.githooks; no template hook in CI, as expected)"
else
  fail "template hook $template is missing; the pre-commit shim would have nothing to chain to"
fi
