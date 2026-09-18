/** Arma CONFIG.content a partir de las Fragancia<Nombre> de constants.js. */
import {
  FraganciaRebellious,
  FraganciaForbiddenFlower,
  FraganciaWonderOfTheWorld,
  FraganciaPainkiller,
  FraganciaJaggedEdge,
  FraganciaCrimsonDesert,
  FraganciaGlitterati,
  FraganciaEcstasy,
  FraganciaEpicurean,
  FraganciaLondonLegend,
} from '@scroll/constants';
import { buildTitlePanelItems } from '@scroll/panel';
import { layoutFor, panelLineY } from '@scroll/layout';
import { ASSETS } from '@scroll/assets';
import { viewportSize } from '@scroll/viewport';

/** Todas las fragancias mapeadas, en el orden del listado original (idx 1 a 10). */
const ALL_FRAGRANCIAS = [
  FraganciaRebellious,
  FraganciaForbiddenFlower,
  FraganciaWonderOfTheWorld,
  FraganciaPainkiller,
  FraganciaJaggedEdge,
  FraganciaCrimsonDesert,
  FraganciaGlitterati,
  FraganciaEcstasy,
  FraganciaEpicurean,
  FraganciaLondonLegend,
];

/** boxClass disponibles (ver index.html), asignadas cíclicamente por orden de idx. */
const BOX_CLASSES = ['box-blue', 'box-red', 'box-green', 'box-orange', 'box-violet'];

/**
 * Fondos de imagen reales, indexados por posición (0 = primera caja); reemplazan a boxClass cuando
 * están definidos. Las URLs salen de la sección (`ASSETS.backgrounds`, ver scroll-assets.js), en el
 * mismo orden que tenía el POC: 1.jpg, BG1, BG3, BG4 (estos tres convertidos a WebP).
 */
function boxBackgrounds() {
  return ASSETS.backgrounds;
}

/**
 * La caja de prueba "Prueba — Almendra" del POC (buildAlmondTestBox, slug almond_test) se excluyó
 * de la integración al tema (pedido del usuario 2026-09-15, igual que las secciones fake). Su
 * mecanismo de imagen fija (applyAlmondTestLayout/buildFixedIngredientItem) se conserva porque lo
 * usan todas las fragancias reales (ver FIXED_INGREDIENT_IMAGE_OVERRIDES).
 */

/**
 * Fragancias REALES cuya explosión de imágenes de ingrediente (ver buildFraganciaBox) se reemplaza
 * por un único asset fijo, con el mismo mecanismo que la caja de prueba de arriba: sin traslación,
 * con fade+zoom in/out, sizeado al alto real de la botella (ver buildFixedIngredientItem,
 * applyAlmondTestLayout — reusada tal cual, es agnóstica a qué imagen le llega). El panel de título
 * + fila de ingredientes (buildTitlePanelItems) no se toca: sigue mostrando el nombre de la
 * fragancia y sus ingredientes de siempre, sólo cambia el "estallido" de imágenes de fondo.
 *
 * Pedido del usuario 2026-09-10: "En la pantalla que le corresponde a Pain Killer agrega
 * assets/ingredients/recortadas/Painkiller.png en lugar de los ingredientes que existen
 * actualmente" + lo mismo para Forbidden Flower con assets/ingredients/recortadas/ForbiddenFlower3.png.
 *
 * Clave = fragancia.nombre tal cual está escrito en constants.js (ojo: es "Painkiller", una sola
 * palabra, no "Pain Killer").
 *
 * Cada entrada puede traer, además de `image`, un `stretch: {scaleX, scaleY}` opcional (pedido del
 * usuario 2026-09-14: Painkiller.png más ancha y más alta que su tamaño normal, ajustado de nuevo el
 * 2026-09-15 para separar más los ingredientes de la botella — ver `stretch` en
 * buildFixedIngredientItem/createImageElement en styles.js). El centro sigue siendo
 * xi/yi (el centro de la página, ver applyAlmondTestLayout): al ser sólo width/height explícitos
 * sobre un elemento ya anclado con `translate(-50%, -50%)`, estirarlo no lo descentra.
 *
 * Ronda 2026-09-15: pedido del usuario de extender este mecanismo a las 8 fragancias que todavía
 * usaban la explosión de ingredientes normal. Todavía no hay arte final para ellas, así que cada
 * una apunta a un archivo placeholder (copia de Painkiller.png, nombrado como la fragancia — ver
 * los identificadores de assets/products/recortadas en constants.js líneas 17-26 para la ortografía
 * exacta de cada nombre) hasta que se suba la imagen real de cada una.
 *
 * En el tema (2026-09-15): esas 8 copias placeholder eran byte a byte el mismo archivo que
 * Painkiller.png (mismo MD5), así que no se subieron — apuntan directo a la imagen de Painkiller
 * (resultado visual idéntico). `image` ya no es una ruta sino la clave de `ASSETS.ingredients`
 * (ver scroll-assets.js), que arma la sección con `asset_url`. Cuando llegue el arte real de cada
 * fragancia: subir el archivo, sumarlo al JSON de la sección y cambiar la clave acá.
 *
 * Ronda 2026-09-18: llegó el arte final (recortado) de Painkiller, Forbidden Flower, Crimson
 * Desert, Ecstasy, Epicurean y London Legend — se subieron a assets/ y cada clave de arriba ya
 * apunta a su propia imagen. Después llegó el de Rebellious, Jagged Edge, Glitterati y Wonder of
 * the World: todas las fragancias tienen ya su arte propio.
 */
