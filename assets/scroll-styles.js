import { CONFIG, GROW_MAX } from '@scroll/config';
import { getItemPhaseBehavior } from '@scroll/helpers';
import { PRODUCT_CONTENT_X, PRODUCT_CONTENT_Y } from '@scroll/layout';
import { createBottle, releaseCanvasRenderer } from '@scroll/bottle';

// Re-exportado para que motor.js pueda consultarlo sin importar bottle.js directamente
// (ver isBottleHovered en bottle.js: true si el mouse está sobre la botella).
export { isBottleHovered } from '@scroll/bottle';

let displayLayer = null;
let currentDisplayEls = [];
let currentDisplayItems = [];
let currentDisplayAnimation = { effect: 'no', when: 'exit' };

/**
 * Canvas+botella de la caja destino, construido por adelantado y oculto (ver
 * prewarmIncomingProduct), esperando a que transitionDisplay lo revele. `item` es la referencia
 * exacta del item de "display" para el que se armó, así transitionDisplay puede confirmar que
 * sigue siendo el que hace falta antes de reusarlo.
 */
let pendingIncomingBottle = null;

/**
 * Contenedor fijo (`.fragrance-scroll-stage`, colgado del body) de TODAS las capas fijas del modo
 * activado: fondo con crossfade, overlay oscuro, capa de items y botón de cerrar.
 *
 * En el POC cada capa colgaba suelta del body con su propio z-index (2, 5, 10, 20). En Horizon eso
 * las intercala con el header (`.header-section`, z-index `--layer-menu-drawer` = 18): el header
 * quedaba por encima del overlay oscuro pero por debajo de la botella. Agrupadas en un solo
 * contenedor con z-index propio (ver el CSS de la sección), los z-index del POC pasan a ser
 * relativos a este contenedor y el modo activado tapa la página entera, header incluido, como una
 * vista a pantalla completa con su ✕. Además, al ser un solo nodo, destruir la sección lo saca
 * entero (ver disposeAll).
 */
let stageEl = null;

/** Devuelve el contenedor fijo de las capas (ver stageEl), creándolo la primera vez. */
function ensureStage() {
  if (stageEl) return stageEl;
  stageEl = document.createElement('div');
  stageEl.className = 'fragrance-scroll-stage';
  document.body.appendChild(stageEl);
  return stageEl;
}

/**
 * Mueve al contenedor fijo los nodos de las capas fijas que vienen en el markup de la sección
 * (overlay oscuro y botón de cerrar — el resto de las capas las crea este módulo).
 * @param {HTMLElement[]} nodes - Nodos a mover, en orden.
 */
export function mountStageNodes(nodes) {
  const stage = ensureStage();
  nodes.forEach((node) => {
    if (node) stage.appendChild(node);
  });
}

/** Capa fija con las dos imágenes de fondo que se cruzan (ver ensureBackgroundLayer). */
let backgroundLayer = null;
/** Los dos nodos de fondo en sí, siempre los mismos dos, se van turnando de rol (ver transitionBackground). */
let backgroundEls = [];
/** Índice (0 o 1) del nodo de backgroundEls que está mostrando la caja actual. */
let activeBackgroundIndex = 0;

/** Trayecto (px) de la entrada/salida de un item "directional" (ver finalOffset). */
const DIRECTIONAL_ENTER_OFFSET_PX = 48;

/** Demora (ms) entre el fade de una palabra y la siguiente de un item de texto (ver createLabelElement). */
const WORD_FADE_STAGGER_MS = 60;

/**
 * Duración (ms) del efecto de "vuelta al centro" de los ingredientes de imagen antes de saltar de
 * caja (ver collapseIngredientsToCenter). motor.js espera este tiempo, con la navegación
 * bloqueada, antes de hacer el salto de caja de verdad.
 */
export const COLLAPSE_TO_CENTER_MS = 500;

/**
 * La mitad de giro ENTRANTE (ver spinOverrides en transitionDisplay) usa esta MISMA
 * COLLAPSE_TO_CENTER_MS como su propia duración — a propósito, pedido explícito del usuario
 * 2026-09-10 ("quiero esa misma velocidad para cuando cambio de página"): antes duraba más
 * (el resto de un giro clásico de 2s, 1500ms) y se sentía mucho más lento que la salida. Que las
 * dos mitades duren EXACTAMENTE lo mismo no es sólo por parejo: es lo que hace que
 * easing 'in' + easing 'out' (ver bottle.js) empalmen sin discontinuidad de velocidad — ver el
 * comentario de collapseIngredientsToCenter, más abajo.
 */

/**
 * Escala de "zoom" del item fijo de la última caja (ver testFixed/ALMOND_TEST_IMAGE en content.js).
 * Pedido del usuario 2026-09-10: "No tendrá un efecto de traslación pero sí de fade in y fade out,
 * en complemento a zoom in y zoom out, respectivamente" — a diferencia de un ingrediente normal
 * (que sólo hace fade al aparecer/desaparecer, sin cambiar de tamaño), este item además arranca
 * más chico y crece hasta su tamaño normal mientras hace fade in (zoom in), y se achica desde su
 * tamaño normal hasta esta escala mientras hace fade out (zoom out) — mismo mecanismo de "grow" que
 * ya usa el transform de cualquier item (ver offsetTransform/applyDisplayState), sólo que acá se
 * pisa el valor de estado en vez de dejar que salga de item.grow (que este item no tiene). Valor
 * elegido sin pedido explícito del usuario (fácil de ajustar si no gusta): la mitad de su tamaño de
 * reposo.
 */
const TEST_ITEM_ZOOM_SCALE = 0.5;

/**
 * Indica si el item trae una posición final explícita.
 * @param {object} item - Item de "display".
 */
function hasFinalPosition(item) {
  return 'xf' in item && 'yf' in item;
}

/**
 * Ángulo en grados que hay que aplicarle al item, o undefined si no rota.
 * @param {object} item - Item de "display".
 */
function rotationAngle(item) {
  return 'image' in item ? item.angle : undefined;
}

/**
 * Cantidad de "grow" declarada en el item, o undefined si no crece.
 * @param {object} item - Item de "display".
 */
function growAmount(item) {
  return 'image' in item ? item.grow : undefined;
}

/**
 * Indica si el item es un ingrediente de imagen (no el producto): son los que deben esperar al
 * punto de reveal del giro de la botella antes de salir de atrás de ella (ver
 * revealDelayedIngredients en transitionDisplay y SPIN_REVEAL_AT_MS en bottle.js).
 * @param {object} item - Item de "display".
 */
function isIngredientImage(item) {
  return !item.isProduct && 'image' in item;
}

/**
 * Escala del punto extremo de un item que crece.
 * @param {object} item - Item de "display".
 */
function growExtreme(item) {
  const amount = growAmount(item);
  if (!amount) return 1;
  const { growScaleLinearCoeff: linear, growScaleQuadraticCoeff: quadratic } = CONFIG;
  return 1 + linear * amount + quadratic * amount * amount;
}

/** Punto de reposo del crecimiento: sin escalar. */
const GROW_REST = 1;

/**
 * Calcula el desplazamiento del punto extremo respecto del punto inicial.
 * @param {object} item - Item de "display".
 * @param {string} [direction] - 'down' si se scrolleó hacia abajo (entra desde arriba), 'up' si se scrolleó hacia arriba (entra desde abajo).
 */
function finalOffset(item, direction) {
  if (item.directional) {
    const dy = direction === 'up' ? DIRECTIONAL_ENTER_OFFSET_PX : -DIRECTIONAL_ENTER_OFFSET_PX;
    return { dx: 0, dy };
  }
  if (hasFinalPosition(item)) {
    return { dx: item.xf - item.xi, dy: item.yf - item.yi };
  }
  return { dx: 0, dy: -CONFIG.labelExitOffsetPx };
}

/**
 * Traducción base del transform: centra el item en xi/yi o, si trae anchor: 'left', lo ancla por el borde izquierdo.
 * @param {object} item - Item de "display".
 */
