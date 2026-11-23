/**
 * The quarterly report, in Markdown (ADR 0035): a body for the agency to
 * review, then a message for the merchant to copy into an e-mail.
 *
 * Pure: every figure comes in the document `shopctl report` assembled. The
 * body keeps the detail — tables, versions, pull requests, the property and
 * its indexing — and says, source by source, what could not be read and why.
 * The message has none of it: no table, no link, no technical word, a subject
 * proposed above it, and only the sections whose source answered.
 */
import { formatCount, formatMoney } from './sales.mjs';
import { frenchDay, periodSentence } from './period.mjs';

/** The issue's title, the same for the preview and the final report: the
 *  final one updates the issue the preview opened. */
export const issueTitle = (period) => `Rapport trimestriel — ${period.label}`;

/** The marker the publisher finds its issue by, besides the title. */
export const reportMarker = (period) => `<!-- shopctl report ${period.key} -->`;

/** « de » before a name, elided before a vowel: « d'Atelier Ambre ». */
export const of = (name) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(String(name)) ? `d'${name}` : `de ${name}`);

/** French plural: 0 and 1 take the singular. */
const plural = (count, one, many) => `${formatCount(count)} ${count > 1 ? many : one}`;

/** « a, b et c ». */
export function frenchList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} et ${list.at(-1)}`;
}

const percent = (share) => (share == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(share * 100)} %`);
const duration = (seconds) => {
  if (seconds == null) return '—';
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
};
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const referrer = (source) => (source ? source : 'accès direct');

function table(head, rows, align) {
  const lines = [`| ${head.map(cell).join(' | ')} |`, `|${align.map((side) => (side === 'r' ? '--:' : '---')).join('|')}|`];
  for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`);
  return lines.join('\n');
}

/** A source that did not answer, or that is not connected. */
function notice(source, name) {
  if (source.status === 'absent') return `_${name} n'est pas encore raccordé : ${source.reason}._`;
  return `> [!WARNING]\n> ${name} n'a pas répondu : ${source.message}${source.hint ? `\n> ${source.hint}` : ''}`;
}

// ── the body ─────────────────────────────────────────────────────────────────

function salesSection(document) {
  const { sales, period, store } = document;
  const lines = ['## Ventes', ''];
  if (sales.status !== 'ok') return [...lines, notice(sales, 'La base de production'), ''];
  const money = (cents) => formatMoney(cents, store.currency);
  const columns = [period.label, ...(sales.previous ? [period.previous.label] : [])];
  const row = (label, pick) => [label, pick(sales), ...(sales.previous ? [pick(sales.previous)] : [])];
  lines.push(
    table(
      ['', ...columns],
      [
        row('Commandes payées', (figures) => formatCount(figures.orders)),
        row('Chiffre d\'affaires TTC', (figures) => money(figures.grossCents)),
        row('Remboursements', (figures) => money(figures.refundedCents)),
        row('Net', (figures) => money(figures.netCents)),
        row('Panier moyen', (figures) => (figures.averageCents == null ? '—' : money(figures.averageCents))),
        row('Acheteurs distincts', (figures) => formatCount(figures.buyers)),
      ],
      ['l', ...columns.map(() => 'r')],
    ),
    '',
  );
  if (sales.top.length > 0) {
    lines.push('**Produits les plus vendus**', '', table(['Produit', 'Quantité', 'Montant TTC'], sales.top.map((item) => [item.name, formatCount(item.quantity), money(item.cents)]), ['l', 'r', 'r']), '');
  }
  return lines;
}

const KIND_LABELS = { evolution: 'Évolution', correction: 'Correction', maintenance: 'Maintenance' };

