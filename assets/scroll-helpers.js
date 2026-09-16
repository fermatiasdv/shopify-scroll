import { layoutFor } from '@scroll/layout';
import { viewportSize } from '@scroll/viewport';

import { ANIMATION_BEHAVIOR, ANIMATION_WHEN, SHOW_ANIMATION, GROW_MAX, pageHeightFor } from '@scroll/config';

/** Efectos apagados: lo que devuelve una fase en la que la caja no anima. */
const NO_EFFECTS = { fades: false, translates: false };

/**
 * Traduce el objeto "animation" de una caja a los efectos que activa, validando de paso el efecto y la fase.
 * @param {{effect: string, when: string}} animation - Efecto de la caja y fase en la que ocurre ('enter' o 'exit').
 */
export function getAnimationBehavior(animation) {
  if (!animation || typeof animation !== 'object') {
    throw new Error('"animation" debe ser un objeto { effect, when }');
  }
  const behavior = ANIMATION_BEHAVIOR[animation.effect];
  if (!behavior) {
    const valid = Object.keys(ANIMATION_BEHAVIOR).join(', ');
    throw new Error(`"animation.effect" inválido: "${animation.effect}". Valores válidos: ${valid}`);
  }
  if (!ANIMATION_WHEN.includes(animation.when)) {
    const valid = ANIMATION_WHEN.join(', ');
    throw new Error(`"animation.when" inválido: "${animation.when}". Valores válidos: ${valid}`);
  }
  return behavior;
}

/**
 * Efectos que corresponden a una fase concreta de la caja.
 * @param {{effect: string, when: string}} animation - Animación de la caja.
 * @param {string} phase - Fase que se está por animar: 'enter' o 'exit'.
 */
function getPhaseBehavior(animation, phase) {
  const behavior = getAnimationBehavior(animation);
  return animation.when === phase ? behavior : NO_EFFECTS;
}

/**
 * Efectos que corresponden a un item concreto en una fase.
 * @param {object} item - Item de "display", del que se leen showAnimation y, opcionalmente, animation.
 * @param {{effect: string, when: string}} animation - Animación de la caja.
 * @param {string} phase - Fase que se está por animar: 'enter' o 'exit'.
 */
export function getItemPhaseBehavior(item, animation, phase) {
  if (item.showAnimation === 'no') return NO_EFFECTS;
  return getPhaseBehavior(item.animation || animation, phase);
}

/**
 * Valida el contenido al arrancar.
 * @param {Array} content - Lista de cajas (CONFIG.content).
 */
export function validateContent(content) {
  content.forEach((entry) => {
    getAnimationBehavior(entry.animation);
    entry.display.forEach((item) => {
      if ('animation' in item) {
        getAnimationBehavior(item.animation);
      }
      if (('xf' in item) !== ('yf' in item)) {
        throw new Error('Un item de "display" con posición final debe traer "xf" e "yf" juntos');
      }
      if ('size' in item && !(typeof item.size === 'number' && item.size > 0)) {
        throw new Error('El "size" de un item de "display" debe ser un número de px positivo');
      }
      if ('angle' in item && typeof item.angle !== 'number') {
        throw new Error('El "angle" de un item de "display" debe ser un número de grados');
      }
      if ('grow' in item && !(typeof item.grow === 'number' && item.grow > 0 && item.grow <= GROW_MAX)) {
        throw new Error(`El "grow" de un item de "display" debe ser un número positivo de hasta ${GROW_MAX} (fracción de escala extra)`);
      }
      if ('showAnimation' in item && !SHOW_ANIMATION.includes(item.showAnimation)) {
        const valid = SHOW_ANIMATION.join(', ');
        throw new Error(`"showAnimation" inválido: "${item.showAnimation}". Valores válidos: ${valid}`);
      }
    });
  });
}

/**
 * Vuelca a variables CSS los valores de configuración que necesita la hoja de estilos.
 * @param {object} config - Objeto de configuración (CONFIG).
 * @param {number} boxCount - Cantidad de pantallas que debe ocupar el grupo de fragancias ahora
 *   mismo — 1 en modo desactivado (colapsado), `config.content.length` en modo activado (ver
 *   pageHeightFor en config.js y setAnimationsEnabled en motor.js).
 */
export function applyCssVariables(config, boxCount) {
  const { width, height } = viewportSize();
  const layout = layoutFor(width, height);
  const root = document.documentElement.style;
  root.setProperty('--fragrance-scroll-page-height', `${pageHeightFor(boxCount, height)}px`);
  root.setProperty('--fragrance-scroll-viewport-width', `${width}px`);
  root.setProperty('--fragrance-scroll-label-transition-ms', `${config.labelTransitionMs}ms`);
  root.setProperty('--fragrance-scroll-background-transition-ms', `${config.backgroundTransitionMs}ms`);
  root.setProperty('--fragrance-scroll-title-font-size', `${layout.titleFontSizePx}px`);
  root.setProperty('--fragrance-scroll-ingredient-font-size', `${layout.ingredientFontSizePx}px`);
  root.setProperty('--fragrance-scroll-word-fade-ms', `${config.wordFadeMs}ms`);
}

/**
 * Variables CSS que escribe `applyCssVariables`. Viven en `<html>` porque las usan tanto la sección
 * como la capa fija (`.fragrance-scroll-stage`, colgada del body, fuera de la sección). Todas llevan
 * el prefijo `--fragrance-scroll-` (Horizon ya usa `--title-font-size`, por ejemplo) y se borran al
 * destruir la sección.
 */
const CSS_VARIABLES = [
  '--fragrance-scroll-page-height',
  '--fragrance-scroll-viewport-width',
  '--fragrance-scroll-label-transition-ms',
  '--fragrance-scroll-background-transition-ms',
  '--fragrance-scroll-title-font-size',
  '--fragrance-scroll-ingredient-font-size',
  '--fragrance-scroll-word-fade-ms',
];

/** Borra de `<html>` las variables que escribió `applyCssVariables` (ver destroy en motor.js). */
export function clearCssVariables() {
  CSS_VARIABLES.forEach((name) => document.documentElement.style.removeProperty(name));
}