function anchorTransform(item) {
  return item.anchor === 'left' ? 'translate(0, -50%)' : 'translate(-50%, -50%)';
}

/**
 * Arma el valor CSS de transform que ancla el item, le aplica el desplazamiento, lo escala y lo rota.
 * @param {object} item - Item de "display" (se usa para el anclaje, ver anchorTransform).
 * @param {{dx: number, dy: number}} offset - Desplazamiento en px.
 * @param {number} grow - Escala del punto de "grow" (ver growExtreme/GROW_REST).
 * @param {number} [angle] - Ángulo de rotación en grados (ver rotationAngle).
 */
function offsetTransform(item, { dx, dy }, grow, angle) {
  const parts = [anchorTransform(item)];
  if (dx || dy) parts.push(`translate(${dx}px, ${dy}px)`);
  if (grow !== 1) parts.push(`scale(${grow})`);
  if (typeof angle === 'number') parts.push(`rotate(${angle}deg)`);
  return parts.join(' ');
}

/**
 * Escribe en el elemento el estado visual completo (opacidad y transform).
 * @param {HTMLElement} el - Elemento del item.
 * @param {object} item - Item de "display" al que pertenece el elemento.
 * @param {{opacity: number, offset: {dx: number, dy: number}, grow: number}} state - Estado a aplicar.
 * @param {number} [angle] - Ángulo de rotación en grados, o undefined.
 */
function applyDisplayState(el, item, { opacity, offset, grow }, angle) {
  el.style.opacity = String(opacity);
  el.style.transform = offsetTransform(item, offset, grow, angle);
}

/**
 * Estado de un item recién creado, antes de mostrarse.
 * @param {object} item - Item de "display" que entra.
 * @param {{effect: string, when: string}} animation - Animación de la caja que entra.
 * @param {string} [direction] - Dirección del scroll que trajo esta caja (ver finalOffset).
 */
function enteringState(item, animation, direction) {
  const { fades, translates } = getItemPhaseBehavior(item, animation, 'enter');
  return {
    opacity: fades ? 0 : 1,
    offset: translates ? finalOffset(item, direction) : { dx: 0, dy: 0 },
    grow: GROW_REST,
  };
}

/**
 * Estado de entrada de un ingrediente de imagen demorado (ver isIngredientImage): SIEMPRE en
 * opacity 0, sin importar si la animación de la caja trae "fades" (hoy las cajas usan
 * "traslation", que no lo activa — por eso los ingredientes nunca se ocultaban de verdad, sólo
 * quedaban en su punto de arranque cerca del centro, ya en opacity 1). El reveal a opacity 1 lo
 * pone visibleState (que ya la deja en 1 fijo) cuando se llama a revealDelayedIngredients.
 *
 * El item fijo de la última caja (testFixed, ver content.js) además arranca en TEST_ITEM_ZOOM_SCALE
 * en vez de en su tamaño normal, así el reveal (fade a opacity 1 + grow a 1 en visibleState) hace
 * zoom in a la vez que fade in (pedido del usuario, ver el comentario de TEST_ITEM_ZOOM_SCALE).
 * @param {object} item - Item de "display" (un ingrediente de imagen).
 * @param {{effect: string, when: string}} animation - Animación de la caja que entra.
 * @param {string} [direction] - Dirección del scroll que trajo esta caja (ver finalOffset).
 */
function delayedIngredientEnteringState(item, animation, direction) {
  const state = { ...enteringState(item, animation, direction), opacity: 0 };
  if (item.testFixed) state.grow = TEST_ITEM_ZOOM_SCALE;
  return state;
}

/**
 * Estado "en pantalla, quieto": punto inicial, opacidad total.
 * @param {object} item - Item de "display".
 * @param {{effect: string, when: string}} animation - Animación de la caja actual del item.
 */
function visibleState(item, animation) {
  return {
    opacity: 1,
    offset: { dx: 0, dy: 0 },
    grow: isAnimatedInPhase(item, animation, 'enter') ? growExtreme(item) : GROW_REST,
  };
}

/**
 * Estado al que anima un item cuando su caja deja de estar activa.
 * @param {object} item - Item de "display" que sale.
 * @param {{effect: string, when: string}} animation - Animación de la caja que sale.
 * @param {string} [direction] - Dirección del scroll (ver finalOffset).
 */
function leavingState(item, animation, direction) {
  const { fades, translates } = getItemPhaseBehavior(item, animation, 'exit');
  return {
    opacity: fades ? 0 : 1,
    offset: translates ? finalOffset(item, direction) : { dx: 0, dy: 0 },
    grow: (fades || translates) ? growExtreme(item) : GROW_REST,
  };
}

/**
 * Antes de saltar a la caja siguiente, prepara la salida de la caja actual, en paralelo, durante
 * COLLAPSE_TO_CENTER_MS: los ingredientes de imagen vuelven hacia el centro de la botella (el
 * mismo punto xf/yf que usan como arranque de su propia entrada, ver applyAlmondTestLayout en
 * content.js) con una traslación + fade a opacity 0, y la botella arranca a girar (ver el
 * comentario de spin en bottle.js) de frente hacia atrás — medio giro exacto (turns: 0.5), para
 * llegar a mostrar la etiqueta de espaldas justo cuando termina este mismo tiempo. La duración de
 * los ingredientes (COLLAPSE_TO_CENTER_MS) se fija por transition-duration inline en cada
 * elemento, sin depender de --label-transition-ms (que sigue rigiendo las demás transiciones); la
 * del giro se le pasa a spin() como durationMs, mismo valor. No toca el panel de texto: motor.js
 * llama a esto y, recién cuando termina, hace el salto de caja de verdad, que reemplaza todo el
 * contenido — estos ingredientes y esta botella incluidos, ya invisibles/de espaldas a esa altura
 * (ver spinOverrides en transitionDisplay: la botella ENTRANTE retoma desde ahí, de espaldas,
 * dando la sensación de una sola botella que nunca dejó de girar).
 *
 * El item fijo de la última caja (testFixed, ver content.js) sale distinto del resto: en vez de
 * quedarse en su tamaño normal mientras hace fade a 0, también se achica hasta TEST_ITEM_ZOOM_SCALE
 * en el mismo momento — fade out + zoom out a la vez, pedido explícito del usuario (ver el
 * comentario de TEST_ITEM_ZOOM_SCALE).
 */
export function collapseIngredientsToCenter() {
  currentDisplayEls.forEach((el, i) => {
    const item = currentDisplayItems[i];
    if (item.isProduct) {
      if (el.__bottle) el.__bottle.spin({ durationMs: COLLAPSE_TO_CENTER_MS, turns: 0.5, startYaw: 0, easing: 'in' });
      return;
    }
    if (!isIngredientImage(item)) return;
    const state = visibleState(item, currentDisplayAnimation);
    el.style.transitionDuration = `${COLLAPSE_TO_CENTER_MS}ms`;
    const grow = item.testFixed ? TEST_ITEM_ZOOM_SCALE : state.grow;
    applyDisplayState(el, item, { ...state, opacity: 0, offset: finalOffset(item), grow }, rotationAngle(item));
  });
}

/**
 * Indica si el item tiene algún efecto activo en esa fase.
 * @param {object} item - Item de "display".
 * @param {{effect: string, when: string}} animation - Animación de su caja.
 * @param {string} phase - Fase que se está por animar: 'enter' o 'exit'.
 */
function isAnimatedInPhase(item, animation, phase) {
  const { fades, translates } = getItemPhaseBehavior(item, animation, phase);
  return fades || translates;
}

/** Obliga al navegador a calcular el estilo de los elementos recién insertados. */
function flushPendingStyles() {
  void displayLayer.offsetHeight;
}

/**
 * Pinta en el nodo el fondo de una caja: imagen si trae bgImage, si no el color de boxClass (mismo
 * criterio que buildBoxes en motor.js para la caja "real" de scroll, que sigue existiendo debajo de
 * esta capa — ver el comentario de ensureBackgroundLayer). Se llama en cada transición, así que
 * limpia cualquier clase/imagen que haya quedado de la caja anterior antes de aplicar la nueva.
 * @param {HTMLElement} el - Nodo de fondo (uno de backgroundEls).
 * @param {{bgImage?: string, boxClass?: string}} entry - Caja (CONFIG.content[i]) de la que se lee el fondo.
 */
