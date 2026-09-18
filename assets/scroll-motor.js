/**
 * Motor de la sección "fragrance scroll" (sections/fragrance-scroll.liquid).
 *
 * Diferencias con el motor del POC (labs/scroll/scripts/motor.js), por vivir dentro del tema Horizon:
 *   - No arranca solo en DOMContentLoaded: exporta `init(root)` y `destroy()`, que llama el custom
 *     element `<fragrance-scroll>` (scroll-fragrance-scroll.js) cuando la sección entra en viewport
 *     y cuando sale del DOM (el editor de temas la re-renderiza en cada cambio). Todos los
 *     listeners globales se registran en init y se sacan en destroy.
 *   - El estado es de módulo, así que hay UNA sola instancia activa por página (el schema de la
 *     sección tiene `limit: 1`).
 *   - El scroll no es el de `window`: pasa por scroll-viewport.js (en desktop Horizon scrollea
 *     `.page-wrapper`).
 *   - Las clases sobre `<html>` llevan prefijo: `fragrance-scroll-animated` (era
 *     `fragrances-animated`) y `fragrance-scroll-layers-hidden` (era `poc-layers-hidden`).
 *     `fake-scroll-mode` desaparece: era exactamente la negación de `fragrances-animated`, así que
 *     el CSS bloquea el scroll táctil sólo con `fragrance-scroll-animated` — en el POC el bloqueo
 *     era global (`html, body { touch-action: none }`) y se levantaba con esa clase.
 *   - Teclado, rueda y gestos que ocurren dentro de un diálogo, un campo de texto o con un drawer de
 *     Horizon abierto (`html[scroll-lock]`) no se tocan (ver isForeignInteraction).
 */
import {
  CONFIG,
  LOCK_MS,
  GESTURE_GAP_MS,
  NEXT_KEYS,
  PREV_KEYS,
  FRAGRANCE_QUERY_PARAM,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_DIRECTION_RATIO,
  buildContent,
  relayoutContent,
} from '@scroll/config';
import { validateContent, applyCssVariables, clearCssVariables } from '@scroll/helpers';
import {
  setDisplayInstant,
  transitionDisplay,
  collapseIngredientsToCenter,
  COLLAPSE_TO_CENTER_MS,
  setBackgroundInstant,
  transitionBackground,
  prewarmIncomingProduct,
  preloadImages,
  disposeDisplay,
  disposeCollapsedEntry,
  renderCollapsedEntry,
  mountStageNodes,
  disposeAll,
} from '@scroll/styles';
import { ASSETS, loadAssets } from '@scroll/assets';
import { getScrollTop, scrollToTop, scrollOffsetTop, viewportSize } from '@scroll/viewport';

/** Clase sobre `<html>` con el grupo desplegado y paginando (modo activado). */
const ANIMATED_CLASS = 'fragrance-scroll-animated';

/** Clase sobre `<html>` que oculta las capas fijas y los botones fuera de la zona del grupo. */
const LAYERS_HIDDEN_CLASS = 'fragrance-scroll-layers-hidden';

/** Raíz de la sección (`<fragrance-scroll>`) de la instancia activa, o null si no hay ninguna. */
let rootEl = null;

/**
 * true si el evento no es para este motor: viene de un campo editable o de un diálogo (búsqueda,
 * carrito, quick add de Horizon), o hay un drawer abierto que bloquea el scroll de la página
 * (`html[scroll-lock]`). Sin esto, en modo activado la barra espaciadora no escribiría en el
 * buscador y la rueda dentro del carrito pasaría de fragancia.
 * @param {Event} e - Evento de teclado, rueda o touch.
 */
