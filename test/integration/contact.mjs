/**
 * The contact form (ticket #147, ADR 0025), on the built Worker.
 *
 * The rules a message must pass, the e-mail it becomes and the recipient it
 * goes to are units (features/contact, features/email/contactMessage.ts).
 * What only the pipeline shows is the whole round: the settings refuse a form
 * nobody would receive, the form appears under its page and `/contact` leads
 * there, a cross-site post is refused, a refusal hands the visitor's text back,
 * the trap answers like a success and sends nothing, Turnstile fails closed,
 * the edge limiter stops a burst, the message reaches the merchant with the
 * visitor in Reply-To, a failed send keeps the text on screen — and nothing the
 * visitor wrote reaches a log line or the database.
 *
 * Run: node --experimental-strip-types test/integration/contact.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { t } from '../../src/features/i18n/index.ts';
import { hashPassword } from '../../src/features/auth/password.ts';
import { generatePublicId } from '../../src/features/ids/publicId.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'contact-suite-key-encryption-key';
const AUTH_SECRET = 'contact-suite-auth-secret';
const PASSWORD = 'contact-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const MERCHANT = 'avis-commandes@exemple.fr';
const RECIPIENT = 'atelier-contact@exemple.fr';
const CONTACT_PAGE = generatePublicId('page');
const DRAFT_PAGE = generatePublicId('page');
/** The visitor this suite invents, and then looks for where it must not be. */
const VISITOR = {
  name: 'Gaspard Lemoine-Quatre',
  email: 'gaspard.lemoine-9c2e@exemple-contact.fr',
  phone: '06 98 76 54 32',
  reason: 'Sur mesure',
  message: 'Bonjour,\nje voudrais un tablier brodé « Atelier 7b3f » <b>pour ma sœur</b>.',
};

/** Every e-mail the Worker asked Resend to send, as posted. */
const emails = [];
/** What the Resend stub answers next: 'ok', or the refusal that quotes the visitor. */
let resendAnswer = 'ok';
/** What the Turnstile stub answers next. */
let turnstileVerdict = false;

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'challenges.cloudflare.com') {
      return Response.json({ success: turnstileVerdict });
    }
    if (url.hostname === 'api.resend.com') {
      const body = await request.json();
      if (resendAnswer !== 'ok') {
        // A provider refusing a message quotes it back — the shape the log
        // assertions exist to keep out of the logs.
        return Response.json(
          { statusCode: 422, message: `Invalid reply_to ${body.reply_to} for ${body.subject}` },
          { status: 422 },
        );
      }
      emails.push(body);
      return Response.json({ id: `contact-email-${emails.length}` });
    }
    return new Response('unexpected outbound call', { status: 502 });
  },
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
};