function applyBoxVisual(el, entry) {
  el.className = 'background-transition-bg';
  if (entry.bgImage) {
    el.style.backgroundImage = `url("${entry.bgImage}")`;
  } else {
    el.style.backgroundImage = '';
    el.classList.add(entry.boxClass);
  }
}

/**
 * Crea (la primera vez) la capa fija de fondo y sus dos nodos, y la deja colgada del body.
 *
 * Por qué dos nodos fijos en vez de seguir mostrando el fondo de la caja real de motor.js
 * (buildBoxes, que sigue armando esa caja con su propio bgImage/boxClass): esa caja vive en el
 * flujo normal de .gpt-container y se "revela" saltando el scroll de un golpe (window.scrollTo con
 * behavior: 'auto'), así que su cambio de fondo es, por construcción, instantáneo — no hay forma de
 * animarlo ahí sin animar el scroll real de toda la página. Esta capa, en cambio, es independiente
 * del scroll (position: fixed) y sólo tiene dos hijos que se turnan de rol (entrante/saliente) en
 * cada transición (ver transitionBackground): con eso alcanza para el crossfade, no hace falta un
 * nodo por caja. Queda por encima de la caja real (que sigue ahí, pero tapada del todo por esta
 * capa opaca) y por debajo de .background-overlay/.display-layer (ver el z-index en index.html).
 */
function ensureBackgroundLayer() {
  if (backgroundLayer) return backgroundLayer;

  backgroundLayer = document.createElement('div');
  backgroundLayer.className = 'background-transition-layer';
  backgroundLayer.setAttribute('aria-hidden', 'true');

  backgroundEls = [0, 1].map(() => {
    const el = document.createElement('div');
    el.className = 'background-transition-bg';
    backgroundLayer.appendChild(el);
    return el;
  });

  ensureStage().prepend(backgroundLayer);
  return backgroundLayer;
}

/**
 * Muestra el fondo de una caja sin animar (carga inicial o resize): mismo momento y mismo criterio
 * que setDisplayInstant para el contenido. Deja el nodo activo en opacity 1 sin transición (para no
 * ver un fade desde 0 en la primera pintada) y el otro listo, en opacity 0, para la próxima
 * transición.
 * @param {{bgImage?: string, boxClass?: string}} entry - Caja (CONFIG.content[i]) cuyo fondo mostrar.
 */
export function setBackgroundInstant(entry) {
  ensureBackgroundLayer();
  const [current, next] = backgroundEls;

  applyBoxVisual(current, entry);
  [current, next].forEach((el) => {
    el.style.transition = 'none';
  });
  current.style.opacity = '1';
  next.style.opacity = '0';

  void backgroundLayer.offsetHeight; // fuerza el reflow antes de reactivar la transición de CSS
  [current, next].forEach((el) => {
    el.style.transition = '';
  });

  activeBackgroundIndex = 0;
}

/**
 * Anima el crossfade de fondo hacia una caja nueva: el nodo que entra arranca en opacity 0 y
 * transiciona a opacity 1; en paralelo, el que estaba activo se desvanece a opacity 0 — puro fade,
 * sin desplazamiento (pedido del usuario 2026-09-10: el corrimiento tipo parallax que tenía antes
 * se sentía como un salto entre páginas; se sacó por completo, sólo queda el cruce de opacidades).
 * Los dos nodos van turnando de rol de una transición a la otra (ver activeBackgroundIndex) — no
 * hace falta crear ni sacar nodos del DOM.
 * @param {{bgImage?: string, boxClass?: string}} entry - Caja (CONFIG.content[i]) que entra.
 */
export function transitionBackground(entry) {
  ensureBackgroundLayer();

  const outgoingEl = backgroundEls[activeBackgroundIndex];
  const incomingIndex = activeBackgroundIndex === 0 ? 1 : 0;
  const incomingEl = backgroundEls[incomingIndex];

  applyBoxVisual(incomingEl, entry);
  incomingEl.style.transition = 'none';
  incomingEl.style.opacity = '0';

  void backgroundLayer.offsetHeight; // fuerza el reflow del punto de arranque antes de animar

  incomingEl.style.transition = '';
  incomingEl.style.opacity = '1';

  outgoingEl.style.opacity = '0';

  activeBackgroundIndex = incomingIndex;
}

/** Devuelve la capa fija donde viven los items, creándola la primera vez. */
function ensureDisplayLayer() {
  if (displayLayer) return displayLayer;

  displayLayer = document.createElement('div');
  displayLayer.className = 'display-layer';
  displayLayer.setAttribute('aria-hidden', 'true');
  ensureStage().appendChild(displayLayer);

  return displayLayer;
}

/**
 * Fija el punto inicial del item en el DOM.
 * @param {HTMLElement} el - Elemento del item.
 * @param {object} item - Item de "display", del que se leen xi e yi.
 */
function positionDisplayEl(el, item) {
  el.style.left = `${item.xi}px`;
  el.style.top = `${item.yi}px`;
}

/**
 * Crea el nodo de un item de texto.
 * @param {object} item - Item de "display", del que se leen labelText y variant.
 */
function createLabelElement(item) {
  const el = document.createElement('span');
  el.className = 'display-item display-label';
  if (item.variant) el.classList.add(`display-label-${item.variant}`);

  item.labelText.split(' ').forEach((word, i) => {
    if (i > 0) el.appendChild(document.createTextNode(' '));
    const wordEl = document.createElement('span');
    wordEl.className = 'display-label-word';
    wordEl.style.transitionDelay = `${i * WORD_FADE_STAGGER_MS}ms`;
    wordEl.textContent = word;
    el.appendChild(wordEl);
  });

  return el;
}

/**
 * Pone en opacity 1 las palabras (ver createLabelElement) de un item de texto, para que aparezcan.
 * @param {HTMLElement} el - Elemento del item (el que devuelve createDisplayElement).
 */
function revealWords(el) {
  el.querySelectorAll('.display-label-word').forEach((wordEl) => {
    wordEl.style.opacity = '1';
  });
}

/** z-index por encima del que puede alcanzar cualquier ingrediente por "grow" (ver stackOrder). */
const PRODUCT_STACK_ORDER = GROW_MAX * 100 + 1000;

/**
 * z-index de un item: el producto (isProduct: true) siempre va al frente; el resto sigue su "grow".
 * @param {object} item - Item de "display".
 */
function stackOrder(item) {
  if (item.isProduct) return PRODUCT_STACK_ORDER;
  const amount = growAmount(item);
  return amount ? Math.round(amount * 100) : 0;
}

/**
 * Aspect ratio (naturalWidth/naturalHeight) ya conocido de una imagen `stretch` (ver
 * FIXED_INGREDIENT_IMAGE_OVERRIDES en content.js), por URL — sólo tiene entradas para las que
 * `preloadStretchImages` ya terminó de precargar. Ver el comentario de esa función para el porqué.
 */
const naturalRatioCache = new Map();

/**
 * Precarga, apenas se arma CONFIG.content (llamada desde init() en motor.js, antes de que el
 * usuario pueda llegar a ninguna caja), el aspect ratio real de cada imagen `stretch` que va a
 * necesitar createImageElement — hoy sólo la de Painkiller (ver FIXED_INGREDIENT_IMAGE_OVERRIDES).
 *
 * Por qué hace falta: ese aspect ratio (naturalWidth/naturalHeight) es lo único que falta para
 * calcular el ancho final del item (`item.size * naturalRatio * scaleX`, ver createImageElement) y
 * sólo se conoce cuando el navegador termina de decodificar la imagen. Sin este preload, esa espera
 * caía en el propio `<img>` que el usuario está viendo entrar (evento 'load' de ESE elemento,
 * creado recién al llegar a la caja): como el fade-in del item arranca en el mismo instante en que
 * se crea el elemento (ver delayedIngredientEnteringState/transitionDisplay), sin esperar a nada,
 * el 'load' terminaba disparando SIEMPRE después de que el fade ya había arrancado — se veía el
 * ingrediente aparecer angosto (el `width: auto` de reposo, antes de conocer el aspect ratio) y de
 * golpe saltar a su ancho estirado real a mitad de la animación. Precargando acá, contra una imagen
 * de sondeo separada que nadie muestra, el aspect ratio casi siempre ya está en el cache cuando el
 * usuario llega a esa caja (aunque sea la primera vez, incluso por deep link) y createImageElement
 * lo aplica de una, sin depender de ningún evento async en el elemento real.
 * @param {Array} content - CONFIG.content (motor.js), ya armado.
 */
