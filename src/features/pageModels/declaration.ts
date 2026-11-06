import type {
  ThemePageField,
  ThemePageListZone,
  ThemePageModel,
  ThemePageZone,
} from '../storefront/models.ts';

/**
 * The page models a theme declares (ticket #205, ADR 0031): what a
 * declaration must look like. Pure, like the theme texts' rules
 * (features/themeTexts/slots.ts): the suite holds every theme on disk to them
 * (test/storefront/pageModels.test.ts), and a running shop keeps the models it
 * can read rather than an editor that breaks on one bad entry.
 */

/** More models than this is a site builder, not a theme. */
export const PAGE_MODELS_MAX = 20;
/** Zones of one model, its body aside. */
export const PAGE_ZONES_MAX = 20;
/** Fields of one entry of a list. */
export const PAGE_FIELDS_MAX = 10;
/** Entries a list may declare it takes. */
export const PAGE_LIST_ITEMS_MAX = 50;
/** The longest text a zone or a field may declare: a page's worth. */
export const PAGE_ZONE_MAX_LENGTH = 20_000;

/** A model's key is its template's file name, `pages/<key>.astro`. */
const MODEL_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** A zone's or a field's key is part of a form field's name,
 *  `zone.<zone>.<entry>.<field>`: letters and digits, so the dots stay
 *  separators. */
const ZONE_KEY = /^[a-z][a-zA-Z0-9]*$/;
const KEY_MAX = 40;
const LABEL_MAX = 80;
const HELP_MAX = 300;

/** The core's own model, the page as it always was: no theme may take its name. */
export const BASIC_MODEL_KEY = 'basique';

const length = (value: string) => [...value].length;

export const isListZone = (zone: ThemePageZone): zone is ThemePageListZone => 'fields' in zone;

/** Label and help, as every named thing of a declaration has them. */
function labelProblems(name: string, label: unknown, help: unknown): string[] {
  const problems: string[] = [];
  if (typeof label !== 'string' || !label.trim() || length(label) > LABEL_MAX) {
    problems.push(`${name}: the label must be a non-empty string of ${LABEL_MAX} characters at most.`);
  }
  if (help !== undefined && (typeof help !== 'string' || length(help) > HELP_MAX)) {
    problems.push(`${name}: the help must be a string of ${HELP_MAX} characters at most.`);
  }
  return problems;
}

/** A text's format and limit, a text zone's or a field's. */
function textProblems(name: string, format: unknown, maxLength: unknown): string[] {
  const problems: string[] = [];
  if (format !== 'text' && format !== 'markdown') problems.push(`${name}: the format must be "text" or "markdown".`);
  if (!Number.isInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > PAGE_ZONE_MAX_LENGTH) {
    problems.push(`${name}: maxLength must be an integer from 1 to ${PAGE_ZONE_MAX_LENGTH}.`);
  }
  return problems;
}

/** The keys of a list, each a lowercase letter then letters and digits, never twice. */
function keyProblems(name: string, key: unknown, seen: Set<string>): string[] {
  if (typeof key !== 'string' || !ZONE_KEY.test(key) || key.length > KEY_MAX) {
    return [`${name}: the key must be a lowercase letter, then letters or digits (${KEY_MAX} at most).`];
  }
  if (seen.has(key)) return [`${name} is declared twice.`];
  seen.add(key);
  return [];
}

function fieldProblems(zone: string, fields: unknown): string[] {
  if (!Array.isArray(fields) || fields.length === 0) return [`${zone}: fields must be a non-empty array.`];
  const problems: string[] = [];
  if (fields.length > PAGE_FIELDS_MAX) problems.push(`${zone}: ${fields.length} fields; ${PAGE_FIELDS_MAX} at most.`);
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    if (!field || typeof field !== 'object') {
      problems.push(`${zone}, field ${index + 1} is not an object.`);
      return;
    }
    const { key, label, help, format, maxLength } = field as Record<string, unknown>;
    const name = `${zone}, field ${typeof key === 'string' ? `"${key}"` : index + 1}`;
    problems.push(
      ...keyProblems(name, key, seen),
      ...labelProblems(name, label, help),
      ...textProblems(name, format, maxLength),
    );
  });
  return problems;
}

