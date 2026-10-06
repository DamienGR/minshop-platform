import { describe, expect, it } from 'vitest';

import { checkedPaths, formatProblems } from '../../scripts/check-format.mjs';

/**
 * The formatting floor: the four rules a merge cares about and a review cannot
 * see. Each one fires on its own, and none fires on what it should leave alone.
 */
describe('the formatting floor', () => {
  const rules = (path, text) => formatProblems(path, text).map((problem) => problem.rule);

  it('passes a clean file', () => {
    expect(rules('src/a.ts', 'const a = 1;\n  return a;\n')).toEqual([]);
  });

  it('names each rule, with its line', () => {
    expect(formatProblems('src/a.ts', 'a\r\nb\n')).toContainEqual({ line: 1, rule: 'fin de ligne CRLF' });
    expect(rules('src/a.ts', 'a\nb')).toEqual(['pas de saut de ligne final']);
    expect(formatProblems('docs/a.md', 'titre \nsuite\n')).toEqual([{ line: 1, rule: 'espaces en fin de ligne' }]);
    expect(formatProblems('src/a.ts', 'x\n\tindent\n')).toEqual([{ line: 2, rule: 'indentation par tabulation' }]);
  });

  // A tab inside a Markdown code sample or a TSV fixture is content, not layout.
  it('only judges indentation in code', () => {
    expect(rules('docs/a.md', '\tcode\n')).toEqual([]);
  });

  it('leaves an empty file alone', () => {
    expect(rules('src/empty.ts', '')).toEqual([]);
  });

  it('checks the core and only the core', () => {
    expect(checkedPaths(['src/a.ts', 'imports/catalog.csv', 'wrangler.jsonc', 'mcp/worker-configuration.d.ts', 'public/favicon.png'])).toEqual([
      'src/a.ts',
    ]);
  });
});