export function preloadStretchImages(content) {
  content.forEach((entry) => {
    entry.display.forEach((item) => {
      if (!item.testFixed || !item.stretch || naturalRatioCache.has(item.image)) return;
      const probe = new Image();
      probe.addEventListener('load', () => {
        if (probe.naturalWidth && probe.naturalHeight) {
          naturalRatioCache.set(item.image, probe.naturalWidth / probe.naturalHeight);
        }
      }, { once: true });
      probe.src = item.image;
    });
  });
}

/**
 * Crea el nodo de un item de imagen (ingredientes; el producto usa createProductCanvasElement).
 *
 * Un ingrediente normal fuerza un cuadro cuadrado (width === height === item.size): con
 * object-fit: contain (ver .display-image en index.html) eso no lo deforma, sólo lo deja
 * "flotando" dentro de ese cuadro. El item fijo de la última caja (testFixed, ver content.js) es
 * distinto desde 2026-09-10 (pedido del usuario: "necesito que el alto de la botella coincida con
 * el alto de la imagen... y el ancho que sea proporcional al alto, no la deformes"): acá `item.size`
 * ya viene calculado en content.js como el alto real de la botella, no el lado de un cuadro, así que
 * sólo se fija `height` y se deja `width: auto` — el navegador calcula el ancho proporcional al
 * aspect ratio real de la imagen, nunca se fuerzan las dos dimensiones a la vez, así que no hay
 * forma de que se deforme. `max-width`/`max-height` (pensados para ingredientes normales, 40vw/40vh)
 * se pisan a `none` porque el alto real de la botella puede superar esos topes a propósito (llega a
 * ocupar el 100% del alto del viewport en modo 'stack', ver PRODUCT_VIEWPORT_HEIGHT_FRACTION_STACK
 * en layout.js).
 * @param {object} item - Item de "display", del que se leen image y size.
 */
function createImageElement(item) {
  const el = document.createElement('img');
  el.className = 'display-item display-image';
  el.src = item.image;
  el.alt = '';
  if (item.testFixed) {
    if ('size' in item) {
      el.style.height = `${item.size}px`;
      el.style.width = 'auto';
      el.style.maxWidth = 'none';
      el.style.maxHeight = 'none';
    }
    if (item.stretch && 'size' in item) {
      // positionDisplayEl (xi/yi = centro de la página acá) + translate(-50%, -50%) en el CSS
      // mantienen el centro sin importar el ancho. El alto (scaleY) no depende de la imagen, se fija
      // ya mismo; el ancho (scaleX) si ya está precargado (ver naturalRatioCache/
      // preloadStretchImages, el caso normal) se fija acá también, de una, sin salto — si por lo que
      // sea todavía no está (primerísima carga de la sección, más rápida que el preload), cae al
      // 'load' de este mismo elemento como red de contención, igual que antes.
      const { scaleX = 1, scaleY = 1 } = item.stretch;
      el.style.height = `${item.size * scaleY}px`;
      const cachedRatio = naturalRatioCache.get(item.image);
      if (cachedRatio) {
        el.style.width = `${item.size * cachedRatio * scaleX}px`;
      } else {
        el.addEventListener('load', () => {
          if (!el.naturalWidth || !el.naturalHeight) return;
          const naturalRatio = el.naturalWidth / el.naturalHeight;
          naturalRatioCache.set(item.image, naturalRatio);
          el.style.width = `${item.size * naturalRatio * scaleX}px`;
        }, { once: true });
      }
    }
  } else if ('size' in item) {
    el.style.width = `${item.size}px`;
    el.style.height = `${item.size}px`;
  }
  const zIndex = stackOrder(item);
  if (zIndex) el.style.zIndex = String(zIndex);
  return el;
}

/**
 * Crea el nodo del producto: un <canvas> con la botella 3D (three.js), en vez del <img> de antes.
 * La botella es un modelo GLB real (assets/models/bottle.glb, cargado una sola vez y clonado por
 * caja), ver scripts/bottle.js. El tamaño del cuadro lo sigue decidiendo layout.js (`item.size`) y
 * la botella se calibra contra PRODUCT_CONTENT_X/Y (midiendo la caja del propio GLB), así que mide
 * lo mismo que layout.js cree que mide para repartirle el lugar a los ingredientes.
 *
 * Apenas se crea el nodo arranca la rotación: por defecto (carga inicial/resize, ver
 * setDisplayInstant) una vuelta entera de frente a frente en ~2 segundos y después queda quieta
 * (no hay loop permanente). En una transición de caja (ver transitionDisplay) el giro es otro: ver
 * spinOverrides, más abajo.
 *
 * El control de three.js queda colgado del nodo en `__bottle` para poder liberarlo cuando el nodo
 * sale del DOM (ver removeDisplayEl): sin eso, cada caja deja un contexto WebGL vivo.
 * @param {object} item - Item del producto (isProduct: true), del que se leen size y fragranceName.
 * @param {Function} [onSpinComplete] - Se llama al 80% del giro (ver bottle.js,
 *   spin/onReveal/SPIN_REVEAL_FRACTION), no cuando termina del todo: la botella todavía sigue
 *   girando ese último tramo. Lo usa transitionDisplay para recién ahí dejar salir a los
 *   ingredientes de atrás de la botella (ver isIngredientImage/revealDelayedIngredients); no se
 *   pasa nada en setDisplayInstant, que no anima ninguna entrada.
 * @param {object} [spinOverrides] - Pisa las opciones por defecto de spin() (ver bottle.js):
 *   transitionDisplay pasa acá `{ startYaw: Math.PI, turns: 0.5, durationMs: COLLAPSE_TO_CENTER_MS,
 *   easing: 'out' }` para que la botella ENTRANTE de una transición de caja aparezca YA de espaldas
 *   (sin fade-in, ver transitionDisplay) y sólo termine de girar lo que le falta hasta quedar de
 *   frente, a la MISMA duración y a juego de velocidad con la mitad que ya hizo la saliente (ver
 *   collapseIngredientsToCenter, easing 'in' ahí). setDisplayInstant no pasa
 *   nada acá, así que usa los defaults de spin() (el giro clásico completo).
 */
/**
 * Destino del ancla sobre la botella, o `null` si todavía no hay ninguno.
 *
 * En el POC era un link de prueba a google.com/?fragrance=<slug> (pedido del usuario 2026-09-11).
 * En el tema se desactiva hasta que existan los productos (decisión del usuario 2026-09-15): sin
 * `href`, el `<a>` no navega ni recibe foco, pero sigue recibiendo el mouse para la inclinación con
 * flechas (ver bottle.js).
 * TODO(fase siguiente): apuntar al producto real, por ejemplo `/products/<handle>` (el handle
 * podría coincidir con item.fragranceSlug), o a un "add to cart", cuando las fragancias sean
 * productos de Shopify.
 * @param {object} item - Item del producto (isProduct: true).
 */
// eslint-disable-next-line no-unused-vars
function bottleLinkHref(item) {
  return null;
}