function zoneProblems(model: string, zones: unknown): string[] {
  if (!Array.isArray(zones)) return [`${model}: zones must be an array ([] for none).`];
  const problems: string[] = [];
  if (zones.length > PAGE_ZONES_MAX) problems.push(`${model}: ${zones.length} zones; ${PAGE_ZONES_MAX} at most.`);
  const seen = new Set<string>();
  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== 'object') {
      problems.push(`${model}, zone ${index + 1} is not an object.`);
      return;
    }
    const { key, label, help, format, maxLength, itemLabel, maxItems, fields } = zone as Record<string, unknown>;
    const name = `${model}, zone ${typeof key === 'string' ? `"${key}"` : index + 1}`;
    problems.push(...keyProblems(name, key, seen), ...labelProblems(name, label, help));
    if (fields === undefined) {
      problems.push(...textProblems(name, format, maxLength));
      return;
    }
    // A list: entries of fields. A text's own keys would mean the author
    // mixed the two shapes up.
    if (format !== undefined || maxLength !== undefined) {
      problems.push(`${name}: a list has fields, not a format or a maxLength of its own.`);
    }
    if (typeof itemLabel !== 'string' || !itemLabel.trim() || length(itemLabel) > LABEL_MAX) {
      problems.push(`${name}: itemLabel must be a non-empty string of ${LABEL_MAX} characters at most.`);
    }
    if (!Number.isInteger(maxItems) || (maxItems as number) < 1 || (maxItems as number) > PAGE_LIST_ITEMS_MAX) {
      problems.push(`${name}: maxItems must be an integer from 1 to ${PAGE_LIST_ITEMS_MAX}.`);
    }
    problems.push(...fieldProblems(name, fields));
  });
  return problems;
}

/**
 * What is wrong with a declaration, one sentence per problem, in English: the
 * reader is the theme's developer, in a failing test, not the merchant.
 */
export function pageModelProblems(declared: unknown): string[] {
  if (!Array.isArray(declared)) return ['`pageModels` must be an array of models.'];
  const problems: string[] = [];
  if (declared.length > PAGE_MODELS_MAX) problems.push(`${declared.length} models; ${PAGE_MODELS_MAX} at most.`);
  const seen = new Set<string>();
  declared.forEach((model, index) => {
    if (!model || typeof model !== 'object') {
      problems.push(`model ${index + 1} is not an object.`);
      return;
    }
    const { key, label, help, body, zones } = model as Record<string, unknown>;
    const name = typeof key === 'string' ? `"${key}"` : `model ${index + 1}`;
    if (typeof key !== 'string' || !MODEL_KEY.test(key) || key.length > KEY_MAX) {
      problems.push(`${name}: the key must be lowercase letters, digits and inner hyphens (${KEY_MAX} at most).`);
    } else if (key === BASIC_MODEL_KEY) {
      problems.push(`${name} is the core's own model; pick another key.`);
    } else if (seen.has(key)) {
      problems.push(`${name} is declared twice.`);
    } else {
      seen.add(key);
    }
    problems.push(...labelProblems(name, label, help));
    if (!body || typeof body !== 'object') {
      problems.push(`${name}: body must be an object with the label of the page's own text.`);
    } else {
      const { label: bodyLabel, help: bodyHelp } = body as Record<string, unknown>;
      problems.push(...labelProblems(`${name}, body`, bodyLabel, bodyHelp));
    }
    problems.push(...zoneProblems(name, zones));
  });
  return problems;
}

/** The models that pass, so one bad entry cannot take the others down. The
 *  suite fails on any problem; a running shop keeps what it can read. */
export function validPageModels(declared: unknown): ThemePageModel[] {
  if (!Array.isArray(declared)) return [];
  const kept: ThemePageModel[] = [];
  for (const model of declared.slice(0, PAGE_MODELS_MAX)) {
    if (pageModelProblems([model]).length > 0) continue;
    if (kept.some((other) => other.key === (model as ThemePageModel).key)) continue;
    kept.push(model as ThemePageModel);
  }
  return kept;
}

/** The model a page names, when the theme still declares it; null is « Basique ». */
export function pageModelOf(models: readonly ThemePageModel[], key: string | null | undefined): ThemePageModel | null {
  return (key && models.find((model) => model.key === key)) || null;
}

export type { ThemePageField, ThemePageListZone, ThemePageModel, ThemePageZone };
