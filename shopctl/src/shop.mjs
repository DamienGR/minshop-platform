/**
 * Which shop a command operates on, and which of its environments.
 *
 * Shared by `catalog` and `provision` rather than reimplemented in each, for
 * the reason every other duplication in this CLI is refused: two answers to
 * "which shop is this?" would eventually disagree, and both commands write.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENVIRONMENTS, discoverManifests, findManifestBySlug, loadManifest } from '../../scripts/manifest.mjs';
import { inputError, preconditionError, usageError, verificationError } from './errors.mjs';

/** The tree being operated, and the manifest that describes it. */
export function resolveShop(cwd, slug) {
  if (slug) {
    const found = findManifestBySlug(slug, { root: cwd });
    if (!found) throw inputError(`aucun manifeste pour « ${slug} » dans ${cwd}.`);
    if (found.errors.length > 0) throw verificationError(`le manifeste de « ${slug} » n'est pas valide.`, 'Lancez `shopctl config validate`.');
    return { root: cwd, manifest: found.manifest, file: found.file };
  }
  if (existsSync(resolve(cwd, 'client/client.yaml'))) {
    const loaded = loadManifest('client/client.yaml', { root: cwd });
    if (loaded.errors.length > 0) throw verificationError('le manifeste de la boutique n\'est pas valide.', 'Lancez `shopctl config validate`.');
    return { root: cwd, manifest: loaded.manifest, file: loaded.file };
  }
  // A core checkout carries the witness manifests and no shop of its own, so
  // naming one is the only unambiguous answer. Guessing would import a
  // catalogue into whichever fixture happened to sort first.
  const known = discoverManifests(cwd);
  throw preconditionError(
    `${cwd} n'est pas une boutique (pas de client/client.yaml).`,
    known.length > 0
      ? `Précisez --shop parmi les manifestes de cet arbre : ${known.join(', ')}.`
      : 'Lancez cette commande à la racine du dépôt d\'une boutique.',
  );
}

/**
 * The environment a command that touches an account must name.
 *
 * No default, ever. `--env` costs the operator eight characters and is the only
 * thing standing between "I meant staging" and a production database. The
 * commands that can run without an account (`catalog` against the local D1)
 * have their own, laxer resolver; this one is for the commands that cannot.
 */
export function requireEnvironment(value) {
  if (value === undefined) {
    throw usageError(
      '--env est obligatoire.',
      `Une boutique a deux environnements déployés : ${ENVIRONMENTS.join(' et ')}. Rien n'est deviné ici.`,
    );
  }
  if (!ENVIRONMENTS.includes(value)) {
    throw usageError(`--env « ${value} » est inconnu.`, `Environnements : ${ENVIRONMENTS.join(', ')}.`);
  }
  return value;
}