function isForeignInteraction(e) {
  if (document.documentElement.hasAttribute('scroll-lock')) return true;
  const target = e.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('dialog, input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/**
 * Config e items (CONFIG.content) recibidos por init(), guardados a nivel de módulo: hacía falta
 * en un solo closure antes de la ronda 2026-09-14/15, pero desde que `setAnimationsEnabled` pasó a
 * reconstruir el grupo entero (colapsado/desplegado, ver más abajo) necesita acceder a los dos
 * fuera de init() — la reconstrucción también la disparan los botones "Show fragancies"/cerrar.
 */
let currentConfig = null;
let currentContent = null;

/**
 * Tops (scroll absoluto) de cada pantalla del grupo de fragancias. En modo DESACTIVADO tiene un
 * ÚNICO elemento (el grupo colapsado a una sola pantalla, ver buildBoxes/setAnimationsEnabled más
 * abajo); en modo ACTIVADO tiene una entrada por fragancia (CONFIG.content.length), una por
 * pantalla, para poder paginarlas. Arrancan en el top real del contenedor (`container`) en el
 * documento, no en 0: si hay contenido fake antes (ver index.html/fake-section-before-*), el
 * contenedor queda corrido hacia abajo por el alto de ese contenido.
 */
let boxTops = [];
let currentIndex = 0;
let isLocked = false;

/**
 * Índice destino de la transición de `goToIndex` en curso, o `null` si no hay ninguna corriendo. Se
 * pone al arrancar `goToIndex` y se limpia cuando esa transición termina de asentarse (currentIndex
 * ya actualizado). Ya NO se usa para que `atScrollEdge` detecte un borde de forma anticipada (ver
 * `queuedExitDirection` más abajo para el porqué) — sólo lo lee el handler de scroll, mientras
 * `isLocked` es true, para decidir si un intento de salir por un borde hay que encolarlo.
 */
let pendingIndex = null;

/**
 * Dirección (1 o -1) de un intento de salir por un borde que llegó MIENTRAS una transición de
 * `goToIndex` hacia ESE MISMO borde todavía estaba en el aire (`isLocked` true), o `null` si no hay
 * ninguno encolado. `goToIndex` lo consulta apenas termina de asentar la caja de borde (mismo punto
 * en el que hace `isLocked = false`) y, si hay uno, colapsa el grupo ahí mismo
 * (`collapseToFreeScroll`, ronda 13 — antes era `enterFakeScrollMode`), así el usuario no tiene que
 * reintentar el scroll a mano una vez que la llegada terminó.
 *
 * Bug reportado por el usuario 2026-09-14 (ronda 11), arreglado quitando el mecanismo anterior (que
 * vivía en `atScrollEdge`, ver el historial de esa función) y reemplazándolo por este encolado: la
 * ronda 9 hacía que `atScrollEdge` tratara "voy CAMINO al borde" igual que "ya estoy en el borde y
 * quiero seguir de largo" — usaba `pendingIndex` (la caja DESTINO de la transición en curso) como si
 * fuera la caja actual. Como cualquier `goToIndex` que termina en el borde (por ej. Botella 2 →
 * Botella 1, siendo Botella 1 la primera) empieza a escribir `pendingIndex` con ese destino desde el
 * primer instante, CUALQUIER scroll adicional en el mismo sentido que llegara mientras esa
 * transición seguía en el aire (algo MUY fácil de que pase por accidente: el usuario ve que empezó a
 * moverse y scrollea de nuevo para "ayudar" o simplemente porque scrollea rápido) disparaba
 * la salida de inmediato — saltando derecho a la sección fake SIN QUE Botella 1 llegara
 * a mostrarse nunca (ni su animación de giro/ingredientes). Eso es lo que el usuario describió como
 * "se saltea Botella 1 y pasa a Fake 2" y, en su variante más lenta (varios intentos hasta que uno
 * cae fuera de la ventana de bloqueo pero DESPUÉS de que uno de los intentos ya hizo saltar todo),
 * como "tengo que escrollear 3 o 4 veces". Con `queuedExitDirection`, ese mismo scroll adicional ya
 * NO dispara nada por sí solo (se limita a anotar la intención) — recién se actúa sobre él cuando la
 * transición en curso YA terminó de asentar la caja de borde (currentIndex actualizado, contenido
 * renderizado), así que la caja de borde siempre llega a mostrarse antes de salir hacia la fake,
 * y al mismo tiempo el usuario no tiene que reintentar el scroll a mano (mismo beneficio que
 * buscaba la ronda 9, sin su efecto secundario).
 */
let queuedExitDirection = null;

/**
 * Identidad del GESTO de entrada en curso (ronda 12, 2026-09-14). Un solo movimiento físico del
 * usuario —una rueda de mouse, un flick de trackpad (con su inercia), una tecla mantenida— dispara
 * decenas de eventos `wheel`/`keydown` seguidos, separados por pocos ms. Para el motor esos eventos
 * son UNA sola intención, no diez. `noteInputGesture()` agrupa en un mismo id todos los eventos
 * separados por menos de `GESTURE_GAP_MS`, y empieza un id nuevo después de cada silencio.
 *
 * `navGestureId` guarda el id del gesto que disparó el último `goToIndex`, para poder distinguir
 * "el usuario scrolleó OTRA vez" de "todavía están llegando los coletazos del mismo scroll que ya
 * navegó" (ver `queueExitIfEdgeBound` y el handler de wheel). El gesto táctil no lo necesita: ya
 * tiene su propio `touchHandled`, que limita cada swipe a una sola acción.
 */
let lastInputAt = 0;
let inputGestureId = 0;
let navGestureId = null;

/**
 * Devuelve el id del gesto al que pertenece el evento de entrada que se está procesando ahora,
 * abriendo uno nuevo si pasó más de `GESTURE_GAP_MS` desde el evento anterior. Llamar UNA vez por
 * evento, antes de decidir qué hacer con él.
 */
function noteInputGesture() {
  const now = Date.now();
  if (now - lastInputAt > GESTURE_GAP_MS) inputGestureId += 1;
  lastInputAt = now;
  return inputGestureId;
}

let pageSlugs = [];

/**
 * true = "modo activado" (nomenclatura del usuario, pedido 2026-09-14): el grupo de fragancias
 * está DESPLEGADO a una pantalla por fragancia y se pagina con saltos animados
 * (`goToIndex`), con el scroll bloqueado de punta a punta del grupo. false = "modo desactivado" (arranca
 * así, pedido 2026-09-13/14/15): el grupo entero queda COLAPSADO a UNA ÚNICA pantalla, mostrada sin
 * animación y en el flujo normal del documento (ver `renderCollapsedEntry` en styles.js) — el
 * scroll queda 100% libre TODO el tiempo, exactamente como cualquier otra sección de la página
 * (fake o no): no hay saltos, no hay "reveal" de golpe, el contenido de esa única pantalla aparece
 * y desaparece de a poco a medida que se scrollea, como el texto de una sección fake.
 *
 * Por qué "colapsado" y no "una pantalla libre por fragancia" (que fue el diseño de una ronda
 * anterior, 2026-09-14, y que el usuario pidió revertir el 2026-09-15 "no sé por qué se volvió
 * para atrás"): mostrar las 10 fragancias una detrás de la otra en modo desactivado hacía que se
 * "vieran todas las páginas" scrolleando, cuando el pedido real es que el grupo cuente como UNA
 * sola sección de la página (como una fake más) hasta que se presiona "Show fragancies" — recién
 * ahí tiene sentido poder pasar de una fragancia a otra.
 *
 * El botón "Show fragancies" prende el modo activado (despliega el grupo y centra la pantalla en
 * la caja actual); el botón de cerrar (✕, arriba a la derecha) lo apaga (colapsa el grupo de nuevo
 * a una sola pantalla, mostrando ahí, congelada, la fragancia en la que se estaba, y reacomoda el
 * scroll a esa única pantalla — ver los handlers de los botones, más abajo). Desde la ronda 13
 * (2026-09-15) también lo apaga el propio scroll al salir por un borde: seguir scrolleando más allá
 * de la primera o la última fragancia hace exactamente lo mismo que la ✕ (ver
 * `collapseToFreeScroll`). Cambiar este valor
 * SIEMPRE pasa por `setAnimationsEnabled`, nunca se asigna directo — ese helper es el que
 * reconstruye la geometría/contenido del grupo (colapsado o desplegado) y sincroniza las clases
 * CSS correspondientes. El estado se refleja en html.fragrances-animated (ver index.html) para
 * mostrar/ocultar los dos botones — nunca se muestran sobre las secciones fake (esa regla gana
 * siempre, ver el final de la hoja de estilos).
 */
let animationsEnabled = false;

/** Estado del gesto táctil en curso (ver los listeners de touch al final del archivo). */
let touchStartX = 0;
let touchStartY = null;
let touchHandled = false;
/**
 * Id de gesto del swipe en curso (ronda 12): en touch los límites del gesto los marca el propio
 * navegador (touchstart/touchend), así que no hace falta inferirlos por tiempo como en wheel —
 * cada swipe abre su propio id.
 */
let touchGestureId = 0;

/**
 * Nodo (cacheado, se busca una sola vez) del overlay "Show fragancies" (ver el comentario de
 * `.fragrances-overlay` en index.html). `buildBoxes` lo REUBICA como hijo de la caja colapsada en
 * cada llamada — nunca lo recrea — para que el botón de adentro quede contenido en esa pantalla sin
 * perder el listener de click atado una sola vez en init() (ver showButton ahí).
 */
let fragrancesOverlayEl = null;

/** Devuelve (y cachea) el nodo de `.fragrances-overlay`, ver el comentario de `fragrancesOverlayEl`. */
function getFragrancesOverlayEl() {
  if (!fragrancesOverlayEl) fragrancesOverlayEl = rootEl?.querySelector('.fragrances-overlay') ?? null;
  return fragrancesOverlayEl;
}

/**
 * Arma el slug de URL (fragranceSlug) para cada fragancia. Se calcula UNA sola vez en init() a
 * partir de `CONFIG.content` completo — independiente de si el grupo está colapsado o desplegado
 * (`pageSlugs` es sólo una tabla de búsqueda para resolver un deep link a un índice, no tiene nada
 * que ver con `boxTops`).
 * @param {Array} content - Lista de cajas (CONFIG.content), una por fragancia.
 */
function buildPageSlugs(content) {
  return content.map((entry) => entry.fragranceSlug);
}

/**
 * Busca el índice de caja para un slug de fragancia de la URL.
 * @param {string} slug - Valor del query param de fragancia (ej. "rebellious").
 */
function getIndexForSlug(slug) {
  return pageSlugs.indexOf(slug);
}

/** Lee el query param de fragancia de la URL actual y lo resuelve a un índice de caja válido. */
function getIndexFromUrl() {
  const slug = new URLSearchParams(window.location.search).get(FRAGRANCE_QUERY_PARAM);
  if (slug === null) return null;
  const index = getIndexForSlug(slug);
  return index === -1 ? null : index;
}

/**
 * Refleja la caja actual en el query param de fragancia de la URL, preservando el resto de la URL.
 * @param {number} index - Índice de la caja actual.
 */
function updateUrlForIndex(index) {
  const slug = pageSlugs[index];
  if (!slug) return;
  const url = new URL(window.location.href);
  url.searchParams.set(FRAGRANCE_QUERY_PARAM, slug);
  // Se conserva history.state: Horizon guarda ahí el scroll para restaurarlo al volver (ver
  // assets/scroll-container.js). El POC lo pisaba con null.
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Saca el query param de fragancia de la URL, preservando el resto. El param sólo tiene sentido
 * mientras el grupo está desplegado y paginando (modo activado, ver `updateUrlForIndex`); al
 * colapsar — ✕ o salida por un borde, ver `collapseToFreeScroll` — deja de reflejar nada real, así
 * que se saca en vez de quedar pisado con el valor de la última fragancia vista.
 */
function clearUrlFragranceParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FRAGRANCE_QUERY_PARAM)) return;
  url.searchParams.delete(FRAGRANCE_QUERY_PARAM);
  window.history.replaceState(window.history.state, '', url);
}