/**
 * Pool de elementos `<canvas>` del producto (three.js), para que `createBottle` (bottle.js) pueda
 * reusar el mismo WebGLRenderer/environment entre botellas en vez de crear+destruir un contexto
 * WebGL por cada cambio de caja — ver `canvasRendererCache` en bottle.js y
 * rendimiento_botella_webgl.md en la memoria del proyecto para el porqué (ese recreo por caja es
 * la causa identificada del delay de 2-3s que reportó el usuario al scrollear).
 *
 * Tope 2: los únicos casos donde hace falta más de UNA botella viva a la vez son "saliente todavía
 * visible + prewarm entrante oculto" durante una transición (goToIndex en motor.js) — nunca más de
 * dos. Si en algún momento hiciera falta liberar una tercera a la vez (no debería, pero por las
 * dudas), `releaseProductCanvas` devuelve `false` y el caller la dispone de verdad en vez de
 * pool-earla, así que el tope nunca se pasa.
 */
const PRODUCT_CANVAS_POOL_SIZE = 2;
const productCanvasPool = [];

/** Saca un `<canvas>` del pool si hay uno libre, o crea uno nuevo (primera vez que hace falta). */
function acquireProductCanvas() {
  return productCanvasPool.pop() || document.createElement('canvas');
}

/**
 * Devuelve `canvas` al pool para la próxima botella, si hay lugar. Lo desconecta del DOM (donde
 * sea que estuviera) para que quede libre para el próximo `appendChild` sin arrastrar su wrapper
 * viejo. Devuelve true si quedó pooleado (el caller no debe disponer su renderer/contexto) o false
 * si el pool ya estaba lleno (el caller debe disponerlo de verdad).
 * @param {HTMLCanvasElement} canvas
 */
function releaseProductCanvas(canvas) {
  canvas.remove();
  if (productCanvasPool.length < PRODUCT_CANVAS_POOL_SIZE) {
    productCanvasPool.push(canvas);
    return true;
  }
  return false;
}

/**
 * Arma el `<a>` que envuelve el `<canvas>` de la botella: el `<a>` es el que lleva las clases de
 * posicionamiento (display-item/display-image/display-image-product) y el tamaño (item.size), el
 * canvas simplemente lo llena. Lo usan tanto createProductCanvasElement como
 * prewarmIncomingProduct (que arma el mismo canvas por adelantado, ver ese archivo) — factoreado
 * acá para no repetir el wiring del link en los dos lugares. El `<canvas>` en sí sale de
 * acquireProductCanvas (pool, ver arriba), no de un `document.createElement` directo.
 * @param {object} item - Item del producto (isProduct: true), del que se leen size/fragranceSlug.
 * @returns {{wrapper: HTMLAnchorElement, canvas: HTMLCanvasElement}}
 */
function createProductLinkedCanvas(item) {
  const canvas = acquireProductCanvas();
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const wrapper = document.createElement('a');
  wrapper.className = 'display-item display-image display-image-product';
  const href = bottleLinkHref(item);
  if (href) {
    wrapper.href = href;
    wrapper.setAttribute('aria-label', item.fragranceName || '');
  }
  wrapper.appendChild(canvas);

  if ('size' in item) {
    wrapper.style.width = `${item.size}px`;
    wrapper.style.height = `${item.size}px`;
  }

  return { wrapper, canvas };
}

function createProductCanvasElement(item, onSpinComplete, spinOverrides) {
  const { wrapper, canvas } = createProductLinkedCanvas(item);
  if ('size' in item) {
    wrapper.__bottle = createBottle(canvas, {
      size: Math.round(item.size),
      height: PRODUCT_CONTENT_Y * 2,
      maxRadius: PRODUCT_CONTENT_X,
      fragranceName: item.fragranceName,
      fragranceSlug: item.fragranceSlug,
    });
    wrapper.__bottle.spin({ onReveal: onSpinComplete, ...spinOverrides });
  }
  const zIndex = stackOrder(item);
  if (zIndex) wrapper.style.zIndex = String(zIndex);
  return wrapper;
}

/**
 * Como createProductCanvasElement, pero sin animar el armado de la botella: en vez de darle la
 * vuelta clásica de ~2s (spin()), la deja de frente de una (setYaw(0) — el mismo ángulo de reposo
 * al que termina esa vuelta clásica, ver el comentario de startYaw en bottle.js). La usa
 * setDisplayStatic (pedido del usuario 2026-09-13: modo "sin animación" del overlay "Show
 * fragancies", ver animationsEnabled en motor.js) para que ni siquiera la carga inicial de una caja
 * anime nada mientras el overlay está activo.
 * @param {object} item - Item del producto (isProduct: true).
 */
function createStaticProductCanvasElement(item) {
  const { wrapper, canvas } = createProductLinkedCanvas(item);
  if ('size' in item) {
    wrapper.__bottle = createBottle(canvas, {
      size: Math.round(item.size),
      height: PRODUCT_CONTENT_Y * 2,
      maxRadius: PRODUCT_CONTENT_X,
      fragranceName: item.fragranceName,
      fragranceSlug: item.fragranceSlug,
    });
    wrapper.__bottle.setYaw(0);
  }
  const zIndex = stackOrder(item);
  if (zIndex) wrapper.style.zIndex = String(zIndex);
  return wrapper;
}

/**
 * Saca un nodo de "display" del DOM liberando lo que tenga colgado. Hoy sólo el producto necesita
 * esto (su canvas tiene un contexto WebGL, más las geometrías y texturas de la botella), pero
 * todos los nodos salen por acá para no tener que acordarse de cuál es cuál.
 *
 * El canvas del producto se OCULTA (visibility:hidden) ANTES de tirar el contexto WebGL, no
 * después: en algunos navegadores/GPU (Chrome+ANGLE en Windows, por ejemplo) perder un contexto
 * WebGL recién creado es asíncrono por dentro (el driver tarda un instante en invalidar el
 * back-buffer), y si eso coincide con un repintado del compositor, ese frame de transición puede
 * pintarse como un cuadrado sólido BLANCO — el tamaño exacto del canvas del producto, que es
 * siempre cuadrado (size x size) — aunque el nodo se saque del DOM en el mismo tick de JS. Pasa
 * sobre todo scrolleando rápido dos veces seguidas o antes de que la botella termine de girar,
 * porque ahí se crea y se descarta un canvas nuevo mientras el anterior recién se está
 * descartando. `visibility` no es una de las propiedades que anima la transición CSS de
 * `.display-item` (sólo opacity/transform), así que ocultarlo así es instantáneo, no un fade: para
 * cuando el contexto se pierde de verdad, el elemento ya es invisible, y el `el.remove()` de abajo
 * lo saca del todo enseguida después.
 *
 * Desde el pool de canvases del producto (ver acquireProductCanvas/releaseProductCanvas más
 * arriba): si hay lugar en el pool, el `<canvas>` de esta botella se guarda para la próxima en vez
 * de perderse, y `dispose({ keepAlive: true })` dejar vivo su renderer/contexto WebGL (ver
 * bottle.js) — el aviso de más arriba sobre el "cuadrado blanco" NO aplica en ese caso: ahí no se
 * pierde ningún contexto (sigue siendo el mismo, sólo se oculta y se desconecta del DOM), así que
 * ocultarlo antes es sólo prolijidad, no evita ningún bug. El pooleo sólo pasa si hay lugar
 * (`releaseProductCanvas` devuelve false si no) — si no, se dispone de verdad, comportamiento de
 * siempre.
 * @param {HTMLElement} el - Nodo a sacar.
 */
function removeDisplayEl(el) {
  if (el.__bottle) {
    el.style.visibility = 'hidden';
    const canvas = el.querySelector('canvas');
    const pooled = canvas ? releaseProductCanvas(canvas) : false;
    el.__bottle.dispose({ keepAlive: pooled });
    el.__bottle = null;
  }
  el.remove();
}

/**
 * Elige qué nodo crear según el tipo del item.
 * @param {object} item - Item de "display" con labelText o image, nunca ambos. El producto trae
 * `image` (todavía, para cuando se conecte three.js) pero se ignora acá: ver createProductCanvasElement.
 * @param {Function} [onSpinComplete] - Sólo se usa si el item es el producto (ver createProductCanvasElement).
 * @param {object} [spinOverrides] - Sólo se usa si el item es el producto (ver createProductCanvasElement).
 */
