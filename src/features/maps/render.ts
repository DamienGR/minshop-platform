import { t } from '../i18n/index.ts';
import type { Place, PlaceError } from './place.ts';
import { TILE_SIZE, tileGrid, type Tile } from './tiles.ts';

/**
 * The HTML of a place's map (ADR 0029). Pure.
 *
 * Built from a parsed `Place`, never from the block's text, and every value a
 * merchant wrote goes through `escape()`: the page body stays Markdown with
 * `html: false` (invariant 11), and the only markup a map adds is this file's.
 *
 * No script: the tiles are images laid out by CSS (`.place-map` in base.css),
 * the place is the frame's centre, and the links open the place at
 * OpenStreetMap or Google Maps for whoever wants to move around or get
 * directions.
 */

export interface MapAttribution {
  /** Who drew the map, after the © : « les contributeurs d’OpenStreetMap ». */
  text: string;
  href: string;
}

export interface PlaceMapOptions {
  /** Where this page's tiles are served from — always the shop's own origin. */
  tileUrl: (tile: Tile) => string;
  attribution: MapAttribution;
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Six decimals is ten centimetres: enough for a door, and no float noise in a URL. */
function degrees(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function openStreetMapUrl(place: Place): string {
  const lat = degrees(place.lat);
  const lon = degrees(place.lon);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${place.zoom}/${lat}/${lon}`;
}

/** Google's documented, keyless Maps URL: a pin at the position. */
export function googleMapsUrl(place: Place): string {
  return `https://www.google.com/maps/search/?api=1&query=${degrees(place.lat)}%2C${degrees(place.lon)}`;
}

/** A map pin, drawn in the theme's brand fill with a light outline. */
const PIN =
  '<svg viewBox="0 0 24 32" aria-hidden="true" focusable="false">' +
  '<path d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 31 12 31s10.5-12 10.5-19.7C22.5 5.5 18 1 12 1z"/>' +
  '<circle cx="12" cy="11.5" r="4"/></svg>';

/**
 * `extraAttributes` is the admin preview's source map (`data-source-line`),
 * already formed by the caller from numbers.
 */
export function renderPlaceMap(place: Place, options: PlaceMapOptions, extraAttributes = ''): string {
  const grid = tileGrid(place.lat, place.lon, place.zoom);
  const cells = grid.tiles
    .map((tile) =>
      tile
        ? `<img src="${escape(options.tileUrl(tile))}" alt="" width="${TILE_SIZE}" height="${TILE_SIZE}" loading="lazy" decoding="async">`
        : '<span></span>',
    )
    .join('');
  const label = place.name ? t('map.label', { lieu: place.name }) : t('map.labelUnnamed');
  const style = `--map-cols:${grid.cols};--map-x:${-grid.offsetX}px;--map-y:${-grid.offsetY}px`;

  const caption = [
    place.name ? `<strong class="place-map__name">${escape(place.name)}</strong>` : '',
    place.address.length > 0
      ? `<span class="place-map__address">${place.address.map(escape).join('<br>')}</span>`
      : '',
    '<span class="place-map__links">' +
      `<a href="${escape(openStreetMapUrl(place))}">${escape(t('map.openStreetMap'))}</a> ` +
      `<a href="${escape(googleMapsUrl(place))}">${escape(t('map.googleMaps'))}</a>` +
      '</span>',
  ].join('');

  return (
    `<figure class="place-map"${extraAttributes}>` +
    '<div class="place-map__frame">' +
    `<div class="place-map__view" role="img" aria-label="${escape(label)}">` +
    `<div class="place-map__tiles" style="${style}">${cells}</div>` +
    `<span class="place-map__pin">${PIN}</span>` +
    '</div>' +
    `<small class="place-map__credit">© <a href="${escape(options.attribution.href)}">${escape(options.attribution.text)}</a></small>` +
    '</div>' +
    `<figcaption class="place-map__caption">${caption}</figcaption>` +
    '</figure>\n'
  );
}

/** One problem, as the admin reads it: « ligne 14 : … ». */
export function placeErrorMessage(error: PlaceError, fenceLine: number): string {
  return t('admin.pages.map.error.at', {
    ligne: fenceLine + error.line,
    probleme: t(error.key, error.params),
  });
}

/**
 * What the admin preview shows in place of a block it cannot draw. The
 * storefront shows nothing there: the save already said what is wrong.
 */
export function renderPlaceErrors(errors: PlaceError[], fenceLine: number, extraAttributes = ''): string {
  const items = errors.map((error) => `<li>${escape(placeErrorMessage(error, fenceLine))}</li>`).join('');
  return (
    `<div class="place-map-error"${extraAttributes}>` +
    `<p>${escape(t('admin.pages.map.error.heading'))}</p><ul>${items}</ul></div>\n`
  );
}
