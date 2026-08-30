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
# Four attempts, and the number is measured rather than chosen.
#
# Fifty probe runs of this wrapper (see the flake probe workflow) say the same
# thing twice: about 20% of runs meet the fault, and the attempts within a run
# are NOT independent. A runner splits into two kinds. One recovers, and always
# early — every recovery observed landed on attempt 2, 3 or 4. The other dies on
# every attempt; raising the ceiling from three to eight bought nothing there,
# one run in the sweep died all eight times.
#
# So four attempts covers everything an in-place re-run can cover, at a cost of
# at most three extra sessions of about 50 seconds, paid only by affected runs.
# The runners that never recover are not this script's problem to solve: CI runs
# the suite again on a second runner, which is a fresh draw. See
# .github/workflows/verify.yml.
#
# The honest fix is upstream: cloudflare/workers-sdk#15317. This buys a usable
# gate until it lands.
set -uo pipefail

suite="$(dirname "$0")/d1-integration.sh"
WORKER_DIED_EXIT=75
ATTEMPTS=4

for attempt in $(seq 1 "$ATTEMPTS"); do
  if (( attempt > 1 )); then
    echo >&2
    echo "▸ Re-running the D1 integration gate (attempt $attempt of $ATTEMPTS): the dev" >&2
    echo "  session died, it did not fail an assertion." >&2
    echo >&2
  fi

  bash "$suite" "$@"
  status=$?
  [[ "$status" == "$WORKER_DIED_EXIT" ]] || exit "$status"
done

echo "D1 integration failed: wrangler dev died on all $ATTEMPTS runs." >&2
exit 1
