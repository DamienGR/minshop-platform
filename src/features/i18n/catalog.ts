/**
 * The shape a locale catalog has to satisfy.
 *
 * Deliberately loose HERE and tightened in `index.ts`: `messages.ts` declares
 * `satisfies Catalog` to get its values checked as strings while keeping the
 * literal key set, and `MessageKey` is then read back off that literal. Writing
 * `Record<MessageKey, string>` in `messages.ts` would make the reference
 * catalog depend on a type derived from itself.
 *
 * A SECOND locale is the case this exists for. It annotates rather than
 * satisfies — `const en: LocaleCatalog = { … }` — and the compiler then reports
 * every key it forgot and every key it invented.
 */
export type Catalog = Record<string, string>;