const FIXED_INGREDIENT_IMAGE_OVERRIDES = {
  Rebellious: { image: 'rebellious' },
  'Forbidden Flower': { image: 'forbidden_flower' },
  'Wonder of the World': { image: 'wonder_of_the_world' },
  Painkiller: {
    image: 'painkiller',
    stretch: { scaleX: 2, scaleY: 1.2 },
  },
  'Jagged Edge': { image: 'jagged_edge' },
  'Crimson Desert': { image: 'crimson_desert' },
  Glitterati: { image: 'glitterati' },
  Ecstasy: { image: 'ecstasy' },
  Epicurean: { image: 'epicurean' },
  'London Legend': { image: 'london_legend' },
};

/**
 * Convierte el nombre legible de una fragancia en el slug que va en la URL.
 * @param {string} nombre - Nombre legible de la fragancia.
 */
function slugify(nombre) {
  return nombre.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Coloca (o recoloca) el item del producto en el centro exacto del viewport.
 * @param {object} item - Item del producto (isProduct: true).
 * @param {object} layout - Layout de layoutFor.
 */
function applyProductLayout(item, layout) {
  item.size = layout.product.size;
  item.xi = layout.cx;
  item.yi = layout.cy;
  return item;
}

/**
 * Calcula tamaño y posición del item fijo de la caja de prueba (ver ALMOND_TEST_IMAGE).
 *
 * Pedido del usuario 2026-09-10, ronda 2: "que salga del centro de la botella, que no genere
 * traslación (por lo que el punto de inicio y el punto de llegada serán el mismo: el centro de la
 * botella)". Por eso acá xi/yi/xf/yf van directo al centro del stage — el mismo punto donde se para
 * el producto, ver applyProductLayout. Con xf===xi/yf===yi, finalOffset (styles.js) sigue dando siempre
 * {dx:0, dy:0}, así que el item sigue sin trasladarse nunca, ni al entrar ni al salir (ver
 * [[botella-giro-transicion]]/collapseIngredientsToCenter en styles.js para cómo entra/sale con
 * fade + zoom en vez de traslación).
 *
 * Sin rotación (ronda 3, ver el comentario de ALMOND_TEST_IMAGE): a diferencia de la ronda 2, no se
 * le asigna ningún `item.angle` — la imagen actual ya viene compuesta simétrica (dos grupos de
 * almendras a los costados con un hueco vacío al medio, del ancho de la botella) y rotarla
 * arruinaría ese encaje.
 *
 * Ronda 4 (mismo día, después), pedido del usuario: "necesito que el alto de la botella coincida
 * con el alto de la imagen... y el ancho que sea proporcional al alto, no la deformes" — dejó de
 * usarse el multiplicador fijo sobre el tope de ingrediente (ALMOND_TEST_SIZE_MULTIPLIER, ya no
 * existe) y ahora `item.size` guarda directamente el alto real de la botella en px:
 * `layout.product.halfH * 2` (halfH ya es la mitad de ese alto real, medido por el alfa del GLB —
 * ver PRODUCT_CONTENT_Y en layout.js — no el lado del cuadro cuadrado que ocupa su canvas). Este
 * item deja de ser cuadrado: createImageElement (styles.js) reconoce `item.testFixed` y usa este
 * `size` como ALTO del <img>, dejando el ancho en 'auto' para que el navegador lo calcule
 * proporcional al aspect ratio real de la imagen — nunca se fuerza un ancho, así no se deforma.
 * @param {object} item - Item a completar (debe traer image; se le agregan size/xi/yi/xf/yf).
 * @param {object} layout - Layout de layoutFor (layout.js).
 */
function applyAlmondTestLayout(item, layout) {
  item.size = Math.round(layout.product.halfH * 2);
  item.xi = layout.cx;
  item.yi = layout.cy;
  item.xf = layout.cx;
  item.yf = layout.cy;

  return item;
}

/**
 * Arma el único item de imagen fijo que reemplaza la explosión de ingredientes de una caja — lo usa
 * tanto la caja de prueba (con ALMOND_TEST_IMAGE) como cualquier fragancia real listada en
 * FIXED_INGREDIENT_IMAGE_OVERRIDES (ver buildFraganciaBox). applyAlmondTestLayout es agnóstica a
 * qué imagen le llega, así que no hizo falta tocarla para generalizar esto.
 * @param {string} image - Asset a mostrar en reemplazo de los ingredientes.
 * @param {object} layout - Layout de layoutFor.
 * @param {{scaleX: number, scaleY: number}} [stretch] - Estiramiento opcional por ejes, ver
 *   FIXED_INGREDIENT_IMAGE_OVERRIDES/createImageElement (styles.js).
 */
function buildFixedIngredientItem(image, layout, stretch) {
  const item = applyAlmondTestLayout({ image, testFixed: true }, layout);
  if (stretch) item.stretch = stretch;
  return item;
}

/**
 * Arma la caja completa de una fragancia: producto, panel de título + ingredientes, y el único item
 * fijo de imagen que reemplaza a los ingredientes (ver FIXED_INGREDIENT_IMAGE_OVERRIDES/
 * buildFixedIngredientItem) — todas las fragancias tienen una entrada ahí.
 * @param {object} fragancia - Entrada Fragancia<Nombre>.
 * @param {string} boxClass - Clase de fondo de la caja (ver BOX_CLASSES).
 * @param {object} layout - Layout de layoutFor.
 * @param {string} [bgImage] - Ruta de imagen de fondo (ver BOX_BACKGROUNDS); si está presente, motor.js la usa en vez de boxClass.
 */
function buildFraganciaBox(fragancia, boxClass, layout, bgImage) {
  const producto = applyProductLayout(
    { isProduct: true, animation: { effect: 'fade', when: 'enter' } },
    layout,
  );

  const display = [producto, ...buildTitlePanelItems(fragancia, layout)];
  producto.image = fragancia.fragancia;
  producto.fragranceName = fragancia.nombre;
  // Mismo slug que fragranceSlug de la caja (ver el return, más abajo): lo usa el ancla de
  // Google de prueba sobre la botella (ver bottleLinkHref en styles.js).
  producto.fragranceSlug = slugify(fragancia.nombre);

  const override = FIXED_INGREDIENT_IMAGE_OVERRIDES[fragancia.nombre];
  display.push(buildFixedIngredientItem(ASSETS.ingredients[override.image], layout, override.stretch));

  return {
    boxClass,
    bgImage,
    fragranceSlug: slugify(fragancia.nombre),
    animation: { effect: 'traslation', when: 'enter' },
    display,
  };
}

/**
 * Arma CONFIG.content: una caja por cada fragancia con imagen de producto, ordenadas por idx. Se
 * llama desde init() (motor.js), después de `loadAssets`, no al importar el módulo: necesita las
 * URLs de la sección y el viewport real.
 */
export function buildContent() {
  const { width, height } = viewportSize();
  const layout = layoutFor(width, height);
  const backgrounds = boxBackgrounds();

  return ALL_FRAGRANCIAS
    .filter((fragancia) => fragancia.fragancia !== '')
    .sort((a, b) => a.idx - b.idx)
    .map((fragancia, i) => buildFraganciaBox(
      fragancia,
      BOX_CLASSES[i % BOX_CLASSES.length],
      layout,
      backgrounds.length ? backgrounds[i % backgrounds.length] : undefined,
    ));
}

/**
 * Recalcula, sobre el contenido ya armado y sin volver a tirar ningún dado,
 * todas las posiciones y tamaños contra el viewport actual.
 * @param {Array} content - Cajas ya armadas (CONFIG.content), mutadas en el lugar.
 */
export function relayoutContent(content) {
  const { width, height } = viewportSize();
  const layout = layoutFor(width, height);

  content.forEach((box) => {
    box.display.forEach((item) => {
      if (item.isProduct) {
        applyProductLayout(item, layout);
      } else if ('panelLine' in item) {
        item.xi = layout.cx;
        item.yi = panelLineY(item.panelLine, layout);
      } else if (item.testFixed) {
        applyAlmondTestLayout(item, layout);
      }
    });
  });

  return content;
}