/**
 * Construye la geometría del grupo de fragancias dentro de `containerSelector` y su contenido,
 * según el modo:
 *   - `collapsed` true (modo desactivado): UNA sola caja (posición relativa, tamaño exacto del
 *     viewport), con la fragancia `currentIndex` renderizada EN SU FLUJO normal (ver
 *     renderCollapsedEntry en styles.js) — sin animación, sin capas fijas. `boxTops` queda con un
 *     único elemento: el top de esa caja.
 *   - `collapsed` false (modo activado): una caja por fragancia (`content.length`), cada una con
 *     su fondo propio (bgImage/boxClass — sigue existiendo debajo de la capa fija de crossfade, ver
 *     el comentario de esa capa), y el contenido de `currentIndex` se muestra con la animación
 *     clásica de armado (`setDisplayInstant`) en la capa fija de siempre. `boxTops` queda con una
 *     entrada por fragancia, para poder paginarlas.
 *
 * En los dos casos se descarta primero cualquier caja colapsada que hubiera quedado (
 * `disposeCollapsedEntry`, ver styles.js) ANTES de vaciar el contenedor: si no, `container.innerHTML
 * = ''` se llevaría puesto el canvas three.js de la botella colapsada sin llamar a `dispose()`,
 * dejando un contexto WebGL vivo sin dueño (mismo problema que `removeDisplayEl` existe para
 * evitar en la capa fija).
 * @param {string} containerSelector - Selector del contenedor scrolleable.
 * @param {Array} content - Lista de cajas (CONFIG.content), una por fragancia.
 * @param {boolean} collapsed - true para armar el grupo colapsado (modo desactivado).
 */
function buildBoxes(containerSelector, content, collapsed) {
  const container = rootEl?.querySelector(containerSelector);
  if (!container) return;

  disposeCollapsedEntry();

  // Las cajas miden `100%` de ancho (el POC usaba `${innerWidth}px`, que en desktop incluye la
  // barra de scroll y generaba scroll horizontal); el alto sigue siendo el del viewport.
  const { height: vh } = viewportSize();
  const containerTop = scrollOffsetTop(container);

  // Sacar el overlay "Show fragancies" ANTES de vaciar el contenedor: si había quedado adentro de
  // la caja colapsada de la vuelta anterior (ver el appendChild más abajo), innerHTML = '' se lo
  // llevaría puesto sin querer — .remove() es un no-op seguro si ya estaba afuera o si es la
  // primera vez que se llama (todavía vive donde lo puso index.html).
  getFragrancesOverlayEl()?.remove();

  container.innerHTML = '';
  boxTops = [];

  currentIndex = Math.min(currentIndex, content.length - 1);
  const entry = content[currentIndex % content.length];

  if (collapsed) {
    const box = document.createElement('div');
    box.style.width = '100%';
    box.style.height = `${vh}px`;
    box.style.position = 'relative';
    box.style.overflow = 'hidden';
    container.appendChild(box);
    boxTops.push(containerTop);
    renderCollapsedEntry(box, entry);
    // Ver el comentario de fragrancesOverlayEl: contenido dentro de ESTA caja (position:relative,
    // overflow:hidden, alto exacto del viewport), el botón ya no puede "escapar" a otra pantalla.
    const overlayEl = getFragrancesOverlayEl();
    if (overlayEl) box.appendChild(overlayEl);
    return;
  }

  let top = containerTop;
  for (let i = 0; i < content.length; i++) {
    const boxEntry = content[i % content.length];
    const box = document.createElement('div');
    if (boxEntry.bgImage) {
      box.style.backgroundImage = `url("${boxEntry.bgImage}")`;
      box.style.backgroundSize = 'cover';
      box.style.backgroundPosition = 'center';
      box.style.backgroundRepeat = 'no-repeat';
    } else {
      box.classList.add(boxEntry.boxClass);
    }
    box.style.width = '100%';
    box.style.height = `${vh}px`;
    container.appendChild(box);
    boxTops.push(top);
    top += vh;
  }

  setDisplayInstant(entry.display, entry.animation);
  setBackgroundInstant(entry);
}