function createDisplayElement(item, onSpinComplete, spinOverrides) {
  const hasLabel = 'labelText' in item;
  const hasImage = 'image' in item;
  if (hasLabel && hasImage) {
    throw new Error('Un item de "display" no puede tener labelText e image a la vez');
  }
  if (item.isProduct) return createProductCanvasElement(item, onSpinComplete, spinOverrides);
  if (hasImage) return createImageElement(item);
  if (hasLabel) return createLabelElement(item);
  throw new Error('Un item de "display" necesita labelText o image');
}

/** Descarta un prewarm pendiente sin usar (ver prewarmIncomingProduct), liberando su contexto WebGL. */
function disposePendingIncomingBottle() {
  if (!pendingIncomingBottle) return;
  removeDisplayEl(pendingIncomingBottle.el);
  pendingIncomingBottle = null;
}

/**
 * Arranca a construir, oculto, el canvas+botella three.js de la caja destino de una transición,
 * ANTES de que transitionDisplay llegue a mostrarlo. Por qué: crear el WebGLRenderer, cocinar el
 * environment (PMREM) y compilar por primera vez los shaders del vidrio/etiqueta (ver createBottle
 * en bottle.js) es trabajo síncrono relativamente caro — nada grave en la carga inicial, pero si
 * ese costo cae justo en el instante del corte de caja (que es cuando createProductCanvasElement se
 * llamaba históricamente), bloquea el hilo principal justo en la mitad del giro de la botella y se
 * siente como un frenazo, aunque la animación en sí (startYaw/easing, ver collapseIngredientsToCenter
 * y transitionDisplay) esté perfectamente empalmada. Esta función se llama desde goToIndex en
 * motor.js al mismo tiempo que collapseIngredientsToCenter, así ese costo queda absorbido durante
 * los mismos COLLAPSE_TO_CENTER_MS que ya tienen los ingredientes para volver al centro — para
 * cuando transitionDisplay arranca de verdad el giro de entrada, el modelo ya está clonado, el
 * environment ya está cocinado y el primer draw() (el que compila shaders) ya se hizo, así que
 * spin() sólo tiene que actualizar rotation.y cuadro a cuadro, sin trabajo pesado de por medio.
 *
 * El canvas queda oculto (visibility: hidden, mismo criterio que removeDisplayEl para ocultar sin
 * animar) e insertado en displayLayer, ya en la posición final que le toca (positionDisplayEl), y
 * ya apuntando para atrás (setYaw(Math.PI): ver transitionDisplay, que arranca desde ahí el medio
 * giro que falta) — así el primer draw() que compila shaders ya renderiza el ángulo correcto, no
 * hace falta un segundo draw() para corregirlo. transitionDisplay lo reconoce por identidad
 * (pendingIncomingBottle.item === item) y lo reusa en vez de crear un canvas nuevo; si por lo que
 * sea no coincide (o no lo usó nadie: resize/rebuild en medio de una transición, caso raro pero
 * posible), lo descarta él mismo (ver disposePendingIncomingBottle) para no dejar un contexto WebGL
 * vivo sin dueño.
 * @param {Array<object>} display - Items de la caja destino (entry.display en motor.js).
 */
export function prewarmIncomingProduct(display) {
  disposePendingIncomingBottle();
  const item = display.find((entry) => entry.isProduct);
  if (!item || !('size' in item)) return;

  ensureDisplayLayer();
  const { wrapper: el, canvas } = createProductLinkedCanvas(item);
  el.style.visibility = 'hidden';
  positionDisplayEl(el, item);
  const zIndex = stackOrder(item);
  if (zIndex) el.style.zIndex = String(zIndex);

  el.__bottle = createBottle(canvas, {
    size: Math.round(item.size),
    height: PRODUCT_CONTENT_Y * 2,
    maxRadius: PRODUCT_CONTENT_X,
    fragranceName: item.fragranceName,
    fragranceSlug: item.fragranceSlug,
  });
  el.__bottle.setYaw(Math.PI);

  displayLayer.appendChild(el);
  pendingIncomingBottle = { el, item };
}

/**
 * Muestra un set de items sin animar (carga inicial o resize): el producto y el panel de título +
 * ingredientes (texto) van directo al estado visible, sin fade ni traslación de entrada.
 *
 * Los ingredientes de imagen son la excepción, y tienen que seguir siendo una excepción acá
 * también: si fueran directo al estado visible como el resto, se verían en la escena desde el
 * primer frame de la carga de la página, en vez de esperar tapados por la botella a que su giro
 * de entrada llegue al punto de reveal — exactamente el mismo mecanismo con el que ya entran en
 * cada cambio de caja (ver transitionDisplay/isIngredientImage/delayedIngredientEnteringState/
 * revealDelayedIngredients, más abajo). Sin esto, la carga inicial (y cualquier resize, que
 * también pasa por acá) se veía distinta del resto de las cajas: "aparecían en la escena desde el
 * momento 1", en vez de salir de atrás de la botella como en toda transición normal.
 * @param {Array<object>} display - Items a mostrar.
 * @param {{effect: string, when: string}} animation - Animación de la caja, que se guarda para su salida.
 */
export function setDisplayInstant(display, animation) {
  ensureDisplayLayer();
  disposePendingIncomingBottle(); // por si un resize cae en medio de una transición (caso raro)
  currentDisplayEls.forEach(removeDisplayEl);

  // Mismo patrón que transitionDisplay: ver el comentario de revealDelayedIngredients ahí.
  const delayedIngredients = [];
  const revealDelayedIngredients = () => {
    delayedIngredients.forEach(({ el, item }) => {
      if (!currentDisplayEls.includes(el)) return;
      applyDisplayState(el, item, visibleState(item, animation), rotationAngle(item));
      revealWords(el);
    });
  };

  currentDisplayEls = display.map((item) => {
    const el = item.isProduct
      ? createDisplayElement(item, revealDelayedIngredients)
      : createDisplayElement(item);
    positionDisplayEl(el, item);
    if (isIngredientImage(item)) {
      applyDisplayState(el, item, delayedIngredientEnteringState(item, animation), rotationAngle(item));
      delayedIngredients.push({ el, item });
    } else {
      applyDisplayState(el, item, visibleState(item, animation), rotationAngle(item));
      revealWords(el);
    }
    displayLayer.appendChild(el);
    return el;
  });
  currentDisplayItems = display;
  currentDisplayAnimation = animation;
}

/**
 * Muestra un set de items totalmente estático: a diferencia de setDisplayInstant, ni siquiera la
 * botella anima su armado (usa createStaticProductCanvasElement, sin spin) y los ingredientes de
 * imagen NO esperan tapados a ningún reveal — todos los items, sin excepción, van directo a su
 * estado final visible, de una.
 *
 * La usa motor.js mientras el overlay "Show fragancies" está activo (pedido del usuario
 * 2026-09-13, ver animationsEnabled ahí): con las animaciones apagadas, cada caja tiene que
 * mostrarse sin ninguna animación (ni de transición entre cajas, ni de armado de la botella, ni de
 * reveal de ingredientes) para poder scrollear libremente entre fragancias sin esperar nada.
 * @param {Array<object>} display - Items a mostrar.
 * @param {{effect: string, when: string}} animation - Animación de la caja, que se guarda para su salida (por si se reactivan las animaciones).
 */
export function setDisplayStatic(display, animation) {
  ensureDisplayLayer();
  disposePendingIncomingBottle();
  currentDisplayEls.forEach(removeDisplayEl);

  currentDisplayEls = display.map((item) => {
    const el = item.isProduct ? createStaticProductCanvasElement(item) : createDisplayElement(item);
    positionDisplayEl(el, item);
    applyDisplayState(el, item, visibleState(item, animation), rotationAngle(item));
    revealWords(el);
    displayLayer.appendChild(el);
    return el;
  });
  currentDisplayItems = display;
  currentDisplayAnimation = animation;
}

