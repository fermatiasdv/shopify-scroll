/**
 * URLs de los assets de la experiencia (modelo, etiquetas, fondos, imágenes de ingrediente).
 *
 * En el tema de Shopify las URLs de `assets/` salen del CDN con un parámetro de versión que no se
 * puede adivinar desde JS, así que las arma la sección (`sections/fragrance-scroll.liquid`, con el
 * filtro `asset_url`) en un `<script type="application/json" data-fragrance-scroll-assets>`.
 * `loadAssets` las copia acá una sola vez por init; content.js y bottle.js las leen de `ASSETS`
 * recién cuando las necesitan (nunca al importar el módulo), así que siempre ven las de la sección
 * actual.
 */

/**
 * @type {{
 *   model: string,
 *   labels: Record<string, string>,
 *   backgrounds: string[],
 *   ingredients: Record<string, string>,
 * }}
 * `labels.default` es la etiqueta de toda fragancia sin entrada propia (Painkiller, ver bottle.js).
 */
export const ASSETS = {
  model: '',
  labels: {},
  backgrounds: [],
  ingredients: {},
};

/**
 * Lee el JSON de URLs que inyecta la sección y lo vuelca en `ASSETS`.
 * @param {HTMLElement} root - Elemento raíz de la sección.
 */
export function loadAssets(root) {
  const script = root.querySelector('script[data-fragrance-scroll-assets]');
  if (!script) throw new Error('fragrance-scroll: falta el JSON de assets de la sección');
  Object.assign(ASSETS, JSON.parse(script.textContent));
}