function historySection(document) {
  const { history } = document;
  const lines = ['## Évolutions de la boutique', ''];
  if (history.status !== 'ok') return [...lines, notice(history, 'L\'historique git'), ''];
  const { core, changes, direct } = history;
  lines.push('### Socle', '');
  if (!core.to) lines.push('_Version du socle illisible à la fin de la période._', '');
  else if (!core.from) lines.push(`Boutique créée pendant la période, sur le socle v${core.to}.`, '');
  else if (core.versions.length === 0) lines.push(`v${core.to}, inchangé pendant la période.`, '');
  else {
    lines.push(`v${core.from} → v${core.to} :`, '');
    for (const version of core.versions) {
      lines.push(`- **v${version.version}** — ${version.summary || version.title}`);
      if (version.guide.length > 0) lines.push(`  - Guide administrateur : ${version.guide.join(' ; ')}.`);
    }
    lines.push('');
  }
  const own = changes.filter((change) => change.kind !== 'socle');
  lines.push('### Changements propres à la boutique', '');
  if (own.length === 0) lines.push('Aucun.', '');
  else {
    for (const change of own) {
      const client = change.client === undefined ? '' : change.client === '' ? ' — _hors du message_' : ` — pour le client : « ${change.client} »`;
      lines.push(`- ${KIND_LABELS[change.kind]} — ${change.number ? `#${change.number} ` : ''}${change.title}${client}`);
    }
    lines.push('');
  }
  if (direct.length > 0) {
    lines.push('### Commits poussés directement', '');
    for (const commit of direct) lines.push(`- \`${commit.sha.slice(0, 7)}\` ${commit.title}`);
    lines.push('');
  }
  return lines;
}

function searchSection(document) {
  const { search, period } = document;
  const lines = ['## Référencement — Google Search Console', ''];
  if (search.status !== 'ok') return [...lines, notice(search, 'Search Console'), ''];
  lines.push(`Propriété \`${search.property}\`.`, '');
  const columns = [period.label, ...(search.previous ? [period.previous.label] : [])];
  const row = (label, pick) => [label, pick(search.totals), ...(search.previous ? [pick(search.previous)] : [])];
  lines.push(
    table(
      ['', ...columns],
      [
        row('Apparitions dans Google (impressions)', (figures) => formatCount(figures.impressions)),
        row('Visites depuis Google (clics)', (figures) => formatCount(figures.clicks)),
        row('Taux de clic', (figures) => percent(figures.ctr)),
        row('Position moyenne', (figures) => (figures.position == null ? '—' : String(figures.position).replace('.', ','))),
      ],
      ['l', ...columns.map(() => 'r')],
    ),
    '',
  );
  if (search.queries.length > 0) {
    lines.push('**Recherches**', '', table(['Recherche', 'Apparitions', 'Clics', 'Position'], search.queries.map((entry) => [entry.key, formatCount(entry.impressions), formatCount(entry.clicks), String(entry.position ?? '—').replace('.', ',')]), ['l', 'r', 'r', 'r']), '');
  }
  if (search.pages.length > 0) {
    lines.push('**Pages**', '', table(['Page', 'Clics', 'Apparitions'], search.pages.map((entry) => [entry.key, formatCount(entry.clicks), formatCount(entry.impressions)]), ['l', 'r', 'r']), '');
  }
  const { indexing } = search;
  if (indexing.error) lines.push(`> [!WARNING]\n> Indexation : ${indexing.error}`, '');
  else {
    lines.push(`**Indexation** : ${plural(indexing.indexed, 'page indexée', 'pages indexées')} sur ${formatCount(indexing.checked)} vérifiée${indexing.checked > 1 ? 's' : ''}${indexing.total > indexing.checked ? ` (les ${formatCount(indexing.checked)} premières des ${formatCount(indexing.total)} du sitemap)` : ''}.`, '');
    if (indexing.states.length > 0) lines.push(table(['État des pages non indexées', 'Pages'], indexing.states.map((entry) => [entry.state, formatCount(entry.count)]), ['l', 'r']), '');
  }
  return lines;
}

function audienceSection(document) {
  const { audience, period } = document;
  const lines = ['## Fréquentation — Umami', ''];
  if (audience.status !== 'ok') return [...lines, notice(audience, 'Umami'), ''];
  if (audience.measuredSince) lines.push(`Mesure en place depuis le ${frenchDay(audience.measuredSince.slice(0, 10))}.`, '');
  const columns = [period.label, ...(audience.previous ? [period.previous.label] : [])];
  const row = (label, pick) => [label, pick(audience), ...(audience.previous ? [pick(audience.previous)] : [])];
  lines.push(
    table(
      ['', ...columns],
      [
        row('Visiteurs', (figures) => formatCount(figures.visitors)),
        row('Visites', (figures) => formatCount(figures.visits)),
        row('Pages vues', (figures) => formatCount(figures.pageviews)),
        row('Taux de rebond', (figures) => percent(figures.bounceRate)),
        row('Durée moyenne d\'une visite', (figures) => duration(figures.averageVisitSeconds)),
      ],
      ['l', ...columns.map(() => 'r')],
    ),
    '',
  );
  if (audience.pages.length > 0) {
    lines.push('**Pages les plus vues**', '', table(['Page', 'Chemin', 'Vues'], audience.pages.map((entry) => [entry.title ?? '', entry.x, formatCount(entry.y)]), ['l', 'l', 'r']), '');
  }
  if (audience.referrers.length > 0) {
    lines.push('**Provenance**', '', table(['Source', 'Visites'], audience.referrers.map((entry) => [referrer(entry.x), formatCount(entry.y)]), ['l', 'r']), '');
  }
  return lines;
}

// ── the message ──────────────────────────────────────────────────────────────

/** The merchant's message: a subject, and the text between « Bonjour » and
 *  « Bien cordialement ». */
export function renderClientMessage(document) {
  const { store, period, sales, history, search, audience } = document;
  const money = (cents) => formatMoney(cents, store.currency);
  const paragraphs = ['Bonjour,', `Voici le bilan ${of(store.name)} pour le ${period.label} (${periodSentence(period)})${period.partial ? ', en cours' : ''}.`];

  if (sales.status === 'ok') {
    const lines = ['**Vos ventes**'];
    if (sales.orders === 0) lines.push('Aucune commande sur la période.');
    else {
      const refunds = sales.refundedCents > 0 ? `, dont ${money(sales.refundedCents)} remboursés` : '';
      lines.push(`${plural(sales.orders, 'commande', 'commandes')} pour ${money(sales.grossCents)} TTC${refunds}, soit un panier moyen de ${money(sales.averageCents)}.`);
    }
    if (sales.previous) lines.push(`Au trimestre précédent : ${plural(sales.previous.orders, 'commande', 'commandes')} pour ${money(sales.previous.grossCents)} TTC.`);
    if (sales.top.length > 0) lines.push(`Les produits les plus demandés : ${frenchList(sales.top.slice(0, 3).map((item) => `${item.name} (${formatCount(item.quantity)})`))}.`);
    paragraphs.push(lines.join('\n'));
  }

  if (history.status === 'ok') {
    const items = history.changes
      .filter((change) => (change.kind === 'evolution' || change.kind === 'correction') && change.client !== '')
      .map((change) => change.client ?? change.title);
    const guide = history.core.versions.flatMap((version) => version.guide);
    const lines = ['**Ce qui a changé sur votre boutique**'];
    for (const item of items) lines.push(`- ${item.replace(/\.$/, '')}`);
    if (guide.length > 0) {
      lines.push('- Nouveau dans votre administration, détaillé dans son guide (bouton « Aide ») :');
      for (const bullet of guide) lines.push(`  - ${bullet[0].toUpperCase()}${bullet.slice(1)}`);
    } else if (history.core.versions.length > 0) {
      lines.push('- La plateforme de votre boutique a été mise à jour (fiabilité et sécurité), sans changement dans votre administration.');
    }
    if (lines.length > 1) paragraphs.push(lines.join('\n'));
  }

  if (search.status === 'ok') {
    const { totals, previous } = search;
    const lines = ['**Sur Google**'];
    const before = previous ? ` (${plural(previous.impressions, 'apparition', 'apparitions')} et ${plural(previous.clicks, 'visite', 'visites')} au trimestre précédent)` : '';
    lines.push(`Votre boutique est apparue ${formatCount(totals.impressions)} fois dans les résultats de recherche de Google, et en a reçu ${plural(totals.clicks, 'visite', 'visites')}${before}.`);
    const queries = search.queries.slice(0, 3).map((entry) => `« ${entry.key} »`);
    if (queries.length > 0) lines.push(`Les recherches qui l'ont le plus fait apparaître : ${frenchList(queries)}.`);
    if (!search.indexing.error && search.indexing.checked > 0) {
      lines.push(`Google a enregistré ${formatCount(search.indexing.indexed)} des ${formatCount(search.indexing.checked)} pages vérifiées de votre boutique.`);
    }
    paragraphs.push(lines.join('\n'));
  }

  if (audience.status === 'ok') {
    const lines = ['**Vos visiteurs**'];
    const since = audience.measuredSince ? ` depuis le ${frenchDay(audience.measuredSince.slice(0, 10))}, date de mise en place de la mesure` : '';
    lines.push(`${plural(audience.visitors, 'visiteur', 'visiteurs')}${since}, pour ${plural(audience.visits, 'visite', 'visites')} et ${plural(audience.pageviews, 'page vue', 'pages vues')}${audience.previous ? ` (${plural(audience.previous.visitors, 'visiteur', 'visiteurs')} au trimestre précédent)` : ''}.`);
    const pages = audience.pages.slice(0, 3).map((entry) => entry.title).filter(Boolean);
    if (pages.length > 0) lines.push(`Les pages les plus vues : ${frenchList(pages)}.`);
    const sources = audience.referrers.slice(0, 3).map((entry) => (entry.x ? entry.x : 'un accès direct'));
    if (sources.length > 0) lines.push(`Vos visiteurs arrivent surtout de ${frenchList(sources)}.`);
    paragraphs.push(lines.join('\n'));
  }

  paragraphs.push('N\'hésitez pas à me répondre pour toute question.', 'Bien cordialement,');
  return { subject: `${store.name} — votre bilan du ${period.label}`, text: paragraphs.join('\n\n') };
}

/** The whole report: the issue's body. */
export function renderReport(document) {
  const { store, period, history } = document;
  const coreLine = history.status === 'ok' && history.core.to
    ? history.core.from && history.core.from !== history.core.to
      ? `v${history.core.from} → v${history.core.to}`
      : `v${history.core.to}`
    : 'inconnu';
  const coverage = [
    periodSentence(period),
    period.partial ? 'aperçu du trimestre en cours' : null,
    period.clamped ? 'depuis le début du suivi' : null,
  ].filter(Boolean);
  const message = renderClientMessage(document);
  const lines = [
    reportMarker(period),
    `> Produit par \`shopctl report\` le ${frenchDay(document.generatedAt.slice(0, 10))}. À relire, puis envoyer la dernière section au commerçant par courriel : les retouches se font dans le courriel.`,
    '',
    `- **Boutique** : ${store.name} — https://${store.domain}`,
    `- **Période couverte** : ${coverage.join(', ')}`,
    `- **Socle** : ${coreLine}`,
    '',
    ...salesSection(document),
    ...historySection(document),
    ...searchSection(document),
    ...audienceSection(document),
    '## Message pour le commerçant',
    '',
    `**Objet proposé** : ${message.subject}`,
    '',
    '---',
    '',
    message.text,
    '',
  ];
  return lines.join('\n');
}