/**
 * Vacía la capa fija de contenido (`.display-layer`) sin poner nada en su lugar, disponiendo
 * correctamente cualquier botella three.js que haya quedado (mismo `removeDisplayEl` que usan
 * setDisplayInstant/setDisplayStatic/transitionDisplay). La usa motor.js al pasar a modo
 * DESACTIVADO (pedido del usuario 2026-09-14/15, ver setAnimationsEnabled y
 * renderCollapsedEntry/disposeCollapsedEntry más abajo): en ese modo la capa fija no se usa para
 * nada (el contenido de la única caja colapsada vive en el flujo normal del documento, no acá), así
 * que hay que limpiar lo que haya quedado de una sesión anterior de modo activado en vez de dejarlo
 * vivo (y su contexto WebGL) sin dueño.
 */
export function disposeDisplay() {
  disposePendingIncomingBottle();
  currentDisplayEls.forEach(removeDisplayEl);
  currentDisplayEls = [];
  currentDisplayItems = [];
}

/** Overlay oscuro y capa de items de la caja colapsada (ver renderCollapsedEntry) actualmente en el DOM, o null si no hay ninguna. */
let collapsedOverlayEl = null;
let collapsedContentEl = null;

/**
 * Descarta la caja colapsada actualmente renderizada (si hay una), disponiendo correctamente
 * cualquier botella three.js que tuviera adentro. La llama tanto `renderCollapsedEntry` (antes de
 * pintar una fragancia nueva encima) como motor.js (antes de reconstruir `.gpt-container` con
 * `container.innerHTML = ''`, ya sea para pasar a modo activado o para reconstruir el grupo
 * colapsado en un resize) — sin esto, limpiar el contenedor a mano perdería el contexto WebGL de la
 * botella sin llamar a `dispose()`, exactamente el problema que `removeDisplayEl` existe para
 * evitar en la capa fija (ver ese comentario).
 */
export function disposeCollapsedEntry() {
  if (collapsedContentEl) {
    Array.from(collapsedContentEl.children).forEach(removeDisplayEl);
    collapsedContentEl.remove();
    collapsedContentEl = null;
  }
  if (collapsedOverlayEl) {
    collapsedOverlayEl.remove();
    collapsedOverlayEl = null;
  }
}

/**
 * Deja este módulo como recién importado: descarta el contenido de la capa fija y de la caja
 * colapsada, libera los contextos WebGL que esperaban en el pool de canvases, y saca del DOM el
 * contenedor fijo entero (ver stageEl). La llama `destroy()` (motor.js) cuando la sección sale del
 * DOM — en el editor de temas pasa cada vez que se edita la sección, y un init nuevo arranca
 * después sobre el markup nuevo.
 */
export function disposeAll() {
  disposeDisplay();
  disposeCollapsedEntry();
  productCanvasPool.splice(0).forEach(releaseCanvasRenderer);
  stageEl?.remove();
  stageEl = null;
  displayLayer = null;
  backgroundLayer = null;
  backgroundEls = [];
  activeBackgroundIndex = 0;
  currentDisplayAnimation = { effect: 'no', when: 'exit' };
}

/**
 * True si `item` es la imagen fija que reemplaza a los ingredientes (`testFixed`, ver
 * FIXED_INGREDIENT_IMAGE_OVERRIDES en content.js) o la fila de texto del panel que lista los
 * nombres de ingrediente (`variant: 'ingredient'`, ver panel.js).
 * Usado por `renderCollapsedEntry` para excluir estos items en modo desactivado (pedido del
 * usuario 2026-09-14: "no se deben mostrar los ingredientes") — el producto (`isProduct`) y el
 * título (`variant: 'title'`) NO son ingredientes y siguen mostrándose.
 * @param {object} item - Item de `entry.display` (content.js).
 */
function isIngredientItem(item) {
  return Boolean(item.testFixed) || item.variant === 'ingredient';
}

/**
 * Renderiza una fragancia EN EL FLUJO normal del documento, dentro de `box` — el corazón del modo
 * DESACTIVADO (pedido del usuario 2026-09-14/15: "quiero que la página vaya mostrando de a poco la
 * página de la botella... como lo haría una página normal cuando se scrollea"). A diferencia de
 * setDisplayInstant/setDisplayStatic (que arman el contenido en la capa fija `.display-layer`,
 * position:fixed, pensada para el modo activado con saltos de página), acá el overlay oscuro, la
 * botella y el panel de texto quedan puestos DENTRO de `box` (que motor.js arma con
 * position:relative y el tamaño exacto del viewport, ver buildBoxes con collapsed=true) usando
 * position:absolute — así el conjunto se comporta como cualquier otro contenido normal del
 * documento: aparece/desaparece de a poco a medida que se scrollea, sin ningún salto ni "pop" al
 * entrar o salir, exactamente como el texto de una sección fake.
 *
 * El fondo pinta el `bgImage`/`boxClass` propio de `entry` (pedido del usuario 2026-09-16: al
 * presionar la ✕ o salir por un borde real de la paginación — Botella 1 hacia arriba, última
 * Botella hacia abajo — la imagen de fondo no debe cambiar; antes acá se forzaba un color plano
 * fijo, marrón claro, distinto del `bgImage` que se venía viendo en modo activado, así que el
 * fondo "saltaba" al colapsar). Mismo criterio que la caja "real" de motor.js en modo activado
 * (`buildBoxes`, sin cambios). El overlay usa una clase PROPIA
 * (`collapsed-box-overlay`, ver index.html) en vez de reusar `.background-overlay`: esa clase se
 * oculta con `html.poc-layers-hidden` (pensada para la capa FIJA del modo activado, ver ese
 * comentario en index.html), y `poc-layers-hidden` queda prendida en cualquier punto del documento
 * donde este grupo colapsado no esté a la vista (ver overlapsGroupZone/syncPocLayersVisibility en
 * motor.js) — si este overlay reusara esa clase, se ocultaría solo junto con las capas fijas en
 * vez de comportarse como contenido normal de la página. Mismo motivo para `collapsed-box-content`
 * en vez de `.display-layer`.
 *
 * Los items de `entry.display` que sean ingredientes (`isIngredientItem`, ver ahí) se saltean por
 * completo — mismo pedido del usuario 2026-09-14 ("no se deben mostrar los ingredientes"): ni la
 * imagen fija de ingrediente (`testFixed`) ni la fila de texto que lista sus
 * nombres (`variant: 'ingredient'`) se renderizan en modo desactivado. El producto (la botella) y
 * el título (nombre de la fragancia) sí se siguen mostrando, sin cambios.
 *
 * La botella usa `createStaticProductCanvasElement` (sin giro, igual que setDisplayStatic): en modo
 * desactivado nunca hay ninguna animación, ni de armado ni de entrada de ingredientes — todo
 * aparece ya en su estado final, y lo único que "anima" es el propio scroll nativo revelando el
 * contenido de a poco.
 * @param {HTMLElement} box - Contenedor (position:relative, ancho/alto = viewport) donde renderizar.
 * @param {object} entry - Caja (CONFIG.content[i]) a mostrar.
 */
export function renderCollapsedEntry(box, entry) {
  disposeCollapsedEntry();

  if (entry.bgImage) {
    box.style.backgroundImage = `url("${entry.bgImage}")`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.style.backgroundRepeat = 'no-repeat';
  } else {
    box.classList.add(entry.boxClass);
  }

  const overlay = document.createElement('div');
  overlay.className = 'collapsed-box-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  box.appendChild(overlay);
  collapsedOverlayEl = overlay;

  const content = document.createElement('div');
  content.className = 'collapsed-box-content';
  content.setAttribute('aria-hidden', 'true');
  box.appendChild(content);
  collapsedContentEl = content;

  entry.display.forEach((item) => {
    if (isIngredientItem(item)) return;
    const el = item.isProduct ? createStaticProductCanvasElement(item) : createDisplayElement(item);
    positionDisplayEl(el, item);
    applyDisplayState(el, item, visibleState(item, entry.animation), rotationAngle(item));
    revealWords(el);
    content.appendChild(el);
  });
}