/**
 * true si, parado en la caja actual (`currentIndex`, siempre la caja YA asentada — ver
 * `queuedExitDirection` más arriba para cómo se maneja el caso de "todavía estoy llegando"), seguir
 * un paso más en `direction` (1 = próxima caja, -1 = anterior) se saldría de la paginación — o sea
 * que ahí hay que liberar scroll nativo hacia la sección fake correspondiente en vez de navegar.
 * Sólo tiene sentido en modo ACTIVADO (grupo desplegado, `boxTops.length === content.length`).
 * @param {number} direction - 1 para avanzar, -1 para retroceder.
 */
function atScrollEdge(direction) {
  return (direction < 0 && currentIndex === 0) || (direction > 0 && currentIndex === boxTops.length - 1);
}

/**
 * Si un intento de salir por un borde llega mientras la transición en curso (`isLocked`) va
 * justo hacia ESE borde (`pendingIndex` en el extremo que corresponde a `direction`), lo anota en
 * `queuedExitDirection` para que `goToIndex` actúe apenas esa transición termine de asentarse (ver
 * el comentario de `queuedExitDirection`, arriba). Si la transición en curso va hacia otro lado (o
 * no hay ninguna), no hace nada — ese scroll se pierde sin más, igual que cualquier otro intento de
 * navegar mientras `isLocked` es true (comportamiento de siempre, sin cambios).
 *
 * RONDA 12 (2026-09-14): además exige que el evento venga de un gesto DISTINTO del que disparó la
 * transición en curso (`gestureId !== navGestureId`, ver `noteInputGesture`). Sin ese filtro, el
 * propio scroll que llevó a la caja de borde encolaba su salida: una sola rueda de mouse dispara
 * decenas de eventos `wheel`, el primero navega (por ej. Botella 2 → Botella 1) y TODOS los demás
 * caen dentro del `isLocked` de esa transición encontrando `pendingIndex` ya en el borde, así que
 * encolaban la salida hacia la sección fake. Resultado, reportado por el usuario: al llegar a
 * Botella 1 el scroll saltaba solo a Fake 2, y volver a Botella 2 costaba 2-4 scrolls (los que
 * hacían falta para cruzar de nuevo, a pulso, la pantalla entera de la sección fake). Sólo se
 * encola, entonces, una intención NUEVA del usuario: soltar y volver a scrollear.
 * @param {number} direction - 1 para avanzar, -1 para retroceder.
 * @param {number} gestureId - Id del gesto al que pertenece el evento (ver `noteInputGesture`).
 */
function queueExitIfEdgeBound(direction, gestureId) {
  if (gestureId === navGestureId) return;
  const headingToMatchingEdge = (direction < 0 && pendingIndex === 0)
    || (direction > 0 && pendingIndex === boxTops.length - 1);
  if (headingToMatchingEdge) queuedExitDirection = direction;
}

/**
 * true si el rango de scroll visible ahora mismo (el viewport, `[y, y + innerHeight)`) se solapa
 * en absoluto con el rango completo de `boxTops` (`[boxTops[0], boxTops[last] + innerHeight)`) —
 * no hace falta que una pantalla puntual esté encuadrada del todo, alcanza con que se vea aunque
 * sea un pixel de alguna. La usa `syncPocLayersVisibility` (más abajo) en los DOS modos: en
 * activado, para decidir si mostrar/ocultar las capas fijas del POC mientras se cruza un borde
 * real de la paginación; en desactivado, para decidir si el botón "Show fragancies" debe verse
 * (con `boxTops` de un solo elemento, el de la única caja colapsada).
 * @param {number} y - Scroll vertical actual (window.scrollY).
 */
function overlapsGroupZone(y) {
  const vh = window.innerHeight;
  return y + vh > boxTops[0] && y < boxTops[boxTops.length - 1] + vh;
}

/**
 * Muestra/oculta, según `overlapsGroupZone`, las capas fijas del POC (fondo con crossfade, overlay
 * oscuro, panel de contenido) y los botones "Show fragancies"/cerrar, a través de
 * `html.poc-layers-hidden` (ver index.html).
 *
 * En modo ACTIVADO el scroll está bloqueado de punta a punta del grupo (desde la ronda 13 ya no se
 * libera nunca en los bordes, ver `collapseToFreeScroll`), así que las tres capas fijas quedan
 * siempre visibles mientras dura ese modo; igual se sincroniza en cada 'scroll' por si el scroll se
 * moviera por fuera de `goToIndex` (chequeo lenient `overlapsGroupZone`, reacciona apenas se
 * solapa 1px, para que la caja no se vea nunca "pelada" — pedido del usuario 2026-09-13, ronda 3).
 *
 * En modo DESACTIVADO las tres capas fijas ni se usan (el grupo colapsado vive en flujo normal,
 * ver renderCollapsedEntry en styles.js) así que ocultarlas o no ahí es irrelevante — lo único que
 * de verdad gobierna en este modo es el botón "Show fragancies": tiene que aparecer sólo mientras
 * la única pantalla colapsada está genuinamente a la vista, igual que cualquier botón fijo sobre
 * una sección de una página normal. Se llama en cada 'scroll' sin condición (ahí el scroll nunca
 * se bloquea).
 */
function syncPocLayersVisibility() {
  if (!boxTops.length) return;
  const hidden = !overlapsGroupZone(getScrollTop());
  document.documentElement.classList.toggle(LAYERS_HIDDEN_CLASS, hidden);
}

