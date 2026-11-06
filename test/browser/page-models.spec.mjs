import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { signIn } from './admin.mjs';
import { resolveTheme, themePath } from '../../scripts/themes.mjs';

/**
 * Pages drawn by a theme's model (ticket #205, ADR 0031). The unit tests hold
 * the declarations, the form and the templates to their contract; only a
 * built Worker in a browser shows the round a merchant makes: the storefront
 * drawing the model's template, the editor's zones with their own Aperçu,
 * a list reordered, extended and pruned by the form's own buttons, a switch
 * to « Basique » and back that loses nothing, and the whole page previewed
 * in a new tab without being saved.
 *
 * The witnesses are the atelier theme's (src/themes/atelier/pageModels.ts):
 * on a theme that declares them, these run; on any other they skip, the
 * seeded pages being drawn there as « Basique ». The pages are serve.mjs's,
 * so these run on the fixture store only.
 */

test.skip(REMOTE, 'les pages à modèle sont celles du jeu d’essai');
const theme = resolveTheme().id;
const witnesses = ['marque', 'points-de-vente'].every((key) =>
  existsSync(join(themePath(theme), 'pages', `${key}.astro`)),
);
test.skip(!witnesses, `le thème « ${theme} » ne déclare pas les modèles témoins`);

const EDITED = '/admin/pages/page_ed1t000000/edit';
const save = (page) => page.getByRole('button', { name: 'Enregistrer', exact: true });
/** Each entry of the list, in the editor, by its legend. */
const entries = (page) => page.locator('#zone-points > fieldset > legend');
/** The names the storefront shows, in its order. */
const shown = async (page, path) => {
  await page.goto(path);
  return page.locator('[data-page-model="points-de-vente"] section h2').allTextContents();
};

test('« La marque » montre son accroche, son histoire et ses engagements', async ({ page }) => {
  await page.goto(FIXTURE.brandPage);
  await settle(page);
  const article = page.locator('article[data-page-model="marque"]');
  await expect(article.locator('h1')).toHaveText('Notre marque');
  await expect(article).toContainText('Né à l’atelier, cousu main.');
  await expect(article).toContainText('Tout a commencé sur un établi');
  await expect(article.locator('aside strong')).toHaveText('tissé en France');
});

test('« Où nous trouver » montre ses points de vente dans l’ordre', async ({ page }) => {
  await page.goto(FIXTURE.pointsPage);
  await settle(page);
  const sections = page.locator('article[data-page-model="points-de-vente"] section');
  await expect(sections.locator('h2')).toHaveText(['Halles de Vannes', 'L’atelier']);
  await expect(sections.first()).toContainText('Place du Poids public, 56000 Vannes');
  await expect(sections.first().locator('strong')).toHaveText('Samedi');
});

test('une zone Markdown a son propre aperçu', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_marq000000/edit');
  const zone = page.locator('[data-markdown-editor]').filter({ has: page.locator('textarea[name="zone.engagements"]') });
  const preview = zone.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  await expect(preview.locator('strong')).toHaveText('tissé en France');
  await zone.locator('[data-editor]').fill('Une promesse **tenue**.');
  await expect(preview.locator('strong')).toHaveText('tenue');
  // The body's preview is its own, untouched.
  const body = page.locator('[data-markdown-editor]').filter({ has: page.locator('textarea[name="body_markdown"]') });
  await expect(body.locator('[data-preview]')).toContainText('Tout a commencé sur un établi');
  await expect(body.locator('[data-preview] strong')).toHaveCount(0);
});

