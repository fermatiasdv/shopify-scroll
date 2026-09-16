/**
 * `<fragrance-scroll>`: arranque liviano de la sección sections/fragrance-scroll.liquid.
 *
 * Este archivo es lo único que la sección carga de entrada. El motor (scroll-motor.js y todo lo que
 * importa, three.js incluido: ~2,3 MB sin minificar) se pide con `import()` recién cuando la sección
 * está a menos de una pantalla del viewport, así no compite con el LCP de la home. Con un deep link
 * (`?fragrance=<slug>`) arranca de inmediato, porque el motor tiene que scrollear hasta la sección.
 *
 * El ciclo de vida del custom element cubre también el editor de temas: al editar la sección,
 * Shopify reemplaza su HTML, así que el elemento viejo se desconecta (destroy) y el nuevo se conecta
 * (init) — no hace falta escuchar `shopify:section:load` / `shopify:section:unload` aparte.
 */
import { getIntersectionRoot } from '@theme/scroll-container';

/** Mismo valor que FRAGRANCE_QUERY_PARAM (scroll-config.js); duplicado para no importar el motor antes de tiempo. */
const FRAGRANCE_QUERY_PARAM = 'fragrance';

/** Margen del IntersectionObserver: empieza a cargar una pantalla antes de que la sección se vea. */
const PRELOAD_ROOT_MARGIN = '100% 0px';

const loadMotor = () => import('@scroll/motor');

class FragranceScroll extends HTMLElement {
  /** @type {IntersectionObserver | null} */
  #observer = null;

  /** true desde que se pidió el init hasta que se desconecta el elemento. */
  #started = false;

  connectedCallback() {
    if (new URLSearchParams(window.location.search).has(FRAGRANCE_QUERY_PARAM)) {
      this.#start();
      return;
    }

    this.#observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.#start();
      },
      { root: getIntersectionRoot(), rootMargin: PRELOAD_ROOT_MARGIN }
    );
    this.#observer.observe(this);
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    if (!this.#started) return;
    this.#started = false;
    loadMotor().then((motor) => motor.destroy(this));
  }

  async #start() {
    if (this.#started) return;
    this.#started = true;
    this.#observer?.disconnect();
    this.#observer = null;

    try {
      const motor = await loadMotor();
      if (this.#started && this.isConnected) motor.init(this);
    } catch (error) {
      console.error('fragrance-scroll: no se pudo iniciar', error);
    }
  }
}

if (!customElements.get('fragrance-scroll')) {
  customElements.define('fragrance-scroll', FragranceScroll);
}