/**
 * Sale de la paginación por un borde REAL del grupo (seguir scrolleando más allá de la primera o de
 * la última fragancia) haciendo EXACTAMENTE lo mismo que el botón ✕: colapsa el grupo entero a su
 * única pantalla y deja el scroll 100% libre, en flujo normal del documento.
 *
 * RONDA 13 (pedido del usuario 2026-09-15: "cuando escrolleo desde Botella 1 hacia Fake 2 que
 * automáticamente sea como presionar sobre la X, para que haya un movimiento fluido entre Botella 1
 * y Fake 2, sin sobresaltos. Lo mismo para la última botella y Fake 3"). Reemplaza por completo el
 * mecanismo de "liberar el scroll nativo en el borde" (`enterFakeScrollMode`/`exitFakeScrollMode`/
 * `isFakeScrollMode`, rondas 3 a 12), que era la fuente de todos los bugs de borde reportados: el
 * grupo seguía DESPLEGADO (11 pantallas de alto) mientras el usuario scrolleaba nativo por la
 * sección fake, así que había que cruzar a pulso una pantalla entera de caja de borde, adivinar
 * cuándo re-capturar el scroll al volver, y convivir con dos físicas de scroll distintas según
 * dónde estuviera el usuario. Colapsando, en cambio, el grupo pasa a medir UNA pantalla y la
 * sección fake queda pegada a ella: de ahí en adelante es scroll de página normal, sin bloqueos, sin
 * saltos y sin ningún estado intermedio que sincronizar. Volver a la paginación es volver a apretar
 * "Show fragancies" (que además reproduce el giro de armado de la botella), igual que la primera vez.
 *
 * El scroll queda clavado en `boxTops[0]` — la única pantalla del grupo colapsado, que ocupa
 * exactamente el viewport — así que visualmente NO se mueve nada respecto de la caja de borde que se
 * estaba viendo: cambia el contenido (fondo marrón, sin ingredientes, ver renderCollapsedEntry en
 * styles.js), no la posición. Desde ahí, seguir scrolleando hacia arriba revela la sección fake de
 * antes y hacia abajo la de después, de a poco, como en cualquier otra sección de la página.
 *
 * `extraScroll` permite adelantar el scroll del MISMO evento que disparó el colapso (el handler de
 * wheel le pasa su `deltaY`): sin eso, ese tick se perdería — lo comemos con `preventDefault` para
 * que el scroll nativo no pelee por la posición con este `scrollTo` mientras el documento acaba de
 * cambiar de alto — y el movimiento se sentiría trabado justo en el instante del cambio de modo.
 *
 * También saca `?fragrance=` de la URL (`clearUrlFragranceParam`, pedido del usuario 2026-09-16): el
 * param sólo tiene sentido mientras el grupo está desplegado y paginando, así que al colapsar —
 * salga por un borde o por la ✕, es el mismo caso — deja de reflejar la pantalla actual.
 * @param {number} [extraScroll] - Px a sumar a `boxTops[0]` (el delta del evento que lo disparó).
 */
function collapseToFreeScroll(extraScroll = 0) {
  isLocked = false;
  queuedExitDirection = null;
  pendingIndex = null;
  setAnimationsEnabled(false);
  clearUrlFragranceParam();
  scrollToTop(boxTops[0] + extraScroll);
  syncPocLayersVisibility();
}

/**
 * Único punto por el que se cambia `animationsEnabled` (pedido del usuario 2026-09-14/15):
 * reconstruye la geometría y el contenido del grupo de fragancias para el modo pedido (ver
 * buildBoxes) y sincroniza las clases CSS correspondientes. NO mueve el scroll — eso queda a cargo
 * de quien la llama, porque cada caller tiene un criterio distinto: el botón "Show fragancies"
 * centra la pantalla en la caja actual DESPUÉS de desplegar (ver su handler, más abajo); el botón
 * de cerrar reacomoda el scroll a la única pantalla colapsada DESPUÉS de colapsar; init() hace lo
 * propio sólo si hay un deep link. Meter un scrollTo acá adentro pisaría esas decisiones.
 * Nunca asignar `animationsEnabled` directo — si no, la geometría/contenido y las clases CSS
 * quedan desincronizadas.
 *   - Activando (modo activado): reconstruye el grupo DESPLEGADO (`buildBoxes(..., collapsed:
 *     false)`, una pantalla por fragancia, que además dispara el giro de armado clásico sobre
 *     `currentIndex` — mismo criterio que tenía buildBoxes desde siempre); saca
 *     `fake-scroll-mode` (el scroll pasa a estar bloqueado de punta a punta del grupo, sin ninguna
 *     excepción en los bordes desde la ronda 13) y `poc-layers-hidden` (que de ahí en más lo
 *     gobierna `syncPocLayersVisibility`).
 *   - Desactivando (modo desactivado): descarta lo que haya en la capa fija de la paginación
 *     (`disposeDisplay`, ver styles.js — ya no se usa en este modo) y reconstruye el grupo
 *     COLAPSADO (`buildBoxes(..., collapsed: true)`, una única pantalla con `currentIndex`
 *     congelado); agrega `fake-scroll-mode` para siempre (scroll libre en todo momento) y
 *     `poc-layers-hidden` (arranca oculto: recién se corrige en el próximo 'scroll', ver el
 *     listener en init()).
 * En ambos casos actualiza `html.fragrances-animated` (ver index.html, gobierna qué botón se ve).
 * @param {boolean} enabled - Nuevo valor de `animationsEnabled`.
 */
function setAnimationsEnabled(enabled) {
  animationsEnabled = enabled;
  document.documentElement.classList.toggle(ANIMATED_CLASS, enabled);

  // `fake-scroll-mode` del POC ya no existe: el bloqueo táctil depende sólo de ANIMATED_CLASS (ver
  // el comentario del módulo).
  if (enabled) {
    document.documentElement.classList.remove(LAYERS_HIDDEN_CLASS);
  } else {
    disposeDisplay();
    document.documentElement.classList.add(LAYERS_HIDDEN_CLASS);
  }

  applyCssVariables(currentConfig, enabled ? currentContent.length : 1);
  buildBoxes(currentConfig.container, currentContent, !enabled);

  syncPocLayersVisibility();
}

