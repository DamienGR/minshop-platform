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
# Eight attempts, and the number is measured rather than chosen.
#
# Thirty probe runs of this wrapper (three sweeps of ten, see the flake probe
# workflow) put the numbers at: 20% of runs meet the fault at all, and among
# those, the attempts are NOT independent — a runner that killed one session
# tends to kill the next. Recoveries landed on attempt 2, 3 and 3; three runs
# were still dying at attempt 3. So the naive p^n arithmetic is wrong, and three
# attempts left one run in ten failing, which is no better than a coin flip for
# a ten-green criterion.
#
# What the same data does show is a per-attempt recovery rate around 0.3 among
# affected runs, which is the model this number comes from: eight attempts put
# the residual near 2%, so five ten-run streaks in six survive. Beyond that the
# curve flattens and the job clock starts to matter — each attempt costs about
# 50 seconds, and only affected runs pay it.
#
# The honest fix is upstream: cloudflare/workers-sdk#15317. This buys a usable
# gate until it lands.
set -uo pipefail

suite="$(dirname "$0")/d1-integration.sh"
WORKER_DIED_EXIT=75
ATTEMPTS=8

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
