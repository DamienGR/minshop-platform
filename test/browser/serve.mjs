#!/usr/bin/env node
/**
 * The store the browser suite drives: the BUILT Worker, on a seeded, isolated D1.
 *
 * Built and not `astro dev`, deliberately. Half of what this suite exists to
 * check only exists after a build — the client scripts are bundled and
 * minified there, and the stylesheet is the one Tailwind actually compiled for
 * the selected theme. A dev server would have let the `en-US` price bug through
 * a second time, in a different disguise.
 *
 * Isolated and not `.wrangler/state`, for the same reason
 * test/integration/storefront-baselines.sh is: a suite that reads whatever a
 * developer last put in their local database asserts nothing. The state
 * directory is a fresh temp dir per run, seeded from the SAME two fixtures the
 * baselines gate uses, so a state visible here is a state visible there.
 *
 * Playwright owns readiness and teardown (`webServer` in playwright.config.mjs),
 * which is why there is no polling loop here — the one place this file differs
 * from the bash boot beside it, and the reason it is not shared with it.
 *
 * Usage: node test/browser/serve.mjs <port>
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { adminPasswordHash } from './admin.mjs';

const port = process.argv[2] ?? '8788';

if (!existsSync('dist/server/wrangler.json')) {
  console.error(
    'browser suite: no build to serve. Run `npm run build` first — or use ' +
      '`npm run test:browser`, which builds for you.',
  );
  process.exit(1);
}

const state = mkdtempSync(join(tmpdir(), 'minshop-browser-'));
const wrangler = (args) =>
  execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
wrangler(['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', './seed.sql']);
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--file', './test/fixtures/storefront-states.sql',
]);
// An admin password, for the specs that save in Admin → Réglages. Here and not
// in the shared fixtures: the baselines gate has no admin to log into.
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command', `INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', '${adminPasswordHash()}')`,
]);

// The contact form (ADR 0025) under a page of its own, for the specs that walk
// it without JavaScript. Here and not in the shared fixtures, like the admin
// password: the baselines gate renders no form. The page shows the form from
// settings alone, so a key row stands in for a provider — the specs refuse
// before anything would be sent, and the integration suite does the sending.
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  "INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id) VALUES ('Contact', 'contact', 'Une question sur une commande, un projet sur mesure\u202f?', 1, 'page_c0ntact000'); " +
    "INSERT OR REPLACE INTO settings (key, value) SELECT 'contact_page', id FROM pages WHERE slug = 'contact'; " +
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('contact_to', 'atelier@exemple.test'), ('enc:resend_api_key', 'browser-suite-placeholder')",
]);

// A page with photos beside their text (ticket #195), for page-photo.spec.mjs.
// Here and not in the shared fixtures: the HTML baselines would change with
// the sitemap. The photos are the gallery's objects, put below.
const PHOTO_PAGE = [
  '![Mes mains à l’atelier](/images/media/tee-front.jpg "gauche")',
  '',
  'Chaque pièce naît sur l’établi, coupée, assemblée et finie à la main, d’un bout à l’autre, dans le même atelier depuis douze ans.',
  '',
  'Un second paragraphe continue à côté de la photo, tant qu’elle descend plus bas que lui.',
  '',
  '## Les matières',
  '',
  '![Une toile de lin lavé](/images/media/tee-back.jpg "droite")',
  '',
  'Du lin lavé, tissé en France, choisi pour sa tenue et sa douceur.',
].join('\n');
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  `INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id) VALUES ('L’atelier', 'atelier', '${PHOTO_PAGE}', 1, 'page_ph0t0s0000')`,
]);

// Text in columns (ADR 0030), for page-columns.spec.mjs: two columns, the
// second twice as wide, then three equal ones.
const COLUMNS_PAGE = [
  'Deux colonnes, la seconde plus large :',
  '',
  '::: colonnes 1/2',
  '## L’atelier',
  '',
  'Chaque pièce naît sur l’établi, coupée, assemblée et finie à la main.',
  '',
  '::: colonne',
  '## Les matières',
  '',
  'Du lin lavé, tissé en France, choisi pour sa tenue et sa douceur, et un coton épais pour l’hiver.',
  ':::',
  '',
  'Puis trois colonnes égales :',
  '',
  '::: colonnes',
  '### Coupe',
  '::: colonne',
  '### Assemblage',
  '::: colonne',
  '### Finitions',
  ':::',
].join('\n');
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  `INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id) VALUES ('En colonnes', 'en-colonnes', '${COLUMNS_PAGE}', 1, 'page_c0nnes0000')`,
]);

// A box (a `::: encadré` block, ticket #205), for page-box.spec.mjs: one in
// the body, holding a heading, a link and a list, and one in a column.
const BOX_PAGE = [
  'Nos engagements, en bref.',
  '',
  '::: encadré',
  '### Bon à savoir',
  '',
  'La livraison est **offerte** dès 60 €, et le retour reste gratuit trente jours. Les [conditions](/pages/about) disent le reste.',
  '',
  '- Expédition sous 48 heures',
  '- Emballage sans plastique',
  ':::',
  '',
  '::: colonnes',
  '## L’atelier',
  '',
  'Chaque pièce naît sur l’établi, coupée, assemblée et finie à la main.',
  '',
  '::: colonne',
  '## Les visites',
  '',
  '::: encadré',
  'Sur rendez-vous, le samedi matin.',
  ':::',
  ':::',
].join('\n');
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  `INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id) VALUES ('Bon à savoir', 'bon-a-savoir', '${BOX_PAGE}', 1, 'page_encadre000')`,
]);

// Pages drawn by a theme's model (ADR 0031), for page-models.spec.mjs: the
// witnesses of the atelier theme, « La marque » and « Où nous trouver », and
// a page the editor spec reorders. A theme that declares neither model draws
// them as « Basique », their body alone. No map: a tile would go out to the
// tile server, which the suite never reaches.
const zonesSql = (zones) => JSON.stringify(zones).replaceAll("'", "''");
const BRAND_ZONES = zonesSql({
  accroche: 'Né à l’atelier, cousu main.',
  engagements: '- Du lin **tissé en France**\n- Des pièces réparées à vie',
});
const POINTS_ZONES = zonesSql({
  points: [
    { nom: 'Halles de Vannes', adresse: 'Place du Poids public, 56000 Vannes', horaires: '**Samedi** de 8 h à 13 h' },
    { nom: 'L’atelier', adresse: '12 rue des Tanneurs, 56000 Vannes', horaires: 'Sur rendez-vous' },
  ],
});
const EDITED_ZONES = zonesSql({ points: [{ nom: 'Marché A' }, { nom: 'Marché B' }] });
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  'INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id, model, zones) VALUES ' +
    `('Notre marque', 'notre-marque', 'Tout a commencé sur un établi, avec une toile de lin et une aiguille.', 1, 'page_marq000000', 'marque', '${BRAND_ZONES}'), ` +
    `('Où nous trouver', 'ou-nous-trouver', 'Retrouvez-nous sur les marchés de la côte.', 1, 'page_pvente0000', 'points-de-vente', '${POINTS_ZONES}'), ` +
    `('Nos marchés', 'nos-marches', 'Les marchés de la semaine.', 1, 'page_ed1t000000', 'points-de-vente', '${EDITED_ZONES}')`,
]);

// A row of photos and a photo alone (ticket #194), for page-gallery.spec.mjs:
// three images one under the other, then a portrait taller than the screen.
// Measured, like an image the media library took in: the width attribute is
// what a capped height must not squash.
const GALLERY_PAGE = [
  'Trois photos l’une sous l’autre, sans ligne vide : une rangée.',
  '',
  '![Le devant](/images/media/tee-front.jpg)',
  '![Le dos](/images/media/tee-back.jpg)',
  '![Le côté](/images/media/tee-side.jpg)',
  '',
  'Une photo seule, en hauteur :',
  '',
  '![Un portrait](/images/media/portrait.png)',
].join('\n');
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  `INSERT OR IGNORE INTO pages (title, slug, body_markdown, published, public_id) VALUES ('En images', 'en-images', '${GALLERY_PAGE}', 1, 'page_ga11ery000'); ` +
    "INSERT OR IGNORE INTO media (image_key, original_name, mime_type, width, height, public_id) VALUES " +
    "('media/tee-front.jpg', 'tee-front.jpg', 'image/png', 600, 600, 'med_teefr00000'), " +
    "('media/tee-back.jpg', 'tee-back.jpg', 'image/png', 600, 600, 'med_teeback000'), " +
    "('media/tee-side.jpg', 'tee-side.jpg', 'image/png', 600, 600, 'med_tees1de000'), " +
    "('media/portrait.png', 'portrait.png', 'image/png', 900, 1200, 'med_p0rtra1t00'); " +
    'INSERT OR IGNORE INTO page_media (page_id, media_id) SELECT p.id, m.id FROM pages p, media m ' +
    "WHERE p.slug = 'en-images' AND m.image_key IN ('media/tee-front.jpg', 'media/tee-back.jpg', 'media/tee-side.jpg', 'media/portrait.png')",
]);

// The product page's gallery follows a variant the shopper chose, never the
// one the server checks (ticket #185). sample-tee's default (Small, the first
// in stock) shows the SECOND photo, and a third photo belongs to a variant
// the shopper can pick (Large stays sold out, for the specs that need one).
wrangler([
  'd1', 'execute', 'DB', '--local', '--persist-to', state,
  '--command',
  'INSERT INTO product_images (product_id, image_key, position, public_id) ' +
    "SELECT id, 'media/tee-side.jpg', 2, 'pimg_s1de000000' FROM products WHERE slug = 'sample-tee'; " +
    'INSERT INTO product_variants (product_id, label, price_cents, stock, sku, position, public_id, image_id) ' +
    "SELECT p.id, 'Medium', 2600, 4, 'TEE-M', 2, 'var_m3d0000000', i.id FROM products p " +
    "JOIN product_images i ON i.product_id = p.id AND i.image_key = 'media/tee-side.jpg' WHERE p.slug = 'sample-tee'; " +
    'UPDATE product_variants SET image_id = (SELECT i.id FROM product_images i ' +
    "WHERE i.product_id = product_variants.product_id AND i.image_key = 'media/tee-back.jpg') " +
    "WHERE label = 'Small' AND product_id = (SELECT id FROM products WHERE slug = 'sample-tee')",
]);

// The gallery rows point at object keys. Without the objects the product page
// renders broken images, and "does this image actually load" is one of the
// things the suite asks.
const bucket = bucketName();
for (const key of ['media/tee-front.jpg', 'media/tee-back.jpg', 'media/tee-side.jpg']) {
  wrangler([
    'r2', 'object', 'put', `${bucket}/${key}`, '--local', '--persist-to', state,
    '--file', 'public/placeholder.png', '--content-type', 'image/png',
  ]);
}
// The portrait: no such file in the repository, so one is drawn here.
const portrait = join(state, 'portrait.png');
writeFileSync(portrait, solidPng(900, 1200));
wrangler([
  'r2', 'object', 'put', `${bucket}/media/portrait.png`, '--local', '--persist-to', state,
  '--file', portrait, '--content-type', 'image/png',
]);

const child = spawn(
  'npx',
  [
    'wrangler', 'dev',
    '--config', 'dist/server/wrangler.json',
    '--persist-to', state,
    '--var', 'CANONICAL_ORIGIN:https://canonical.example',
    '--var', 'AUTH_SECRET:browser-suite-auth-secret',
    // Without a vault, Réglages shows no key field to save.
    '--var', 'SECRETS_KEK:browser-suite-key-encryption-key',
    // The admin footer's help address, passed the way `shopctl deploy` passes
    // the agency's (ticket #186): a var, never a file.
    '--var', 'MINSHOP_SUPPORT_EMAIL:support@agence.example',
    '--ip', '127.0.0.1',
    '--port', port,
  ],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));

/** A PNG of one grey, `width` by `height`: 8-bit RGB, one IDAT. */
function solidPng(width, height) {
  const row = Buffer.alloc(1 + width * 3, 0xb4);
  row[0] = 0; // filter: none
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The R2 bucket this build is bound to, read from the rendered config rather
 *  than from wrangler.jsonc: the build is what the suite serves, and a shop's
 *  rendered config names its own buckets. */
function bucketName() {
  const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  const found = config.r2_buckets?.find((b) => b.binding === 'BUCKET');
  if (!found) throw new Error('the built Worker has no BUCKET binding');
  return found.bucket_name;
}
