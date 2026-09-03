/**
 * The key, and what it does to an archive.
 *
 * ADR 0005 asks for a backup that is encrypted, because a backup of this shop
 * is every order, every address and every e-mail the merchant has ever taken —
 * on a laptop, in an object store, or on whatever medium the agency's retention
 * policy eventually puts it. It is the one copy of the shop that leaves the
 * account, and it has to be worth nothing to whoever finds it.
 *
 * AES-256-GCM from `node:crypto`, and nothing else: this CLI has no
 * dependencies and cannot grow one (ADR 0009). GCM rather than CBC because a
 * backup needs to detect TAMPERING, not only hide bytes — an archive whose
 * ciphertext was edited must fail to open rather than restore something nobody
 * wrote.
 *
 * THE MANIFEST IS AUTHENTICATED TOO, as additional data. Everything a keyless
 * `backup list` and `backup verify` read — the shop, the environment, the
 * schema version, the row counts, the object inventory — sits in the clear so
 * that they can read it, which is exactly what makes it worth altering. Passing
 * it as AAD means an altered header does not decrypt: the archive cannot claim
 * to be another shop's, another environment's, or another schema's.
 *
 * The key never appears in an argument (plan §5.1: no secret on the command
 * line). It comes from a FILE the operator holds or from `SHOPCTL_BACKUP_KEY`,
 * and `backup keygen` writes one without ever printing it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { inputError, preconditionError } from '../errors.mjs';

export const ALGORITHM = 'aes-256-gcm';
export const KEY_BYTES = 32;
export const IV_BYTES = 12;

/** Where a shop keeps its backup key when the operator names no other place. */
export const DEFAULT_KEY_FILE = '.shopctl/backup.key';

/** The environment variable a CI job sets instead of carrying a file. */
export const KEY_ENV = 'SHOPCTL_BACKUP_KEY';

export function generateKey() {
  return randomBytes(KEY_BYTES);
}

/**
 * A short, public name for a key.
 *
 * Written into every manifest so that `verify` and `restore` can say "this is
 * not the key that made this archive" before spending a decryption on it — and
 * so that an operator rotating keys can tell two archives apart. A hash of the
 * key truncated to eight bytes: enough to distinguish the handful of keys an
 * agency holds, far too little to attack the key itself.
 */
export function keyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function decodeKey(text, where) {
  const raw = String(text).trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
    throw inputError(`${where} ne contient pas une clé base64.`, 'Une clé de sauvegarde est 32 octets en base64, telle que `shopctl backup keygen` l\'écrit.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw inputError(
      `${where} porte une clé de ${key.length} octet(s) ; il en faut ${KEY_BYTES}.`,
      'Régénérez-la avec `shopctl backup keygen` — et gardez l\'ancienne tant qu\'une archive chiffrée avec elle doit rester lisible.',
    );
  }
  return key;
}

/**
 * The key this run uses, or a refusal that says how to get one.
 *
 * Order of precedence, most deliberate first: an explicit `--key-file`, the
 * environment variable, then the shop's own default file. Two sources are never
 * merged and never silently preferred beyond that order — an operator who
 * passes `--key-file` gets that file or an error, never the variable that
 * happened to be exported in their shell.
 */
export function loadKey({ root, file = null, env = process.env } = {}) {
  if (file) {
    const path = resolve(root, file);
    if (!existsSync(path)) throw preconditionError(`la clé de sauvegarde ${file} n'existe pas.`, 'Créez-la avec `shopctl backup keygen --key-file <chemin>`.');
    return { key: decodeKey(readFileSync(path, 'utf8'), file), source: file };
  }
  if (env[KEY_ENV]) return { key: decodeKey(env[KEY_ENV], KEY_ENV), source: KEY_ENV };

  const path = resolve(root, DEFAULT_KEY_FILE);
  if (existsSync(path)) return { key: decodeKey(readFileSync(path, 'utf8'), DEFAULT_KEY_FILE), source: DEFAULT_KEY_FILE };

  throw preconditionError(
    'aucune clé de sauvegarde n\'est disponible.',
    `Créez-en une avec \`shopctl backup keygen\` (elle est écrite dans ${DEFAULT_KEY_FILE}), ou posez ${KEY_ENV}. Une sauvegarde porte les commandes et les adresses des clients : elle n'est jamais écrite en clair.`,
  );
}

/**
 * Write a new key where nothing can read it but its owner.
 *
 * It is never printed, never returned to the caller and never logged — the same
 * rule provisioning applies to the secrets it generates. An existing file is
 * NOT overwritten: the key that is there is the only thing that can open the
 * archives already taken with it, and "regenerate" would destroy them silently.
 */
export function writeKeyFile(root, file) {
  const path = resolve(root, file);
  if (existsSync(path)) {
    throw preconditionError(
      `${file} existe déjà et n'est pas remplacé.`,
      'C\'est la clé qui ouvre les archives déjà prises. Pour en installer une nouvelle, déplacez celle-ci d\'abord — et gardez-la tant qu\'une archive chiffrée avec elle doit rester lisible.',
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = generateKey();
  writeFileSync(path, `${key.toString('base64')}\n`, { mode: 0o600 });
  // Written again explicitly: `mode` on writeFileSync is masked by the process
  // umask, and a key readable by the machine's other users is not a key.
  chmodSync(path, 0o600);
  return { file, keyId: keyId(key) };
}

/** True when this key is the one an archive names. Constant-time, out of habit
 *  rather than need: the identifier is public. */
export function keyMatches(key, expected) {
  const mine = Buffer.from(keyId(key), 'utf8');
  const theirs = Buffer.from(String(expected ?? ''), 'utf8');
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}

/**
 * Compress, then encrypt. In that order, and only in that order: encrypted
 * bytes do not compress, and a dump of one shop's rows is mostly repetition.
 */
export function seal(plaintext, key, aad) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const packed = gzipSync(plaintext, { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(packed), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext };
}

/**
 * Open an archive, or refuse it.
 *
 * A wrong key, an edited manifest and a corrupted body all surface here as the
 * same GCM failure, and the caller turns that into three different sentences —
 * it can tell them apart because it checked the key identifier and the
 * ciphertext digest first.
 */
export function open({ iv, tag, ciphertext }, key, aad) {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const packed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return gunzipSync(packed);
}