/**
 * Anima en paralelo la salida del set actual y la entrada del nuevo.
 *
 * Los ingredientes de imagen (ver isIngredientImage) son un caso especial: arrancan en opacity 0 a
 * la fuerza (ver delayedIngredientEnteringState: SIEMPRE en 0, sin importar el "fades" de la
 * animación de la caja — hoy las cajas usan "traslation", que por sí sola no activa fades, así que
 * sin este forzado nunca se ocultaban de verdad), pegados al centro y tapados por la botella. Desde
 * 2026-09-10 (pedido explícito del usuario: "que los ingredientes aparezcan... cuando aparece la
 * nueva pantalla y no un poco antes de que la botella termine de rotar") pasan a opacity 1 y
 * arrancan a desplegarse hacia su punto de reposo EN EL MISMO INSTANTE en que aparece la caja nueva
 * (mismo momento que el panel de título/ingredientes de texto, ver el bloque de
 * flushPendingStyles/forEach más abajo) — YA NO esperan a ningún punto del giro de la botella (antes
 * esperaban al 80% del giro entrante, vía el onReveal de spin(); ver bottle.js). Para que de
 * cualquier forma terminen de llegar a su punto de reposo justo cuando la botella termina su medio
 * giro (mismo pedido: "bajar un poco la velocidad a los ingredientes para que lleguen a su posición
 * junto con la posición final de la botella"), su transición CSS de opacity/transform pasa a durar
 * COLLAPSE_TO_CENTER_MS (mismo valor que rige el giro) en vez del `--label-transition-ms` por
 * defecto (350ms, más rápido) — mismo criterio que collapseIngredientsToCenter usa para la salida,
 * pero de vuelta. El panel de título + ingredientes (texto) sigue sin esperar ni cambiar de
 * velocidad: entra de una, con su duración de siempre.
 *
 * OJO: esto es sólo para TRANSICIONES entre cajas. setDisplayInstant (carga inicial/resize) sigue
 * usando el mecanismo viejo (ingredientes demorados hasta el 80% de un giro clásico de 2s, ver
 * revealDelayedIngredients ahí) — a propósito, no se tocó: el pedido del usuario fue específico
 * sobre "cuando cambio de página".
 *
 * El producto (la botella) es OTRO caso especial, desde 2026-09-10: a diferencia de todo lo
 * demás (y a diferencia de setDisplayInstant, que sí lo deja hacer su fade-in normal), acá NO
 * hace el fade-in que le tocaría por su propio `animation: { effect: 'fade', when: 'enter' }`
 * (ver content.js) — entra directo en opacity 1, sin transición. Es a propósito: esta botella no
 * es "una cosa nueva apareciendo", es la MISMA botella que se estaba yendo (ver
 * collapseIngredientsToCenter) que sigue girando — un fade-in la delataría como un objeto nuevo y
 * rompería la ilusión. Lo que sí gira es su ángulo 3D interno (ver spinOverrides más abajo, y el
 * comentario de spin en bottle.js), que no tiene nada que ver con la opacity/transform CSS de
 * `.display-item`.
 *
 * El canvas de esa botella entrante, además, casi nunca se crea acá: goToIndex (motor.js) ya lo
 * mandó a construir por adelantado y oculto con prewarmIncomingProduct, así que esta función se
 * limita a revelarlo y pedirle el medio giro que le falta (ver pendingIncomingBottle más arriba) —
 * si no hay prewarm vigente para este item (no debería pasar en el flujo normal), cae al camino
 * viejo y lo crea acá mismo, como antes.
 * @param {Array<object>} display - Items de la caja que entra.
 * @param {{effect: string, when: string}} animation - Animación de la caja que entra.
 * @param {string} [direction] - Hacia dónde se scrolleó para llegar a esta caja: 'down' o 'up'.
 */
export function transitionDisplay(display, animation, direction) {
  ensureDisplayLayer();

  // Si el prewarm pendiente (ver prewarmIncomingProduct) no es el que hace falta acá (no debería
  // pasar en el flujo normal, goToIndex en motor.js lo pide con este mismo "display" — pero un
  // resize en medio de una transición, por ejemplo, podría dejarlo desactualizado), se descarta acá
  // mismo para no dejar un contexto WebGL vivo sin dueño ni confundirlo con el que sí hace falta.
  const incomingProductItem = display.find((item) => item.isProduct);
  if (pendingIncomingBottle && pendingIncomingBottle.item !== incomingProductItem) {
    disposePendingIncomingBottle();
  }

  const outgoingEls = currentDisplayEls;
  const outgoingItems = currentDisplayItems;
  const outgoingAnimation = currentDisplayAnimation;
  const animatedOutEls = [];

  outgoingEls.forEach((el, i) => {
    const item = outgoingItems[i];
    if (!isAnimatedInPhase(item, outgoingAnimation, 'exit')) {
      removeDisplayEl(el);
      return;
    }
    applyDisplayState(el, item, leavingState(item, outgoingAnimation, direction), rotationAngle(item));
    animatedOutEls.push(el);
  });

  if (animatedOutEls.length) {
    window.setTimeout(() => {
      animatedOutEls.forEach(removeDisplayEl);
    }, CONFIG.labelTransitionMs);
  }

  currentDisplayEls = display.map((item) => {
    // Botella prewarmeada (ver prewarmIncomingProduct/goToIndex en motor.js): ya tiene el modelo
    // cargado, el environment cocinado y los shaders compilados (ya renderizó al menos un frame,
    // de espaldas, oculto) — sólo hace falta revelarla y pedirle el medio giro que le falta, sin
    // volver a pagar ese costo de armado acá en medio de la transición.
    if (item.isProduct && pendingIncomingBottle && pendingIncomingBottle.item === item) {
      const { el } = pendingIncomingBottle;
      pendingIncomingBottle = null;
      // El canvas ya fue pintado (oculto) al menos una vez durante el prewarm, así que un cambio de
      // opacity ahora SÍ dispararía la transición CSS de .display-item (a diferencia de un canvas
      // recién creado, cuya primera aplicación de estilo nunca anima) — mismo truco que
      // setBackgroundInstant/transitionBackground para aplicar el estado sin fade.
      el.style.transition = 'none';
      el.style.visibility = '';
      applyDisplayState(el, item, visibleState(item, animation), rotationAngle(item)); // sin fade-in
      void el.offsetHeight; // fuerza el reflow con transition:none antes de reactivarla
      el.style.transition = '';
      if (el.__bottle) {
        // Ya no hace falta onReveal acá: los ingredientes se revelan solos, en el mismo instante
        // en que aparece la caja (ver el forEach de más abajo), no atados a ningún punto del giro.
        el.__bottle.spin({
          startYaw: Math.PI,
          turns: 0.5,
          durationMs: COLLAPSE_TO_CENTER_MS,
          easing: 'out',
        });
      }
      return el;
    }

    const el = item.isProduct
      ? createDisplayElement(item, undefined, {
        startYaw: Math.PI,
        turns: 0.5,
        durationMs: COLLAPSE_TO_CENTER_MS,
        easing: 'out',
      })
      : createDisplayElement(item);
    positionDisplayEl(el, item);
    const entering = item.isProduct
      ? visibleState(item, animation) // sin fade-in, ver el comentario de arriba
      : isIngredientImage(item)
        ? delayedIngredientEnteringState(item, animation, direction)
        : enteringState(item, animation, direction);
    applyDisplayState(el, item, entering, rotationAngle(item));
    displayLayer.appendChild(el);
    return el;
  });
  currentDisplayItems = display;
  currentDisplayAnimation = animation;

  flushPendingStyles();
  currentDisplayEls.forEach((el, i) => {
    const item = display[i];
    if (isIngredientImage(item)) {
      // Viajan del centro (tapados por la botella) a su punto de reposo durante
      // COLLAPSE_TO_CENTER_MS, no --label-transition-ms (ver el comentario de arriba): así llegan
      // justo cuando la botella termina su medio giro, en vez de antes o después.
      el.style.transitionDuration = `${COLLAPSE_TO_CENTER_MS}ms`;
    }
    applyDisplayState(el, item, visibleState(item, animation), rotationAngle(item));
    revealWords(el);
  });
}
