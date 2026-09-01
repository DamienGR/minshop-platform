/**
 * The `cloudflare:workers` module, for integration scripts running in Node.
 *
 * Unit tests get test/helpers/cloudflare-workers-stub.ts, whose `env` is empty
 * on purpose: a pure module reading a deployment var should fall back to its
 * declared default. This one is the opposite case. The settlement orchestrator
 * (`features/orders/recordWebhook.ts`) reaches for `env.DB` at call time, and
 * so does everything it delegates to — the payment factory, the email factory,
 * the refund notifier. Rewriting that chain to take a `db` parameter would be a
 * change to production code made for the benefit of a test, across the one path
 * where a mistake costs a customer's money.
 *
 * So the binding is injected instead: `setWorkersEnv({ DB })` fills THIS
 * object, and test/helpers/workers-loader.mjs makes every `cloudflare:workers`
 * import resolve here. The code under test is byte-for-byte the deployed code.
 *
 * `cache.purge` answers success rather than throwing. The stock purger already
 * swallows its own failures, so a throwing stub would prove nothing and print a
 * page of noise per settlement.
 */
export const env = {};

export const cache = {
  async purge() {
    return { success: true };
  },
};

/** Install bindings for the run. Merges, so a suite can add one late. */
export function setWorkersEnv(bindings) {
  Object.assign(env, bindings);
  return env;
}