/**
 * Navega a una caja (SÓLO tiene sentido en modo activado, grupo desplegado). Antes de saltar,
 * arrancan en paralelo, todos al mismo tiempo (mismo instante en el que se pide el efecto de
 * vuelta al centro, ver más abajo):
 *   - los ingredientes de imagen de la caja actual vuelven al centro de la botella con una
 *     traslación + fade out y la botella saliente arranca su medio giro (collapseIngredientsToCenter
 *     en styles.js);
 *   - el crossfade de fondo hacia la caja destino (transitionBackground) — antes arrancaba
 *     recién al saltar de caja, MÁS TARDE que el giro de la botella; se movió acá a pedido
 *     explícito del usuario 2026-09-10 ("sería ideal que arranque cuando arranca a girar la
 *     botella"). Es un fade puro, sin desplazamiento (el parallax que tenía al principio se sacó
 *     el mismo día por pedido del usuario: se sentía como un salto entre páginas);
 *   - el prewarm, oculto, del canvas+botella de la caja destino (prewarmIncomingProduct en
 *     styles.js): crear el WebGLRenderer, cocinar el environment y compilar por primera vez los
 *     shaders del vidrio es trabajo síncrono caro que, si se hace recién al saltar de caja, se nota
 *     como un frenazo justo en el peor momento (la mitad del giro). Haciéndolo acá tiene los mismos
 *     COLLAPSE_TO_CENTER_MS de margen que los ingredientes para terminar antes de hacer falta.
 * Recién cuando ese efecto de vuelta al centro termina (COLLAPSE_TO_CENTER_MS) salta el scroll real
 * al instante (invisible: queda tapado por la capa de fondo fija, ver ensureBackgroundLayer en
 * styles.js) y lanza la transición del contenido nuevo (transitionDisplay, que reusa el prewarm de
 * arriba si sigue vigente) — así el cambio de caja ya no se ve como un corte seco. Bloquea la
 * navegación desde que arranca el efecto de vuelta al centro hasta LOCK_MS después del salto.
 * Refleja la caja destino en la URL. Mientras dura ese bloqueo, `pendingIndex` (ver más arriba)
 * guarda `target` para saber, si llega un intento de salir por un borde, si justo estamos yendo a
 * ese borde (`queueExitIfEdgeBound`).
 *
 * OJO (ronda 13, 2026-09-15): los dos `setTimeout` de abajo pueden llegar a correr DESPUÉS de que
 * el grupo se colapsó (el usuario apretó la ✕ a mitad de transición) — ahí `boxTops` pasó a tener
 * un solo elemento y `boxTops[currentIndex]` sería `undefined`. Por eso los dos chequean
 * `animationsEnabled` y se van sin hacer nada si el modo ya cambió. Salir por un borde, en cambio,
 * ya no compite con esta función: `collapseToFreeScroll` sólo se llama con `isLocked` en false (los
 * handlers) o desde el final de esta misma transición (el `queuedExitDirection` de abajo).
 * @param {number} index - Índice de caja destino; se recorta al rango válido.
 * @param {Array} content - Lista de cajas (CONFIG.content).
 */
function goToIndex(index, content) {
  const target = Math.max(0, Math.min(index, boxTops.length - 1));
  if (target === currentIndex) return;

  const entry = content[target % content.length];
  const direction = target > currentIndex ? 'down' : 'up';

  isLocked = true;
  pendingIndex = target;
  collapseIngredientsToCenter();
  transitionBackground(entry);
  prewarmIncomingProduct(entry.display);

  window.setTimeout(() => {
    if (!animationsEnabled) return; // el grupo se colapsó a mitad de la transición (✕ o borde)

    currentIndex = target;
    pendingIndex = null;

    scrollToTop(boxTops[currentIndex]);
    transitionDisplay(entry.display, entry.animation, direction);
    updateUrlForIndex(currentIndex);

    window.setTimeout(() => {
      if (!animationsEnabled) return;
      isLocked = false;

      // Ver el comentario de `queuedExitDirection`, más arriba: si mientras esta transición estaba
      // en el aire llegó un intento (de un gesto NUEVO) de salir por el borde al que justo acabamos
      // de llegar, se actúa recién ACÁ — la caja de borde ya quedó asentada y renderizada un
      // instante antes (arriba), así que nunca se colapsa sin haberla mostrado.
      if (queuedExitDirection !== null) {
        const exitDirection = queuedExitDirection;
        queuedExitDirection = null;
        if (atScrollEdge(exitDirection)) collapseToFreeScroll();
      }
    }, LOCK_MS);
  }, COLLAPSE_TO_CENTER_MS);
}

/**
 * Punto de entrada: valida la configuración y arma el grupo de fragancias en modo DESACTIVADO
 * (`animationsEnabled` default `false`, ver más arriba) — colapsado a una única pantalla, en el
 * lugar que le toca después de las secciones fake de "antes" (ver index.html).
 *
 * Sin slug en la URL, la página carga scrolleada al principio de todo (la primera sección fake),
 * igual que entraría a cualquier página real, y el grupo colapsado queda esperando más abajo, a
 * un scroll de distancia, mostrando la fragancia 0. Con un slug (deep link, ver
 * FRAGRANCE_QUERY_PARAM) YA NO fuerza el modo activado (pedido del usuario 2026-09-14/15): salta
 * derecho a la única pantalla del grupo (saltéandose las secciones fake), mostrando esa fragancia
 * ya congelada — el scroll queda igual de libre que en cualquier otro punto del modo desactivado.
 *
 * En el tema recibe la raíz de la sección en vez del CONFIG: lee de ahí las URLs de los assets
 * (`loadAssets`), arma `CONFIG.content` recién ahora, mueve el overlay oscuro y la ✕ al contenedor
 * fijo de capas (ver stageEl en styles.js) y registra todos los listeners globales. Si ya había
 * una instancia activa, la destruye primero.
 * @param {HTMLElement} root - Raíz de la sección (`<fragrance-scroll>`).
 */
