import { buildContent, relayoutContent } from '@scroll/content';
import { GROW_SCALE_LINEAR_COEFF, GROW_SCALE_QUADRATIC_COEFF } from '@scroll/grow';

export { relayoutContent };

/** Configuración de la experiencia de scroll. */

/**
 * Alto total (px) del contenido scrolleable del grupo de fragancias. `boxCount` es 1 en modo
 * desactivado (el grupo colapsado a una única pantalla, ver buildBoxes/setAnimationsEnabled en
 * motor.js, pedido del usuario 2026-09-14/15) o `CONFIG.content.length` en modo activado (una
 * pantalla por fragancia, para poder paginarlas) — antes este cálculo era siempre
 * `content.length * vh` sin importar el modo, de ahí que tomaba `content` entero en vez de un
 * número ya resuelto.
 * @param {number} boxCount - Cantidad de pantallas que debe ocupar el grupo.
 * @param {number} vh - Alto de viewport actual (window.innerHeight).
 */
export function pageHeightFor(boxCount, vh) {
  return boxCount * vh;
}

export { buildContent };

/**
 * `content` arranca vacío: en el tema se arma en init() (motor.js) con `buildContent()`, después
 * de leer las URLs de la sección — en el POC se armaba acá, al importar el módulo.
 * `container` es un selector relativo a la raíz de la sección, no al documento.
 */
export const CONFIG = {
  container: '.fragrance-scroll__container',
  content: [],
  labelTransitionMs: 350,
  labelExitOffsetPx: 50,
  backgroundTransitionMs: 500,
  growScaleLinearCoeff: GROW_SCALE_LINEAR_COEFF,
  growScaleQuadraticCoeff: GROW_SCALE_QUADRATIC_COEFF,
  wordFadeMs: 300,
};

/** Efectos que activa cada valor de "animation.effect". */
export const ANIMATION_BEHAVIOR = {
  no: { fades: false, translates: false },
  fade: { fades: true, translates: false },
  traslation: { fades: false, translates: true },
  'traslation-fade': { fades: true, translates: true },
};

/** Fases en las que puede ocurrir un efecto. */
export const ANIMATION_WHEN = ['enter', 'exit'];

/** Valores del campo "showAnimation" de un item de "display". */
export const SHOW_ANIMATION = ['yes', 'no'];

/** Tope de "grow" en un item de "display". */
export const GROW_MAX = 6;

/** Ventana en ms para tratar varios eventos de scroll seguidos como un solo paso. */
export const LOCK_MS = 50;

/**
 * Silencio mínimo (en ms) entre dos eventos de entrada (wheel/keydown) para considerarlos gestos
 * DISTINTOS. Una sola rueda de mouse o un flick de trackpad dispara decenas de eventos `wheel`
 * seguidos (más la inercia, que puede durar casi un segundo) separados por muy pocos ms: todos
 * esos son UN gesto, una sola intención del usuario. Ver `noteInputGesture` en motor.js.
 */
export const GESTURE_GAP_MS = 250;

/** Teclas que avanzan una caja. */
export const NEXT_KEYS = ['ArrowDown', 'PageDown', ' '];

/** Teclas que retroceden una caja. */
export const PREV_KEYS = ['ArrowUp', 'PageUp'];

/** Distancia vertical (px) que tiene que recorrer el dedo para contar como swipe. */
export const SWIPE_MIN_DISTANCE_PX = 60;

/** Cuánto más vertical que horizontal tiene que ser un gesto para contarlo como swipe de paginado. */
export const SWIPE_DIRECTION_RATIO = 1.2;

/** Nombre del query param de la URL que refleja la fragancia actual. */
export const FRAGRANCE_QUERY_PARAM = 'fragrance';
