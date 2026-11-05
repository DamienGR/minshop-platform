-- Migration 0056: a page drawn by a model its theme declares (ticket #205,
-- ADR 0031).
--
-- `model` is the key of one of the active theme's page models
-- (`src/themes/<id>/pageModels.ts`), or '' for « Basique », the page as it
-- always was: every existing row stays exactly what it was. A key the theme
-- no longer declares reads as « Basique » too.
--
-- `zones` is what the merchant wrote in the model's zones beside the body, as
-- one JSON object: a text zone is a string, a list an array of entries, each
-- an object of strings. It is saved in the same UPDATE as the body, so the
-- page and its media claims stay one transaction (features/pages/save.ts),
-- and the photos it shows are counted in `page_media` like the body's
-- (invariant 10). The body itself stays in `body_markdown`: the description,
-- the sitemap and the legal pages' checks read it as before.
ALTER TABLE pages ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE pages ADD COLUMN zones TEXT NOT NULL DEFAULT '{}';