try {
  const { db, fetch } = worker;
  const setting = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  const unset = (key) => db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  await setting('setup_complete', '1');
  await setting('admin_password_hash', await hashPassword(PASSWORD));
  await setting('enc:resend_api_key', await encryptSecret(SECRETS_KEK, 're_contact_suite_key'));
  await setting('email_enabled', '1');
  await setting('email_provider', 'resend');
  await setting('email_from', 'boutique@exemple.fr');
  await setting('email_notify_to', MERCHANT);
  await db
    .prepare(
      `INSERT INTO pages (title, slug, body_markdown, published, public_id)
       VALUES ('Nous contacter', 'nous-contacter', 'Une question, un projet sur mesure ?', 1, ?),
              ('Brouillon', 'brouillon', '', 0, ?),
              ('À propos', 'a-propos', 'L’atelier.', 1, ?)`,
    )
    .bind(CONTACT_PAGE, DRAFT_PAGE, generatePublicId('page'))
    .run();
  const PAGE = '/pages/nous-contacter';

  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  assert.equal(login.status, 303, 'the admin login failed');
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  /** The settings card's save, as its script posts it. */
  const saveContact = (fields) =>
    fetch('/admin/settings', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session, 'x-requested-with': 'fetch' },
      body: new URLSearchParams({ _action: 'save_contact', ...fields }).toString(),
    });
  const stored = async (key) =>
    (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null;

  // Each section posts from its own address, so the edge limiter — five a
  // minute per client — only ever answers in the section that measures it.
  let client = 0;
  const send = (fields, { ip = `198.51.100.${++client}`, headers = {} } = {}) =>
    fetch(PAGE, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, 'cf-connecting-ip': ip, ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  const location = (response) => {
    const to = new URL(response.headers.get('location'), ORIGIN);
    return `${to.pathname}${to.search}${to.hash}`;
  };

  console.log('Les réglages');

  await check('without a chosen page there is no form, no POST and no /contact', async () => {
    const html = await (await fetch(PAGE)).text();
    assert.ok(!html.includes('name="message"'), 'a form was shown before it was set up');
    const posted = await send(VISITOR);
    assert.equal(posted.status, 405);
    assert.equal((await fetch('/contact')).status, 404);
    assert.equal(emails.length, 0);
  });

  await check('refuse a draft page, a bad recipient and a list it would cut', async () => {
    const draft = await saveContact({ contact_page: DRAFT_PAGE });
    assert.equal(draft.status, 400);
    assert.equal(await draft.text(), t('admin.settings.contact.error.page'));
    const recipient = await saveContact({ contact_page: CONTACT_PAGE, contact_to: 'atelier@exemple.fr\r\nBcc: x@exemple.fr' });
    assert.equal(recipient.status, 400);
    assert.equal(await recipient.text(), t('admin.settings.contact.error.recipient'));
    const many = await saveContact({
      contact_page: CONTACT_PAGE,
      contact_reasons: Array.from({ length: 11 }, (_, i) => `Motif ${i}`).join('\n'),
    });
    assert.equal(many.status, 400);
    assert.equal(await stored('contact_page'), null, 'a refused save placed the form');
  });

  await check('refuse to place a form nobody would receive', async () => {
    await setting('email_enabled', '0');
    const off = await saveContact({ contact_page: CONTACT_PAGE });
    assert.equal(off.status, 400);
    assert.equal(await off.text(), t('admin.settings.contact.error.email'));
    assert.equal(await stored('contact_page'), null);
    await setting('email_enabled', '1');
  });

  await check('place the form under its page, with its recipient and reasons', async () => {
    const saved = await saveContact({
      contact_page: CONTACT_PAGE,
      contact_to: RECIPIENT,
      contact_reasons: 'Renseignement\r\nSur mesure\nAutre\n',
    });
    assert.equal(saved.status, 204, await saved.clone().text());
    assert.match(String(await stored('contact_page')), /^\d+$/);
    assert.equal(await stored('contact_to'), RECIPIENT);
    assert.equal(await stored('contact_reasons'), 'Renseignement\nSur mesure\nAutre');
    const admin = await (await fetch('/admin/settings', { headers: { cookie: session } })).text();
    assert.ok(admin.includes(t('admin.settings.contact.status.live', { page: 'Nous contacter' })), 'the section does not say it is live');
  });

  console.log('La page');

  await check('the form sits under its page, and /contact leads there', async () => {
    const page = await fetch(PAGE);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Une question, un projet sur mesure'), 'the page text is gone');
    assert.ok(html.includes(`action="${PAGE}#contact"`), 'the form does not post to its page');
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(options, ['', 'Renseignement', 'Sur mesure', 'Autre']);
    assert.ok(!html.includes('cf-turnstile'), 'Turnstile renders while it is off');
    const contact = await fetch('/contact');
    assert.equal(contact.status, 302);
    assert.equal(location(contact), PAGE);
    assert.equal(contact.headers.get('cache-control'), 'private, no-store');
    // Every other page stays a page.
    const other = await fetch('/pages/a-propos', { method: 'POST', headers: { origin: ORIGIN, 'content-type': FORM } });
    assert.equal(other.status, 405);
    assert.ok(!(await (await fetch('/pages/a-propos')).text()).includes('name="message"'), 'the form spread to another page');
  });

  await check('refuse a cross-site post and a post with no Origin', async () => {
    const foreign = await send(VISITOR, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const bare = await fetch(PAGE, {
      method: 'POST',
      headers: { 'content-type': FORM },
      body: new URLSearchParams(VISITOR).toString(),
    });
    assert.equal(bare.status, 403);
    assert.equal(emails.length, 0);
  });

  console.log('Les refus');

  await check('a refusal hands the text back, names each field, and is never shared', async () => {
    const refused = await send({ ...VISITOR, email: 'gaspard@exemple', reason: '' });
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('cache-control'), 'private, no-store');
    const html = await refused.text();
    assert.ok(html.includes(t('contact.error.email.invalid')));
    assert.ok(html.includes(t('contact.error.reason.required')));
    assert.ok(html.includes('value="gaspard@exemple"'), 'the address typed is gone');
    assert.ok(html.includes('Gaspard Lemoine-Quatre'));
    // The message comes back escaped, inside its textarea.
    assert.ok(html.includes('&lt;b&gt;pour ma sœur&lt;/b&gt;'), 'the message is gone or unescaped');
    assert.ok(!html.includes('<b>pour ma sœur</b>'));
    assert.match(html, /id="contact-email"[^>]*aria-invalid="true"/);
    assert.equal(emails.length, 0);
  });

  await check('a reason that is not in the list is refused', async () => {
    const refused = await send({ ...VISITOR, reason: 'Partenariat' });
    assert.equal(refused.status, 400);
    assert.ok((await refused.text()).includes(t('contact.error.reason.unknown')));
    assert.equal(emails.length, 0);
  });

  await check('the trap answers like a success and sends nothing', async () => {
    const trapped = await send({ ...VISITOR, website: 'https://spam.example' });
    assert.equal(trapped.status, 303);
    assert.equal(location(trapped), `${PAGE}?sent=1#contact`);
    assert.equal(emails.length, 0, 'a trapped message was sent');
  });

  console.log('L’envoi');

  await check('the message reaches the recipient, answered to the visitor', async () => {
    const sent = await send(VISITOR);
    assert.equal(sent.status, 303);
    assert.equal(location(sent), `${PAGE}?sent=1#contact`);
    assert.equal(emails.length, 1);
    const [email] = emails;
    assert.deepEqual(email.to, [RECIPIENT]);
    assert.equal(email.reply_to, VISITOR.email);
    assert.equal(email.subject, t('email.contact.subject', { motif: VISITOR.reason, nom: VISITOR.name }));
    assert.ok(email.text.includes(VISITOR.message), 'the text part lost the message');
    assert.ok(email.text.includes(VISITOR.phone));
    assert.ok(email.text.includes(`${ORIGIN}${PAGE}`), 'the e-mail does not say where it was sent from');
    assert.ok(!email.html.includes('<b>pour ma sœur</b>'), 'the HTML part carries the visitor’s markup');
    assert.ok(email.html.includes('&lt;b&gt;pour ma sœur&lt;/b&gt;'));
    const confirmation = await (await fetch(location(sent))).text();
    assert.ok(confirmation.includes(t('contact.sent.title')));
    assert.ok(!confirmation.includes('name="message"'), 'the confirmation still shows the form');
  });

  await check('without its own recipient, the form writes to the order alerts’', async () => {
    assert.equal((await saveContact({ contact_page: CONTACT_PAGE, contact_reasons: 'Sur mesure' })).status, 204);
    assert.equal((await send(VISITOR)).status, 303);
    assert.deepEqual(emails.at(-1).to, [MERCHANT]);
  });

  await check('a failed send keeps the text on screen, and says so', async () => {
    const before = emails.length;
    resendAnswer = 'refuse';
    const failed = await send(VISITOR);
    resendAnswer = 'ok';
    assert.equal(failed.status, 503);
    const html = await failed.text();
    assert.ok(html.includes(t('contact.error.sendFailed')));
    assert.ok(html.includes('&lt;b&gt;pour ma sœur&lt;/b&gt;'), 'the message was lost with the send');
    assert.equal(emails.length, before);
    assert.match(worker.logs(), /contact_send_failed/, 'the failure was not logged');
  });

  console.log('L’anti-abus');

  await check('with Turnstile on, an unanswered or rejected challenge sends nothing', async () => {
    await setting('turnstile_enabled', '1');
    await setting('turnstile_site_key', '1x00000000000000000000AA');
    await setting('enc:turnstile_secret_key', await encryptSecret(SECRETS_KEK, 'contact-suite-turnstile'));
    const before = emails.length;
    const html = await (await fetch(PAGE)).text();
    assert.ok(html.includes('cf-turnstile'), 'the challenge is not on the page');
    turnstileVerdict = false;
    const refused = await send({ ...VISITOR, 'cf-turnstile-response': 'rejected' });
    assert.equal(refused.status, 400);
    assert.ok((await refused.text()).includes(t('contact.error.verification')));
    turnstileVerdict = true;
    assert.equal((await send({ ...VISITOR, 'cf-turnstile-response': 'accepted' })).status, 303);
    assert.equal(emails.length, before + 1);
    // On, and unverifiable: refused, never waved through.
    await unset('enc:turnstile_secret_key');
    assert.equal((await send({ ...VISITOR, 'cf-turnstile-response': 'accepted' })).status, 400);
    assert.equal(emails.length, before + 1);
    await unset('turnstile_enabled');
    await unset('turnstile_site_key');
    turnstileVerdict = false;
  });

  await check('the edge limiter stops a burst from one client, not the next one', async () => {
    const ip = '203.0.113.77';
    const statuses = [];
    // Refused submissions: the limiter counts posts, sent or not.
    for (let i = 0; i < 6; i++) statuses.push((await send({ ...VISITOR, email: '' }, { ip })).status);
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    assert.equal((await send({ ...VISITOR, email: '' }, { ip: '203.0.113.78' })).status, 400);
  });

  console.log('Les données personnelles');

  await check('nothing the visitor wrote reaches a log line', async () => {
    const logs = worker.logs();
    for (const [what, value] of [
      ['the address', VISITOR.email],
      ['the name', VISITOR.name],
      ['the phone', VISITOR.phone],
      ['the message', 'Atelier 7b3f'],
    ]) {
      assert.ok(!logs.includes(value), `${what} was logged`);
    }
  });

  await check('nothing the visitor wrote is kept in the database', async () => {
    const { results: tables } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '%fts%'")
      .all();
    for (const { name } of tables) {
      const { results } = await db.prepare(`SELECT * FROM "${name}"`).all();
      const dump = JSON.stringify(results);
      for (const value of [VISITOR.email, VISITOR.name, 'Atelier 7b3f']) {
        assert.ok(!dump.includes(value), `${name} keeps what the visitor wrote`);
      }
    }
  });

  await check('an unpublished page takes the form, and /contact, down with it', async () => {
    await db.prepare('UPDATE pages SET published = 0 WHERE public_id = ?').bind(CONTACT_PAGE).run();
    assert.equal((await fetch(PAGE)).status, 404);
    assert.equal((await fetch('/contact')).status, 404);
    const admin = await (await fetch('/admin/settings', { headers: { cookie: session } })).text();
    assert.ok(admin.includes(t('admin.settings.contact.status.pageMissing')));
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLe message part chez le commerçant, et rien de lui ne reste dans la boutique.');
