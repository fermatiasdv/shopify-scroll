/**
 * Único lugar que decide la geometría de una caja: dónde va el panel de
 * texto y cuánto mide el producto.
 */

// ---------------------------------------------------------------------------
// Datos medidos de los assets (canal alfa real, no estimaciones)
// ---------------------------------------------------------------------------

/** Fracción del cuadro (no del PNG original) que ocupa la botella en el eje X, con object-fit: contain. */
export const PRODUCT_CONTENT_X = 0.378;

/** Fracción del cuadro que ocupa la botella en el eje Y. */
export const PRODUCT_CONTENT_Y = 0.984;

// ---------------------------------------------------------------------------
// Números de diseño (los que se tocan a mano)
// ---------------------------------------------------------------------------

/** Alto visible de la botella como fracción del alto del viewport, modo 'stack' (pantalla parada). */
export const PRODUCT_VIEWPORT_HEIGHT_FRACTION_STACK = 1;
/** Alto visible de la botella como fracción del alto del viewport, modo 'column' (pantalla acostada). */
export const PRODUCT_VIEWPORT_HEIGHT_FRACTION_COLUMN = 2;

/** Achica el tamaño final de la botella un 10% en modo 'stack' (mobile): se aplica DESPUÉS del
 * min(deseado, maximo) de productSize, porque en la mayoría de los viewports de celular el término
 * que gana ahí es "maximo" (el espacio libre del stage), no la fracción de arriba — tocar sólo
 * PRODUCT_VIEWPORT_HEIGHT_FRACTION_STACK no cambiaba nada en la práctica. */
const PRODUCT_MOBILE_SCALE = 0.9;

/** Margen (px) contra los bordes del viewport en modo 'stack', acotado en fracción del ancho. */
const SIDE_MARGIN_FRACTION_STACK = 0.03;
/** Margen (px) contra los bordes del viewport en modo 'column'. */
const SIDE_MARGIN_FRACTION_COLUMN = 0.045;
const SIDE_MARGIN_MIN_STACK = 6;
const SIDE_MARGIN_MIN_COLUMN = 16;
const SIDE_MARGIN_MAX = 64;

/** Separación (px) entre una banda de texto y el borde del stage. */
const BAND_GAP_PX = 16;

/** Aire extra (px), sólo en modo 'stack', entre la última línea de la lista de ingredientes y el borde inferior del viewport. */
const LIST_BOTTOM_EXTRA_PX_STACK = 28;

/** Cantidad de líneas de ingredientes del panel (siempre los 3 fijos de la fragancia). */
export const INGREDIENT_LINE_COUNT = 3;

/** Multiplicadores de alto de línea sobre el tamaño de fuente. */
const TITLE_LINE_RATIO = 1.3;
const INGREDIENT_LINE_RATIO = 1.45;

/** Fracción del ancho de viewport que da el tamaño de fuente del título, modo 'stack'. */
const TITLE_FONT_VW_FRACTION_STACK = 0.062;
/** Fracción del ancho de viewport que da el tamaño de fuente del título, modo 'column'. */
const TITLE_FONT_VW_FRACTION_COLUMN = 0.02;
const TITLE_FONT_MIN = 20;
const TITLE_FONT_MAX = 40;

/** El ingrediente es una fracción fija del título, para que escalen juntos. */
const INGREDIENT_FONT_RATIO = 0.72;

/** Ancho (px) que ocupa el título más largo por cada px de tamaño de fuente. */
const TITLE_WIDTH_PER_FONT_PX = 9.8;

/**
 * Acota un número a un rango.
 * @param {number} value - Valor a acotar.
 * @param {number} min - Mínimo.
 * @param {number} max - Máximo.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Lado (px) del cuadro de la imagen del producto para que la botella visible mida la fracción del alto del viewport que corresponda al modo.
 * @param {number} vh - Alto de viewport.
 * @param {number} stageHalfH - Semieje vertical del stage, para no desbordarlo.
 * @param {string} mode - 'stack' o 'column' (ver layoutFor).
 */
function productSize(vh, stageHalfH, mode) {
  const fraction = mode === 'stack'
    ? PRODUCT_VIEWPORT_HEIGHT_FRACTION_STACK
    : PRODUCT_VIEWPORT_HEIGHT_FRACTION_COLUMN;
  const deseado = (vh * fraction) / PRODUCT_CONTENT_Y;
  const maximo = (2 * stageHalfH) / PRODUCT_CONTENT_Y;
  const scale = mode === 'stack' ? PRODUCT_MOBILE_SCALE : 1;
  return Math.round(Math.min(deseado, maximo) * scale);
}

/**
 * Resuelve toda la geometría de una caja para un viewport dado.
 * @param {number} vw - Ancho de viewport (window.innerWidth).
 * @param {number} vh - Alto de viewport (window.innerHeight).
 */
export function layoutFor(vw, vh) {
  const cx = vw / 2;
  const cy = vh / 2;
  const mode = vw >= vh ? 'column' : 'stack';
  const sideMarginMin = mode === 'stack' ? SIDE_MARGIN_MIN_STACK : SIDE_MARGIN_MIN_COLUMN;
  const sideMarginFraction = mode === 'stack' ? SIDE_MARGIN_FRACTION_STACK : SIDE_MARGIN_FRACTION_COLUMN;
  const side = Math.round(clamp(vw * sideMarginFraction, sideMarginMin, SIDE_MARGIN_MAX));

  const textWidth = vw - 2 * side;
  const titleFontVwFraction = mode === 'stack' ? TITLE_FONT_VW_FRACTION_STACK : TITLE_FONT_VW_FRACTION_COLUMN;
  const titleFontSizePx = Math.round(Math.min(
    clamp(vw * titleFontVwFraction, TITLE_FONT_MIN, TITLE_FONT_MAX),
    textWidth / TITLE_WIDTH_PER_FONT_PX,
  ));
  const ingredientFontSizePx = Math.round(titleFontSizePx * INGREDIENT_FONT_RATIO);

  const titleLineHeightPx = Math.round(titleFontSizePx * TITLE_LINE_RATIO);
  const ingredientLineHeightPx = Math.round(ingredientFontSizePx * INGREDIENT_LINE_RATIO);
  const listHeightPx = INGREDIENT_LINE_COUNT * ingredientLineHeightPx;

  const listBottomExtra = mode === 'stack' ? LIST_BOTTOM_EXTRA_PX_STACK : 0;

  const titleY = side + titleLineHeightPx / 2;
  const listTop = vh - side - listBottomExtra - listHeightPx;
  const stageHalfH = Math.min(cy - (side + titleLineHeightPx), listTop - cy) - BAND_GAP_PX;
  const panel = { x: side, titleY, listTop, titleLineHeightPx, ingredientLineHeightPx };

  const size = productSize(vh, stageHalfH, mode);
  const product = {
    size,
    halfH: (size * PRODUCT_CONTENT_Y) / 2,
  };

  return {
    mode,
    cx,
    cy,
    side,
    product,
    panel,
    titleFontSizePx,
    ingredientFontSizePx,
  };
}

/**
 * Posición vertical (centro de la línea) de una línea del panel.
 * @param {number} lineIndex - 0 para el título, 1..INGREDIENT_LINE_COUNT para cada ingrediente de la lista.
 * @param {object} layout - Layout de layoutFor.
 */
export function panelLineY(lineIndex, layout) {
  if (lineIndex === 0) return layout.panel.titleY;
  const i = lineIndex - 1;
  return layout.panel.listTop + i * layout.panel.ingredientLineHeightPx
    + layout.panel.ingredientLineHeightPx / 2;
}