test.describe('la zone répétable', () => {
  // The suite runs the projects one after the other on one store: the list
  // is edited once, on desktop, and left as it was found.
  test.beforeEach(() => test.skip(test.info().project.name !== 'desktop', 'la liste est modifiée une fois'));

  test('se range, s’allonge et se raccourcit par les boutons du formulaire', async ({ page }) => {
    await signIn(page);
    await page.goto(EDITED);
    await expect(page.locator('select[name="model"]')).toHaveValue('points-de-vente');
    await expect(entries(page)).toHaveText(['Point de vente 1 · Marché A', 'Point de vente 2 · Marché B']);

    // « Descendre » saves the page with the entry moved, and comes back to the list.
    await Promise.all([
      page.waitForURL(/[?&]saved=1#zone-points$/),
      page.locator('#zone-points > fieldset').first().getByRole('button', { name: 'Descendre' }).click(),
    ]);
    await expect(entries(page)).toHaveText(['Point de vente 1 · Marché B', 'Point de vente 2 · Marché A']);

    // The blank entry under « Ajouter » is saved with the page.
    await page.getByText(/^Ajouter\s*: Point de vente$/).click();
    await page.locator('input[name="zone.points.2.nom"]').fill('Marché C');
    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    await expect(entries(page)).toHaveCount(3);
    expect(await shown(page, '/pages/nos-marches')).toEqual(['Marché B', 'Marché A', 'Marché C']);

    // « Retirer » waits for the save. Then the list goes back to the seed.
    await page.goto(EDITED);
    await page.locator('#zone-points > fieldset').nth(2).getByLabel('Retirer à l’enregistrement').check();
    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    await Promise.all([
      page.waitForURL(/#zone-points$/),
      page.locator('#zone-points > fieldset').first().getByRole('button', { name: 'Descendre' }).click(),
    ]);
    expect(await shown(page, '/pages/nos-marches')).toEqual(['Marché A', 'Marché B']);
  });

  test('« Ajouter » ajoute plusieurs entrées, gardées au même enregistrement', async ({ page }) => {
    await signIn(page);
    await page.goto(EDITED);
    const list = page.locator('#zone-points');
    const add = list.getByRole('button', { name: 'Ajouter : Point de vente', exact: true });
    const added = list.locator('[data-zone-new]');

    // Three entries on the page, none saved yet, numbered after the two stored.
    await add.click();
    await add.click();
    await add.click();
    await expect(added.locator('legend')).toHaveText([/^Point de vente 3/, /^Point de vente 4/, /^Point de vente 5/]);

    // One taken back before the save: the others renumber on screen.
    await added.nth(1).getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(added.locator('legend')).toHaveText([/^Point de vente 3/, /^Point de vente 4/]);
    await added.nth(0).locator('input[name$=".nom"]').fill('Marché C');
    await added.nth(1).locator('input[name$=".nom"]').fill('Marché E');

    // An added entry's Markdown field is a whole editor: its toolbar works.
    const horaires = added.nth(1).locator('[data-markdown-editor]').filter({ has: page.locator('textarea[name$=".horaires"]') });
    await horaires.locator('[data-editor]').fill('Samedi');
    await horaires.locator('[data-editor]').selectText();
    await horaires.locator('[data-tool="wrap"][data-value="**"]').click();
    await expect(horaires.locator('[data-editor]')).toHaveValue('**Samedi**');

    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    await expect(entries(page)).toHaveCount(4);
    expect(await shown(page, '/pages/nos-marches')).toEqual(['Marché A', 'Marché B', 'Marché C', 'Marché E']);

    // Back to the seed.
    await page.goto(EDITED);
    for (const index of [2, 3]) {
      await page.locator('#zone-points > fieldset').nth(index).getByLabel('Retirer à l’enregistrement').check();
    }
    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    expect(await shown(page, '/pages/nos-marches')).toEqual(['Marché A', 'Marché B']);
  });

  test('passer en « Basique » et revenir ne perd rien', async ({ page }) => {
    await signIn(page);
    await page.goto(EDITED);
    const model = page.locator('select[name="model"]');
    await model.selectOption('');
    // The zones on screen are the saved model's until the save.
    await expect(page.getByText('Enregistrez pour passer à ce modèle')).toBeVisible();
    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    await expect(page.locator('#zone-points')).toHaveCount(0);
    await expect(page.locator('select[name="layout"]')).toBeVisible();
    await page.goto('/pages/nos-marches');
    await expect(page.locator('[data-page-model]')).toHaveCount(0);
    await expect(page.locator('.markdown-content')).toContainText('Les marchés de la semaine.');
    await expect(page.locator('.markdown-content')).not.toContainText('Marché A');

    await page.goto(EDITED);
    await model.selectOption('points-de-vente');
    await Promise.all([page.waitForURL(/[?&]saved=1/), save(page).click()]);
    await expect(entries(page)).toHaveText(['Point de vente 1 · Marché A', 'Point de vente 2 · Marché B']);
  });

  test('l’aperçu de la page montre le brouillon dans le thème, sans l’enregistrer', async ({ page }) => {
    await signIn(page);
    await page.goto(EDITED);
    await page.locator('input[name="zone.points.0.nom"]').fill('Brouillon');
    const [tab] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: /Aperçu de la page/ }).click(),
    ]);
    await tab.waitForLoadState('load');
    await expect(tab.getByRole('status')).toHaveText(/^Aperçu\s*: cette page n’est pas enregistrée\.$/);
    await expect(tab.locator('article[data-page-model="points-de-vente"] section h2')).toHaveText([
      'Brouillon',
      'Marché B',
    ]);
    // The shop's own header and footer, as a shopper sees them.
    await expect(tab.locator('header').first()).toBeVisible();
    await tab.close();

    // Nothing was saved, and the draft is still in the editor.
    await expect(page.locator('input[name="zone.points.0.nom"]')).toHaveValue('Brouillon');
    expect(await shown(page, '/pages/nos-marches')).toEqual(['Marché A', 'Marché B']);
  });
});
