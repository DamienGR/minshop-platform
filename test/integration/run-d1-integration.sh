#!/usr/bin/env bash
#
# Runs the D1 integration gate, and re-runs it once — only once, and only when
# the suite reports that `wrangler dev` itself died under it (exit 75).
#
# Everything else passes straight through. A failed assertion exits 1 and is
# never re-run: retrying a real regression is how a gate stops being a gate.
#
# Why re-run the whole suite instead of the request. When the dev session is
# torn down there is nothing left to retry against — the port is closed for
# every later request, so a fresh session is the only way back. The in-suite
# retry in assert_cache_control still covers the case where miniflare drops one
# connection and stays up; this covers the case where it doesn't.
#
# The underlying fault is cloudflare/workers-sdk#15317: under contention the dev
# proxy loses a connection mid-response, wrangler raises it as a fatal
# "Error inside ProxyWorker" with an empty message, and the session dies. Remove
# this wrapper once that is fixed upstream.
set -uo pipefail

suite="$(dirname "$0")/d1-integration.sh"
WORKER_DIED_EXIT=75

bash "$suite" "$@"
status=$?
[[ "$status" == "$WORKER_DIED_EXIT" ]] || exit "$status"

echo >&2
echo "▸ Re-running the D1 integration gate once: the dev session died, it did not" >&2
echo "  fail an assertion. A second death fails the job." >&2
echo >&2

bash "$suite" "$@"
status=$?
if [[ "$status" == "$WORKER_DIED_EXIT" ]]; then
  echo "D1 integration failed: wrangler dev died on both runs." >&2
  exit 1
fi
exit "$status"