export function init(root) {
  if (rootEl) destroy();
  rootEl = root;

  loadAssets(root);
  CONFIG.content = buildContent();
  validateContent(CONFIG.content);
  currentConfig = CONFIG;
  currentContent = CONFIG.content;
  pageSlugs = buildPageSlugs(CONFIG.content);

  const closeButton = root.querySelector('.fragrances-close-button');
  mountStageNodes([root.querySelector('.background-overlay'), closeButton]);

  const requestedIndex = getIndexFromUrl();
  if (requestedIndex !== null) currentIndex = requestedIndex;
  preloadImages(CONFIG.content, currentIndex, Object.values(ASSETS.labels));

  setAnimationsEnabled(animationsEnabled);

  if (requestedIndex !== null) {
    scrollToTop(boxTops[0]);
    syncPocLayersVisibility();
  }

  // Desde la ronda 13 (2026-09-15) el listener de scroll hace lo MISMO en los dos modos: sincronizar
  // la visibilidad de las capas fijas / del botón "Show fragancies" (`syncPocLayersVisibility`).
  // En el tema escucha en fase de captura sobre `document`: los eventos `scroll` de un elemento no
  // burbujean, y así llegan tanto los del documento (mobile) como los de `.page-wrapper` (desktop),
  // aunque el breakpoint cambie mientras la página está abierta.
  document.addEventListener('scroll', syncPocLayersVisibility, { passive: true, capture: true });

  // Overlay "Show fragancies" (pedido del usuario 2026-09-13/14/15, ver animationsEnabled más
  // arriba): el botón de mostrar despliega el grupo (setAnimationsEnabled(true)), repone
  // `?fragrance=` con la caja actual (updateUrlForIndex — pedido del usuario 2026-09-16: al
  // colapsar se había sacado, ver clearUrlFragranceParam/collapseToFreeScroll, así que hay que
  // volver a ponerlo acá para que la URL refleje otra vez la fragancia visible) y centra la
  // pantalla en la caja actual — de una reproduce el giro de armado de la botella sobre esa caja
  // (feedback inmediato de que ya están activas, disparado por buildBoxes/setDisplayInstant
  // adentro de setAnimationsEnabled, sin esperar al próximo scroll); el de cerrar colapsa el grupo
  // de nuevo (setAnimationsEnabled(false), la fragancia actual queda congelada en la única
  // pantalla), saca `?fragrance=` de la URL y reacomoda el scroll a esa pantalla — sin animación,
  // salto directo (pedido del usuario 2026-09-15: si se cierra a mitad de la paginación, ese lugar
  // deja de existir en la versión colapsada, así que no tiene sentido animar la transición hacia el
  // único lugar válido).
  // Los dos botones viven en nodos que destroy() saca del DOM, así que sus listeners se van con ellos.
  root.querySelector('.fragrances-show-button')?.addEventListener('click', onShowClick);
  closeButton?.addEventListener('click', onCloseClick);

  window.addEventListener('resize', onResize);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

/**
 * Apaga la instancia activa y deja el módulo como recién importado: saca los listeners globales,
 * descarta botellas/capas (disposeAll en styles.js) y limpia lo que init dejó sobre `<html>`
 * (clases y variables CSS). Las transiciones de `goToIndex` que sigan en el aire se cortan solas
 * porque chequean `animationsEnabled`.
 * @param {HTMLElement} [root] - Si se pasa, sólo destruye si es la raíz de la instancia activa (un
 *   elemento viejo que se desconecta después de que otro ya hizo init no debe apagar al nuevo).
 */
export function destroy(root) {
  if (!rootEl) return;
  if (root && root !== rootEl) return;

  document.removeEventListener('scroll', syncPocLayersVisibility, { capture: true });
  window.removeEventListener('resize', onResize);
  window.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', onTouchEnd);
  window.removeEventListener('touchcancel', onTouchEnd);
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
  resizeFrame = null;

  animationsEnabled = false;
  disposeAll();
  document.documentElement.classList.remove(ANIMATED_CLASS, LAYERS_HIDDEN_CLASS);
  clearCssVariables();

  rootEl = null;
  fragrancesOverlayEl = null;
  currentConfig = null;
  currentContent = null;
  boxTops = [];
  currentIndex = 0;
  isLocked = false;
  pendingIndex = null;
  queuedExitDirection = null;
  navGestureId = null;
  pageSlugs = [];
  touchStartY = null;
  touchHandled = false;
}

/** Botón "Show fragancies": ver el comentario de los botones en init(). */
function onShowClick() {
  setAnimationsEnabled(true);
  updateUrlForIndex(currentIndex);
  scrollToTop(boxTops[currentIndex]);
}

/** Botón ✕. Desde la ronda 13 la ✕ y la salida por un borde son literalmente lo mismo. */
function onCloseClick() {
  collapseToFreeScroll();
}

/** rAF pendiente del resize (uno por frame como máximo), o null. */
let resizeFrame = null;

/**
 * Recalcula geometría y contenido contra el viewport nuevo. La URL sólo se actualiza en modo
 * activado: en el POC se reescribía siempre, y en la home eso agregaba `?fragrance=` con sólo
 * cambiar el tamaño de la ventana, sin haber abierto nunca las fragancias.
 */
function onResize() {
  if (resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (!rootEl) return;
    relayoutContent(currentContent);
    applyCssVariables(currentConfig, animationsEnabled ? currentContent.length : 1);
    buildBoxes(currentConfig.container, currentContent, !animationsEnabled);
    syncPocLayersVisibility();
    if (animationsEnabled) updateUrlForIndex(currentIndex);
  });
}

