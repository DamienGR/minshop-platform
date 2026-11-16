import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { PALETTE } from './layout.ts';

/**
 * A merchant's Markdown, as an e-mail's HTML part can carry it: a shipping
 * rate's instructions (ticket #237), today the one such text.
 *
 * The parse is the pages' (`html: false`: raw HTML stays text, markdown-it's
 * own refusal of `javascript:` and the like), but the output differs in the
 * two ways an inbox needs. Every element carries its style inline, since a
 * mail client strips stylesheets (layout.ts), and every link is absolute,
 * since a relative one has no site to be relative to in a mailbox. A heading
 * becomes a bold paragraph: a title the size of the e-mail's own inside a
 * delivery note reads as a second e-mail. An image, which the instructions
 * refuse on save, would be written as its alt text.
 *
 * The plain-text part takes the text as the merchant wrote it.
 */

const TEXT = 'margin:0 0 8px;font-size:14px;line-height:1.6;';
const LIST = `margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.6;`;
const CELL = `padding:4px 8px;border:1px solid ${PALETTE.line};text-align:left;`;

const STYLES: Record<string, string> = {
  p: TEXT,
  ul: LIST,
  ol: LIST,
  li: 'margin:0 0 4px;',
  blockquote: `margin:0 0 8px;padding-left:12px;border-left:3px solid ${PALETTE.line};color:${PALETTE.muted};`,
  hr: `border:0;border-top:1px solid ${PALETTE.line};margin:12px 0;`,
  table: 'margin:0 0 8px;border-collapse:collapse;font-size:14px;',
  th: CELL,
  td: CELL,
};

const HEADING = /^h[1-6]$/;
/** On the `<code>` inside `<pre>`, where markdown-it writes a fence's attributes. */
const CODE_BLOCK = 'display:block;margin:0 0 8px;white-space:pre-wrap;font-family:monospace;font-size:13px;';

function styleInline(tokens: Token[], origin: string): void {
  for (const token of tokens) {
    if (token.type === 'link_open') {
      const href = String(token.attrGet('href') ?? '');
      try {
        token.attrSet('href', new URL(href, origin).href);
      } catch {
        // Left as written: markdown-it vetted its scheme, and a target that
        // is not a URL against the shop's origin has nothing to resolve to.
      }
      token.attrSet('style', `color:${PALETTE.brand};font-weight:600;`);
    } else if (token.type === 'code_inline') {
      token.attrSet('style', 'font-family:monospace;');
    } else if (token.type === 'image') {
      token.type = 'text';
      token.children = null;
    }
  }
}

/** The text's HTML for an e-mail sent from `origin` (the shop's, e.g. https://boutique.fr). */
export function emailMarkdownHtml(markdown: string, origin: string): string {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
  md.core.ruler.push('email_inline_styles', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'fence' || token.type === 'code_block') {
        token.attrSet('style', CODE_BLOCK);
      } else if (HEADING.test(token.tag)) {
        token.tag = 'p';
        if (token.nesting === 1) token.attrSet('style', `${TEXT}font-weight:600;`);
      } else if (token.nesting !== -1 && STYLES[token.tag]) {
        token.attrSet('style', STYLES[token.tag]!);
      }
      if (token.type === 'inline' && token.children) styleInline(token.children, origin);
    }
  });
  return md.render(markdown);
}
