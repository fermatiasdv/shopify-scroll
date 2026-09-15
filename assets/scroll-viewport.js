/**
 * Scroll y viewport de la página, adaptados al layout de Horizon.
 *
 * El POC scrolleaba `window`. En Horizon eso sólo vale en mobile: en desktop (>= 990px) el
 * documento tiene `overflow: hidden` y el que scrollea es `.page-wrapper` (ver
 * assets/scroll-container.js), así que `window.scrollY` queda siempre en 0 y `window.scrollTo`
 * no hace nada. Todo el motor pasa por acá en vez de tocar `window` directamente.
 *
 * Además Horizon pone `scroll-behavior: smooth` en `html` y en `.page-wrapper`: con
 * `behavior: 'auto'` (lo que usaba el POC) los saltos de caja se animarían. Por eso `scrollToTop`
 * usa `behavior: 'instant'`.
 */
import { getScrollContainer } from '@theme/scroll-container';

/** true si el contenedor de scroll es el documento (mobile), no `.page-wrapper` (desktop). */
function isDocumentScroller(scroller) {
  return scroller === document.scrollingElement || scroller === document.documentElement;
}

/** Scroll vertical actual del contenedor de scroll de la página. */
export function getScrollTop() {
  return getScrollContainer().scrollTop;
}

/**
 * Salta, sin animar, a una posición de scroll.
 * @param {number} top - Posición vertical destino (px, en coordenadas del contenedor de scroll).
 */
export function scrollToTop(top) {
  getScrollContainer().scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' });
}

/**
 * Top de un elemento en coordenadas del contenedor de scroll (el equivalente a
 * `getBoundingClientRect().top + window.scrollY` del POC).
 * @param {Element} el - Elemento a medir.
 */
export function scrollOffsetTop(el) {
  const scroller = getScrollContainer();
  const base = isDocumentScroller(scroller) ? 0 : scroller.getBoundingClientRect().top;
  return el.getBoundingClientRect().top - base + scroller.scrollTop;
}

/**
 * Tamaño útil del viewport. El ancho descuenta la barra de scroll (en desktop, la de
 * `.page-wrapper`), así las cajas en flujo y la capa fija miden lo mismo y la botella queda
 * centrada en las dos; el alto sigue siendo `innerHeight`, igual que en el POC.
 */
export function viewportSize() {
  return { width: getScrollContainer().clientWidth, height: window.innerHeight };
}