/** Rueda del mouse / trackpad (en el POC era un listener anónimo registrado al importar). */
function onWheel(e) {
  // Modo desactivado: el scroll queda SIEMPRE libre (ver setAnimationsEnabled más arriba), no sólo
  // dentro de las secciones fake — nunca se bloquea ni se navega desde acá.
  if (!animationsEnabled) return;
  if (isForeignInteraction(e)) return;

  const direction = e.deltaY > 0 ? 1 : -1;
  const gestureId = noteInputGesture();

  // El chequeo de `isLocked` va ANTES que `atScrollEdge` (ronda 2026-09-14, 11 — ver el comentario
  // de `queuedExitDirection`, más arriba): mientras hay una transición en curso, `currentIndex`
  // todavía es la caja de ORIGEN, así que `atScrollEdge` no puede confundir "voy camino al borde"
  // con "ya estoy ahí" — si el scroll que llega apunta a ese mismo borde, se encola en vez de
  // perderse (`queueExitIfEdgeBound`); `goToIndex` lo retoma solo apenas asienta la llegada.
  if (isLocked) {
    e.preventDefault();
    queueExitIfEdgeBound(direction, gestureId);
    return;
  }

  if (atScrollEdge(direction)) {
    e.preventDefault();
    // Ronda 12: un mismo gesto no puede navegar Y salir por el borde. Una rueda de mouse sigue
    // emitiendo eventos bastante después de que la transición terminó (inercia de trackpad, rueda
    // girando): si no se filtraran, llegar a la primera/última fragancia y salir volando a la
    // sección fake sería el mismo movimiento, y el usuario nunca vería la caja de borde. Hay que
    // soltar y volver a scrollear para cruzar — igual que cada paso de la paginación es un scroll.
    if (gestureId === navGestureId) return;
    // Se está saliendo de la paginación por un borde: el grupo se COLAPSA, igual que con la ✕
    // (ronda 13, ver `collapseToFreeScroll`). El `preventDefault` de arriba evita que el scroll
    // nativo de este mismo tick pelee por la posición mientras el documento cambia de alto; en
    // cambio le pasamos su `deltaY` a `collapseToFreeScroll` para que el movimiento siga de largo,
    // ya dentro de la sección fake, sin que se sienta el corte.
    collapseToFreeScroll(e.deltaY);
    return;
  }

  // Mismo filtro que el chequeo de arriba (ronda 12), pero para navegar en vez de salir por el
  // borde: `isLocked` se libera (COLLAPSE_TO_CENTER_MS + LOCK_MS) antes de que el giro de ENTRADA
  // de la botella termine de verse (dura otro COLLAPSE_TO_CENTER_MS más) — ver el spin con
  // startYaw: Math.PI en transitionDisplay (styles.js). Un trackpad puede seguir mandando `wheel`
  // de la inercia del mismo gesto durante ese hueco; sin este chequeo, ese coletazo disparaba un
  // SEGUNDO goToIndex que cortaba el giro de entrada a mitad de camino y arrancaba uno nuevo desde
  // startYaw: Math.PI — se veía como que la botella "se reseteaba" y volvía a girar. Reportado por
  // usuarios de Mac (trackpad, inercia larga); con mouse wheel casi no pasa porque la ráfaga de
  // eventos muere antes de esa ventana.
  if (gestureId === navGestureId) return;

  e.preventDefault();
  navGestureId = gestureId;
  goToIndex(currentIndex + direction, CONFIG.content);
}

/** Teclado (en el POC era un listener anónimo registrado al importar). */
function onKeyDown(e) {
  if (!NEXT_KEYS.includes(e.key) && !PREV_KEYS.includes(e.key)) return;
  if (isForeignInteraction(e)) return;

  // Modo desactivado: scroll siempre libre, no se navega desde acá (ver el wheel de arriba).
  if (!animationsEnabled) return;

  const direction = NEXT_KEYS.includes(e.key) ? 1 : -1;
  // Ver el handler de wheel (ronda 12): una tecla MANTENIDA repite cada pocos ms; todas esas
  // repeticiones son un solo gesto, igual que los coletazos de una rueda de mouse.
  const gestureId = noteInputGesture();

  // Orden ver el comentario del handler de wheel (ronda 11): el chequeo de `isLocked` (con el
  // encolado de `queueExitIfEdgeBound`) va ANTES que `atScrollEdge`.
  if (isLocked) {
    e.preventDefault();
    queueExitIfEdgeBound(direction, gestureId);
    return;
  }

  if (atScrollEdge(direction)) {
    // `preventDefault` para que la tecla no scrollee nativo justo mientras el grupo se colapsa.
    e.preventDefault();
    if (gestureId === navGestureId) return; // ronda 12, ver el handler de wheel
    // Ronda 13: salir por un borde colapsa el grupo, igual que la ✕. Sin delta que adelantar (una
    // tecla no trae uno): la tecla siguiente ya scrollea nativo, con el grupo colapsado.
    collapseToFreeScroll();
    return;
  }

  e.preventDefault();
  navGestureId = gestureId;
  goToIndex(currentIndex + direction, CONFIG.content);
}

/**
 * Empieza a seguir un gesto táctil. Sólo sigue gestos de un dedo.
 * @param {TouchEvent} e - Evento touchstart.
 */
function onTouchStart(e) {
  if (e.touches.length !== 1) {
    touchStartY = null;
    return;
  }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchHandled = false;
  inputGestureId += 1;
  touchGestureId = inputGestureId;
}

/**
 * Decide si el gesto en curso ya es un swipe y, si lo es, pasa de caja.
 *
 * Ojo: el navegador decide `touch-action` al empezar el gesto (touchstart), así que el swipe que
 * colapsa el grupo en un borde (ronda 13, `collapseToFreeScroll`) no scrollea nativo todavía —
 * recién el PRÓXIMO gesto (después de levantar el dedo) lo hace, ya con html.fake-scroll-mode
 * puesto desde el touchstart. Aceptable para esta prueba; no se verificó en un dispositivo táctil
 * real.
 * @param {TouchEvent} e - Evento touchmove.
 */
function onTouchMove(e) {
  // Modo desactivado: scroll siempre libre (ver setAnimationsEnabled más arriba), ni siquiera se
  // intenta detectar un swipe — se deja al navegador manejar todo el gesto.
  if (!animationsEnabled) return;
  if (isForeignInteraction(e)) return;

  if (touchStartY === null || touchHandled || e.touches.length !== 1) {
    if (e.cancelable) e.preventDefault();
    return;
  }

  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;

  if (Math.abs(dy) < SWIPE_MIN_DISTANCE_PX) {
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (Math.abs(dy) < Math.abs(dx) * SWIPE_DIRECTION_RATIO) {
    if (e.cancelable) e.preventDefault();
    return;
  }

  touchHandled = true;

  const direction = dy < 0 ? 1 : -1;

  // Orden ver el comentario del handler de wheel, más arriba (ronda 11): el chequeo de `isLocked`
  // (con el encolado de `queueExitIfEdgeBound`) va ANTES que `atScrollEdge`.
  if (isLocked) {
    queueExitIfEdgeBound(direction, touchGestureId);
    if (e.cancelable) e.preventDefault();
    return;
  }

  if (atScrollEdge(direction)) {
    if (touchGestureId === navGestureId) return; // ronda 12, ver el handler de wheel
    collapseToFreeScroll(); // ronda 13: colapsa el grupo, igual que la ✕
    return; // sin preventDefault (ver el aviso de touch-action más arriba)
  }

  if (e.cancelable) e.preventDefault();
  navGestureId = touchGestureId;
  goToIndex(currentIndex + direction, CONFIG.content);
}

/** Cierra el gesto en curso y deja el estado listo para el siguiente. */
function onTouchEnd() {
  touchStartY = null;
  touchHandled = false;
}
