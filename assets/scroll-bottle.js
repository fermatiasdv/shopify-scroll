/**
 * Botella 3D del producto, hecha con three.js — reemplaza a la botella generada por código
 * (LatheGeometry sobre un perfil medido a mano; ver historial en la memoria del proyecto).
 *
 * A partir de acá la botella es un modelo GLB real (`assets/models/bottle.glb`), con su propio
 * normal map horneado para el grabado "BROWN SUGAR BABE" (2048px) y una etiqueta diamante
 * ("BSB / <fragancia>") pegada como cáscara curva sobre el vidrio. El GLB (cuerpo/tapa/tubo) sigue
 * siendo UN solo modelo compartido por las 10 fragancias — sólo la ETIQUETA cambia por fragancia:
 * `createBottle` recibe `fragranceSlug` (mismo slug que arma slugify() en content.js) y resuelve
 * qué PNG de etiqueta usar contra `LABEL_URLS_BY_SLUG`, más abajo. Una fragancia sin entrada ahí
 * (todavía no tiene diseño propio) cae en `DEFAULT_LABEL_URL` (la diamante "BSB/PAINKILLER" de
 * siempre). Cuando lleguen modelos GLB definitivos por fragancia esto se vuelve a tocar, pero por
 * ahora alcanza con sumar una entrada nueva a `LABEL_URLS_BY_SLUG` por cada PNG de etiqueta que se
 * vaya generando. El parámetro `fragranceName` de `createBottle` se sigue aceptando (lo llaman
 * styles.js y bottle-lab.html, para el aria-label del link) pero bottle.js no lo usa.
 *
 * Esto SÍ vendoriza examples/jsm: GLTFLoader.js (+ sus dos dependencias, BufferGeometryUtils.js y
 * SkeletonUtils.js) en scripts/vendor/three/examples/jsm/, con el import a 'three' reescrito a la
 * ruta relativa del three.module.js ya vendorizado (mismo r185, no hay bundler acá). No hace falta
 * DRACOLoader ni KTX2Loader: el GLB no usa compresión Draco ni texturas comprimidas.
 *
 * El modelo se carga UNA sola vez por página (promesa cacheada a nivel de módulo) y cada caja
 * clona el grupo ya armado (`Object3D.clone()` comparte geometrías/materiales/texturas, sólo
 * clona la jerarquía) — así 10 cajas no repiten 10 veces la carga+parseo del GLB ni la
 * construcción de la etiqueta. `dispose()` por caja SOLO libera el renderer/contexto WebGL y el
 * environment de esa caja: las geometrías/materiales/texturas del modelo son compartidas y viven
 * toda la página, nunca se disponen.
 *
 * El vidrio SÍ usa `transmission` real (igual que el archivo de referencia del usuario,
 * `bottelmodel.html`), con una copia opaca de la misma geometría puesta de `BackSide` adentro
 * (`innerWall`, ver loadMasterModel) para que la refracción tenga algo sólido y oscuro contra qué
 * revelarse en vez de leer "vacío". Ojo con esto: una versión anterior de este archivo (la de la
 * botella por LatheGeometry) daba por sentado que `transmission` no se podía usar porque el canvas
 * del producto es `alpha:true` a propósito (se tiene que ver el fondo de la caja detrás de la
 * botella) — la duda era que sin nada opaco DENTRO de la escena, la refracción muestrearía el
 * fondo transparente y "ensuciaría" el alfa del canvas. Probado en la práctica con este modelo
 * (capturas con Chromium headless sobre fondo verde flúo, ver botella_3d.md): el alfa del canvas
 * queda perfecto, transmission no lo toca — three.js resuelve la refracción en un render target
 * propio ANTES de componer al canvas, no leyendo lo que hay detrás del `<canvas>` en el DOM. La
 * suposición vieja no se sostiene con este modelo/innerWall; quedó documentada como corregida en
 * la memoria del proyecto.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader';
import { ASSETS } from '@scroll/assets';

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/*
 * En el tema las URLs ya no están hardcodeadas acá (MODEL_URL, DEFAULT_LABEL_URL y
 * LABEL_URLS_BY_SLUG del POC): las arma la sección con `asset_url` y llegan en `ASSETS` (ver
 * scroll-assets.js).
 *   - `ASSETS.model`: GLB de la botella (cuerpo con grabado horneado, tapa, pico y tubo de succión).
 *   - `ASSETS.labels.default`: etiqueta diamante "BSB / PAINKILLER" (PNG con alfa), default para
 *     toda fragancia sin entrada propia.
 *   - `ASSETS.labels[slug]`: etiquetas diamante por fragancia, indexadas por su slug (mismo
 *     `slugify(nombre)` que arma content.js para `item.fragranceSlug` — ej. "Crimson Desert" ->
 *     "crimson_desert"). Painkiller no tiene entrada: la default YA ES su etiqueta. Cada PNG nuevo
 *     (mismo formato que bottle-label.png: 1024x1024, cáscara con fondo transparente) se suma como
 *     asset `scroll-bottle-label-<nombre>.png` y como entrada en el JSON de la sección.
 */

/**
 * Resuelve qué PNG de etiqueta usar para una fragancia.
 * @param {string} [fragranceSlug] - item.fragranceSlug (content.js). Sin match (o sin valor), cae
 *   en la etiqueta default.
 */
function resolveLabelUrl(fragranceSlug) {
  return (fragranceSlug && ASSETS.labels[fragranceSlug]) || ASSETS.labels.default;
}

// ---------------------------------------------------------------------------
// Colores / materiales
// ---------------------------------------------------------------------------

/** Ámbar del vidrio: color de superficie + color/distancia de atenuación (Beer-Lambert) de la
 * transmisión — son los mismos tres valores que traía `bottelmodel.html`. */
const GLASS_COLOR = new THREE.Color(0.36, 0.17, 0.04);
const GLASS_ATTENUATION_COLOR = new THREE.Color(1.0, 0.66, 0.14);
const GLASS_ATTENUATION_DISTANCE = 0.32;

/** Pared interior opaca (ver loadMasterModel: innerWall) contra la que refracta el vidrio. */
const INNER_WALL_COLOR = new THREE.Color(0.2, 0.075, 0.015);

/** Dorado de tapa y pico. */
const GOLD_COLOR = new THREE.Color(0.74, 0.55, 0.21);
const GOLD_NOZZLE_COLOR = new THREE.Color(0.90, 0.70, 0.32);

/** Tubo de succión: opaco, oscuro. */
const TUBE_COLOR = new THREE.Color(0.13, 0.07, 0.018);

// ---------------------------------------------------------------------------
// Etiqueta: cáscara curva pegada al vidrio (medidas del propio modelo, ver botella_3d.md)
// ---------------------------------------------------------------------------

/** Semiejes de la sección del cuerpo en las unidades propias del GLB (medidos con trimesh). */
const BODY_HALF_X = 0.0284;
const BODY_HALF_Z = 0.0158;

/** La etiqueta queda apenas afuera del vidrio, como una calcomanía real. */
const LABEL_OUTSET = 1.012;

/** Alto de la etiqueta y su corrimiento vertical (unidades del GLB), y medio-ancho angular. */
const LABEL_HALF_HEIGHT = 0.047 / 2;
const LABEL_CENTER_Y = 0.00155;
const LABEL_HALF_PHI = Math.asin(0.0237 / BODY_HALF_X);

/** Segmentos de la cáscara curva de la etiqueta. */
const LABEL_SEGMENTS = 32;

/**
 * Arma la geometría curva de la etiqueta, igual que un tramo de cilindro elíptico recortado.
 * Las caras quedan orientadas hacia afuera (hacia cámara).
 */
function buildLabelGeometry() {
  const a = BODY_HALF_X * LABEL_OUTSET;
  const b = BODY_HALF_Z * LABEL_OUTSET;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= LABEL_SEGMENTS; i += 1) {
    const t = i / LABEL_SEGMENTS;
    const phi = (t - 0.5) * 2 * LABEL_HALF_PHI;
    const x = a * Math.sin(phi);
    const z = b * Math.cos(phi);
    pos.push(x, LABEL_CENTER_Y - LABEL_HALF_HEIGHT, z, x, LABEL_CENTER_Y + LABEL_HALF_HEIGHT, z);
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < LABEL_SEGMENTS; i += 1) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  return geometry;
}

/** Geometría de la etiqueta: siempre la misma forma, se calcula una sola vez y se comparte (igual
 * criterio que las geometrías/materiales del GLB — ver getMasterModel: sólo se clona jerarquía). */
let cachedLabelGeometry = null;
function getLabelGeometry() {
  if (!cachedLabelGeometry) cachedLabelGeometry = buildLabelGeometry();
  return cachedLabelGeometry;
}

/** Material de etiqueta por URL (textura + resto de propiedades), cacheado para que dos botellas
 * de la MISMA fragancia (ej. la saliente y la prewarmeada durante una transición, ver
 * prewarmIncomingProduct en styles.js) reusen la misma textura ya cargada en vez de pedirla de
 * nuevo. Cada fragancia nueva agrega una entrada la primera vez que se pide. */
const labelMaterialCache = new Map();

/**
 * Promesa, por URL, que se resuelve cuando la textura de esa etiqueta terminó de cargar (o falló).
 *
 * Arreglo del tema (2026-09-15), el bug ya estaba en el POC: la textura carga de forma asíncrona y
 * una botella que no gira (createStaticProductCanvasElement en styles.js, la del modo desactivado)
 * se dibuja una sola vez, así que la primera vez que se veía una fragancia colapsada la botella
 * quedaba SIN etiqueta. Las que giran no lo notaban porque redibujan en cada frame. createBottle
 * espera esta promesa y redibuja una vez más.
 */
const labelTextureReady = new Map();

function getLabelMaterial(labelUrl) {
  let material = labelMaterialCache.get(labelUrl);
  if (!material) {
    let resolveReady;
    labelTextureReady.set(labelUrl, new Promise((resolve) => { resolveReady = resolve; }));
    const texture = new THREE.TextureLoader().load(labelUrl, resolveReady, undefined, resolveReady);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    material = new THREE.MeshStandardMaterial({
      map: texture,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.3,
      metalness: 0.05,
      envMapIntensity: 1.2,
    });
    labelMaterialCache.set(labelUrl, material);
  }
  return material;
}

/** Arma el mesh de etiqueta para una fragancia puntual (geometría compartida, material cacheado
 * por URL — ver arriba). Cada caja necesita su PROPIO Mesh porque cada una cuelga de un padre
 * distinto, aunque geometría y material sean los mismos objetos entre fragancias iguales. */
function buildLabelMesh(labelUrl) {
  return new THREE.Mesh(getLabelGeometry(), getLabelMaterial(labelUrl));
}

// ---------------------------------------------------------------------------
// Estudio de luz (PMREM sobre paneles emisivos) — igual que la versión anterior
// ---------------------------------------------------------------------------

/**
 * Arma el "estudio": una escena de paneles de color que se cocina a environment map con
 * PMREMGenerator. Da reflejos cálidos y una franja de luz vertical, sin HDRI externo.
 * @param {THREE.WebGLRenderer} renderer - Renderer contra el que se cocina el PMREM.
 */
function makeStudioEnvironment(renderer) {
  const envScene = new THREE.Scene();

  const panel = (color, intensity, w, h, pos) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };

  panel(0xfff1dc, 12, 6, 8, [-5, 6, 6]);
  panel(0xff9a3c, 9, 5, 5, [6, 3, -6]);
  panel(0xff7a1a, 5, 4, 6, [-6, -2, -5]);
  panel(0x8a4a20, 1.4, 10, 4, [0, -7, 4]);
  panel(0xfff6ea, 18, 1.2, 6, [2, 8, 1]);
  panel(0xffe2b8, 7, 1.6, 8, [-4, 0.5, 7]);
  panel(0xffc98a, 4, 0.9, 6, [4.5, 1, 5]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.08);
  pmrem.dispose();

  envScene.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  });

  return target;
}

// ---------------------------------------------------------------------------
// Carga y armado del modelo maestro (una sola vez por página)
// ---------------------------------------------------------------------------

/**
 * Carga el GLB, reemplaza sus materiales (vidrio con transmission real, ver comentario del módulo)
 * y agrega la etiqueta, y mide la caja del resultado para poder calibrarlo contra layout.js sin
 * tocar el GLB. Se cachea en una promesa a nivel de módulo: todas las cajas comparten el mismo
 * modelo ya armado.
 * @returns {Promise<{model: THREE.Group, naturalHeight: number, naturalHalfWidth: number}>}
 */
function loadMasterModel() {
  const loader = new GLTFLoader();
  return loader.loadAsync(ASSETS.model).then((gltf) => {
    const model = gltf.scene;

    model.traverse((obj) => {
      if (!obj.isMesh) return;
      const materialName = obj.material?.name || '';

      if (materialName.includes('Bottle body')) {
        // Vidrio con transmission real + atenuación (Beer-Lambert): es lo que da el ámbar
        // profundo con contraste duro de la referencia, algo que opacity nunca iguala del todo.
        // El normal map horneado del GLB (el grabado "BROWN SUGAR BABE") se conserva tal cual.
        const embossNormal = obj.material.normalMap;
        const embossScale = obj.material.normalScale ? obj.material.normalScale.clone() : new THREE.Vector2(1, 1);
        obj.material = new THREE.MeshPhysicalMaterial({
          color: GLASS_COLOR,
          metalness: 0,
          roughness: 0.03,
          transmission: 1.0,
          // thickness 0: sin desplazamiento de refracción en espacio de pantalla — así el vidrio
          // no muestrea un píxel vecino del buffer de transmisión (eso duplicaba la etiqueta como
          // manchas fantasma alrededor de sus propios bordes cuando se probó con thickness > 0).
          thickness: 0.0,
          ior: 1.5,
          attenuationColor: GLASS_ATTENUATION_COLOR,
          attenuationDistance: GLASS_ATTENUATION_DISTANCE,
          normalMap: embossNormal,
          normalScale: embossScale,
          clearcoat: 0.5,
          clearcoatRoughness: 0.04,
          envMapIntensity: 1.1,
          specularIntensity: 1.2,
          // FrontSide: con DoubleSide la pared lejana del vidrio se dibuja otra vez encima de lo
          // ya transmitido, embarrando el tubo/etiqueta de atrás.
          side: THREE.FrontSide,
        });
        // Pared interior opaca (ver comentario del módulo): sin esto, la transmisión muestrea el
        // canvas transparente y el vidrio lee fino/vacío en vez de lleno.
        const innerWall = new THREE.Mesh(obj.geometry, new THREE.MeshPhysicalMaterial({
          color: INNER_WALL_COLOR,
          metalness: 0,
          roughness: 0.12,
          clearcoat: 0.4,
          clearcoatRoughness: 0.1,
          envMapIntensity: 0.7,
          side: THREE.BackSide,
        }));
        obj.add(innerWall);
      } else if (materialName === 'Cap' || materialName.includes('Nozzle')) {
        const isNozzle = materialName.includes('Nozzle');
        obj.material = new THREE.MeshStandardMaterial({
          color: isNozzle ? GOLD_NOZZLE_COLOR : GOLD_COLOR,
          metalness: 1,
          roughness: isNozzle ? 0.2 : 0.24,
          envMapIntensity: 1.5,
        });
      } else if (obj.name === 'Tube_EXPORT' || materialName === 'Material.002') {
        obj.material = new THREE.MeshStandardMaterial({
          color: TUBE_COLOR,
          roughness: 0.45,
          metalness: 0.05,
        });
      }
    });

    // La etiqueta YA NO se agrega acá: ahora depende de la fragancia (ver LABEL_URLS_BY_SLUG),
    // así que cada caja arma la suya en buildBottleRig, sobre el clone, no sobre este maestro
    // compartido. No afecta la medición de abajo: la cáscara de la etiqueta (LABEL_OUTSET apenas
    // por encima de 1) queda por dentro de la caja del cuerpo en las dos dimensiones que importan
    // (BODY_HALF_X/Z), nunca la sobresale — agregarla o no antes de medir da el mismo resultado.

    // Medir y centrar: el GLB no viene centrado en su propio origen (el pie del vidrio arranca
    // por debajo de 0), así que se mide la caja real y se guarda aparte del scale/position que
    // le va a aplicar cada caja (ver buildBottleRig) — createBottle no toca el GLB, sólo envuelve
    // esta medición en un grupo con el escalado que layout.js espera.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    return { model, naturalHeight: size.y, naturalHalfWidth: size.x / 2 };
  });
}

/** Promesa cacheada: todas las cajas de la página comparten la misma carga. */
let masterModelPromise = null;

function getMasterModel() {
  if (!masterModelPromise) masterModelPromise = loadMasterModel();
  return masterModelPromise;
}

// ---------------------------------------------------------------------------
// Reuso de renderer/environment por <canvas> (rendimiento)
// ---------------------------------------------------------------------------

/**
 * `{ renderer, envTarget }` por elemento `<canvas>`, SÓLO para los casos en que styles.js pide
 * reusar el mismo `<canvas>` entre dos botellas (ver el pool de canvases del producto ahí, y
 * `dispose({ keepAlive })` más abajo). Antes, cada `createBottle` creaba SIEMPRE un
 * `WebGLRenderer` nuevo + cocinaba el environment PMREM de cero — como los materiales (vidrio,
 * dorado, tubo, ver loadMasterModel) son objetos COMPARTIDOS entre todas las botellas de la
 * página, pero el caché interno de programas compilados de three.js vive POR renderer/contexto
 * (no se comparte entre contextos WebGL distintos), un `WebGLRenderer` nuevo obligaba a recompilar
 * esos shaders (sobre todo el de vidrio con `transmission`, notoriamente caro) de cero en cada
 * cambio de caja — ese costo síncrono es la causa identificada del delay de 2-3s que reportó el
 * usuario al scrollear (ver rendimiento_botella_webgl.md en la memoria del proyecto).
 *
 * Con esto: si `createBottle` recibe un `<canvas>` que ya tiene una entrada acá (porque
 * styles.js se lo reusó desde una botella anterior liberada con `keepAlive: true`), reusa ESE
 * `renderer`/`envTarget` en vez de crear uno nuevo — el renderer ya tiene compilados los shaders
 * de esos mismos materiales compartidos desde la vez anterior, así que el primer `draw()` de la
 * botella nueva no paga ese costo. Es un `WeakMap` (no un objeto plano) para no impedir que un
 * `<canvas>` que YA NO se vaya a reusar (dispose sin `keepAlive`, ver más abajo borra la entrada
 * explícitamente de todos modos) se libere de memoria si en algún momento se dejara de referenciar
 * desde algún lado.
 */
const canvasRendererCache = new WeakMap();

/**
 * Destruye el renderer/environment que haya quedado vivo en `canvasRendererCache` para `canvas`
 * (una botella liberada con `keepAlive: true`, esperando en el pool de styles.js). Lo usa
 * `disposeAll` (styles.js) al destruir la sección — por ejemplo cuando el editor de temas la
 * re-renderiza —, para no dejar contextos WebGL huérfanos: el navegador limita cuántos puede haber
 * vivos a la vez.
 * @param {HTMLCanvasElement} canvas
 */
export function releaseCanvasRenderer(canvas) {
  const cached = canvasRendererCache.get(canvas);
  if (!cached) return;
  canvasRendererCache.delete(canvas);
  cached.envTarget.dispose();
  cached.renderer.dispose();
  cached.renderer.forceContextLoss();
}

/**
 * Clona el modelo maestro (comparte geometrías/materiales/texturas, sólo clona la jerarquía de
 * transformaciones) y lo envuelve en un grupo escalado para que mida exactamente lo que
 * layout.js espera, angostándolo si hace falta (nunca ensanchándolo) para no pasarse del ancho
 * reservado a los ingredientes.
 * @param {{model: THREE.Group, naturalHeight: number, naturalHalfWidth: number}} master
 * @param {number} height - Alto deseado en unidades de mundo (frustum -1..1).
 * @param {number} maxRadius - Radio máximo permitido en unidades de mundo.
 * @param {string} labelUrl - PNG de etiqueta a pegar en ESTE clone (ver resolveLabelUrl).
 */
function buildBottleRig(master, height, maxRadius, labelUrl) {
  const clone = master.model.clone(true);
  clone.add(buildLabelMesh(labelUrl));
  const scale = height / master.naturalHeight;
  const projectedHalfWidth = master.naturalHalfWidth * scale;
  const xzScale = projectedHalfWidth > maxRadius ? scale * (maxRadius / projectedHalfWidth) : scale;

  const rig = new THREE.Group();
  rig.add(clone);
  rig.scale.set(xzScale, scale, xzScale);
  return rig;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Duración por defecto de la rotación de entrada, en ms (~2 segundos). */
export const SPIN_DURATION_MS = 2000;

/**
 * Fracción del `durationMs` de UN giro en la que se dispara `onReveal` (ver runSpin): no hay que
 * esperar a que la botella frene del todo para revelar lo que esperaba al giro (los ingredientes,
 * ver styles.js), alcanza con este punto más adelantado. Es una FRACCIÓN, no un ms fijo, porque
 * desde 2026-09-10 no todos los giros duran lo mismo (ver TRANSITION_SPIN_IN_MS en styles.js: el
 * giro de "entrada, completando la vuelta" de una transición de caja es más corto que el giro
 * clásico de carga inicial) y el reveal tiene que seguir cayendo cerca del final de CUALQUIERA de
 * los dos, no sólo del de 2s. Con el giro clásico (SPIN_DURATION_MS = 2000ms) da exactamente los
 * 1.6s de siempre (0.8 × 2000).
 */
const SPIN_REVEAL_FRACTION = 0.8;

/** Suavizado de la rotación: arranca y termina quieta, sin frenazo. Giro clásico (uno solo). */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/**
 * Mitad "de entrada" de easeInOutCubic (arranca quieta, termina a velocidad máxima) — es
 * literalmente su primera rama (4t³) pero recorrida completa de 0 a 1 en vez de sólo hasta t=0.5.
 * La usa la botella SALIENTE de una transición de caja (ver collapseIngredientsToCenter en
 * styles.js): tiene que terminar su medio giro A LA MISMA VELOCIDAD con la que arranca el medio
 * giro de la botella ENTRANTE (ver easeOutCubic), si no el empalme se nota como un frenazo seguido
 * de un arranque en vez de un solo giro continuo. Sólo da el resultado exacto (velocidad idéntica
 * en el empalme) cuando las dos mitades duran lo mismo — hoy las dos usan COLLAPSE_TO_CENTER_MS.
 */
function easeInCubic(t) {
  return t * t * t;
}

/**
 * Mitad "de salida" de easeInOutCubic (arranca a velocidad máxima, termina quieta) — espejo de
 * easeInCubic. La usa la botella ENTRANTE de una transición de caja: arranca a la misma velocidad
 * con la que terminó la saliente (ver easeInCubic) y frena suave hasta quedar de frente.
 */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Mapa de las curvas que puede pedir spin()/runSpin() por nombre (ver spinOptions.easing). */
const EASINGS = { in: easeInCubic, out: easeOutCubic, inOut: easeInOutCubic };

// ---------------------------------------------------------------------------
// Inclinación al pasar el mouse (hover tilt)
// ---------------------------------------------------------------------------

/**
 * Ángulo de inclinación (en GRADOS) al pasar el mouse sobre la botella: con el mouse en la mitad
 * de ARRIBA del canvas, la parte de abajo va hacia adelante y la de arriba hacia atrás; con el
 * mouse en la mitad de ABAJO, al revés. Para probar otros ángulos, cambiar sólo este número.
 */
const HOVER_TILT_ANGLE_DEG = 20;

/** Duración (ms) de la animación de inclinación, tanto al inclinarse como al volver al reposo. */
const HOVER_TILT_DURATION_MS = 300;

const HOVER_TILT_ANGLE_RAD = THREE.MathUtils.degToRad(HOVER_TILT_ANGLE_DEG);

/**
 * Monta la botella en un canvas y devuelve el control para girarla y para liberarla.
 *
 * La cámara es ORTOGRÁFICA con frustum -1..1 en los dos ejes, igual que antes: el cuadro visible
 * coincide exacto con el cuadro cuadrado del canvas, así que un objeto de tamaño N en unidades de
 * mundo ocupa la fracción N/2 del cuadro. Eso es lo que permite que la botella mida EXACTAMENTE
 * lo que layout.js cree que mide.
 *
 * El modelo se carga de forma asíncrona (GLTFLoader): si `spin()`/`setYaw()` se llaman antes de
 * que esté listo (styles.js lo hace, apenas crea el canvas), el pedido queda pendiente y se
 * aplica solo cuando el modelo termina de cargar.
 *
 * @param {HTMLCanvasElement} canvas - Canvas donde renderizar (esta función le fija la resolución).
 * @param {object} options - Opciones.
 * @param {number} options.size - Lado del canvas en px (cuadrado).
 * @param {number} options.height - Alto de la botella en unidades de mundo (frustum -1..1), o sea
 *   la fracción del alto del cuadro por 2. Con PRODUCT_CONTENT_Y de layout.js: PRODUCT_CONTENT_Y * 2.
 * @param {number} [options.maxRadius] - Radio máximo permitido en unidades de mundo (PRODUCT_CONTENT_X
 *   de layout.js). Si la botella con su proporción real se pasa, se angosta para no romper el
 *   cálculo de espacio de los ingredientes. Nunca la ensancha.
 * @param {string} [options.fragranceName] - Sólo para quien llama (aria-label del link en
 *   styles.js); bottle.js no la usa.
 * @param {string} [options.fragranceSlug] - Slug de la fragancia (item.fragranceSlug, mismo
 *   slugify() de content.js). Elige qué PNG de etiqueta se pega sobre el vidrio (ver
 *   LABEL_URLS_BY_SLUG/resolveLabelUrl); sin match, o sin valor, usa la etiqueta default.
 * @param {number} [options.pixelRatio] - devicePixelRatio a usar.
 */
export function createBottle(canvas, options) {
  const {
    size,
    height,
    maxRadius = Infinity,
    fragranceSlug,
    pixelRatio = window.devicePixelRatio || 1,
  } = options;
  const labelUrl = resolveLabelUrl(fragranceSlug);

  // Ver el comentario de canvasRendererCache: si este MISMO <canvas> ya tiene un renderer/environment
  // de una botella anterior (liberada con keepAlive: true), se reusan tal cual — nos ahorramos crear
  // un WebGLRenderer nuevo, recocinar el PMREM y recompilar los shaders de vidrio/etiqueta.
  const cached = canvasRendererCache.get(canvas);
  let renderer;
  let envTarget;
  if (cached) {
    ({ renderer, envTarget } = cached);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(size, size, false);
  } else {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(size, size, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    envTarget = makeStudioEnvironment(renderer);
    canvasRendererCache.set(canvas, { renderer, envTarget });
  }

  const scene = new THREE.Scene();
  scene.environment = envTarget.texture;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  // Un poco de inclinación: se ve la botella apenas desde arriba, como en la foto de producto.
  const pivot = new THREE.Group();
  pivot.rotation.x = -0.06;
  scene.add(pivot);

  // Luces directas: el environment hace el grueso del trabajo, esto agrega los destellos duros.
  const key = new THREE.DirectionalLight(0xffe6c4, 2.6);
  key.position.set(-3, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff8a2a, 2.0);
  rim.position.set(3.5, 1.5, -3);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x40200c, 1.0));

  let rig = null;
  let frame = null;
  let disposed = false;
  let pendingSpin = null;
  let pendingYaw = null;

  // --- Inclinación al pasar el mouse (ver HOVER_TILT_ANGLE_DEG) ---
  let isHovered = false;
  let tiltAngle = 0; // ángulo actualmente aplicado (rad)
  let tiltTarget = 0; // ángulo hacia el que se está animando (rad)
  let tiltFrame = null;

  const draw = () => renderer.render(scene, camera);
  draw();

  /** Anima `tiltAngle` (y lo aplica a `rig.rotation.x`) desde su valor actual hasta `target`. */
  const animateTiltTo = (target) => {
    if (tiltTarget === target && tiltFrame !== null) return;
    tiltTarget = target;
    if (tiltFrame !== null) cancelAnimationFrame(tiltFrame);
    const startAngle = tiltAngle;
    const start = performance.now();
    const step = (now) => {
      if (disposed) { tiltFrame = null; return; }
      const elapsed = Math.max(0, now - start);
      const t = Math.min(1, elapsed / HOVER_TILT_DURATION_MS);
      tiltAngle = startAngle + (tiltTarget - startAngle) * easeInOutCubic(t);
      if (rig) rig.rotation.x = tiltAngle;
      draw();
      if (t < 1) {
        tiltFrame = requestAnimationFrame(step);
      } else {
        tiltFrame = null;
      }
    };
    tiltFrame = requestAnimationFrame(step);
  };

  /**
   * Inclina según en qué mitad (vertical) del canvas está el mouse ahora: mitad de arriba toma el
   * comportamiento que antes disparaba la flecha arriba, mitad de abajo el de la flecha abajo (ver
   * HOVER_TILT_ANGLE_DEG).
   */
  const handleBottleMouseMove = (e) => {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const target = relativeY < rect.height / 2 ? -HOVER_TILT_ANGLE_RAD : HOVER_TILT_ANGLE_RAD;
    animateTiltTo(target);
  };

  const handleBottleMouseEnter = (e) => {
    if (isHovered) return;
    isHovered = true;
    handleBottleMouseMove(e);
  };

  const handleBottleMouseLeave = () => {
    if (!isHovered) return;
    isHovered = false;
    animateTiltTo(0); // vuelve suave a la posición inicial
  };

  canvas.addEventListener('mouseenter', handleBottleMouseEnter);
  canvas.addEventListener('mousemove', handleBottleMouseMove);
  canvas.addEventListener('mouseleave', handleBottleMouseLeave);

  const runSpin = ({
    durationMs = SPIN_DURATION_MS, turns = 1, startYaw = 0, easing = 'inOut', onComplete, onReveal,
  } = {}) => {
    if (disposed || !rig) return;
    if (frame !== null) cancelAnimationFrame(frame);
    const ease = EASINGS[easing] || EASINGS.inOut;
    const start = performance.now();
    const revealAtMs = durationMs * SPIN_REVEAL_FRACTION;
    let revealFired = false;
    const step = (now) => {
      if (disposed) return;
      // Math.max en 0: el timestamp que le llega a un rAF puede, en la práctica, ser LIGERAMENTE
      // anterior al "start" que se capturó con performance.now() un instante antes de pedirlo —
      // pasa sobre todo en el primer giro de la página, cuando el primer draw() con el modelo ya
      // puesto tarda (compila shaders la primera vez) y ese trabajo síncrono cae entre el
      // performance.now() de "start" y el primer callback de requestAnimationFrame. Sin este
      // clamp, "elapsed" da negativo y easeInOutCubic(t negativo) rota la botella a un ángulo
      // chico pero al revés durante ese primer frame, antes de corregirse solo. Confirmado con
      // logging puntual: se vio elapsed=-575ms en el primer giro de una página recién cargada.
      const elapsed = Math.max(0, now - start);
      const t = Math.min(1, elapsed / durationMs);
      // startYaw: punto de arranque del giro (0 = de frente, el clásico; Math.PI = de espaldas,
      // usado por la botella ENTRANTE de una transición de caja para completar, desde ahí, lo que
      // le falta hasta quedar de frente — ver transitionDisplay/spinOverrides en styles.js).
      // easing: 'inOut' (default, un solo giro clásico) arranca y termina quieto; 'in'/'out' son
      // las dos mitades de esa misma curva (ver EASINGS) para que un giro partido en dos (saliente
      // + entrante) se sienta como uno solo, sin frenar en el medio.
      rig.rotation.y = startYaw + ease(t) * turns * Math.PI * 2;
      draw();
      if (!revealFired && onReveal && elapsed >= revealAtMs) {
        revealFired = true;
        onReveal();
      }
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        // Antes esto era siempre "rig.rotation.y = 0": válido mientras todo giro arrancaba en 0 y
        // daba una vuelta completa (turns=1), que vuelve a 0 exacto. Ya no es siempre así (ver
        // startYaw/turns de arriba: la mitad de un giro de transición NO vuelve a 0), así que el
        // ángulo final se recalcula igual que en cualquier frame intermedio, sin el redondeo de
        // easeInOutCubic (que en t=1 ya da exactamente 1, pero esto es más explícito).
        rig.rotation.y = startYaw + turns * Math.PI * 2;
        draw();
        frame = null;
        if (onComplete) onComplete();
      }
    };
    frame = requestAnimationFrame(step);
  };

  getMasterModel().then((master) => {
    if (disposed) return;
    rig = buildBottleRig(master, height, maxRadius, labelUrl);
    pivot.add(rig);

    if (pendingYaw !== null) {
      rig.rotation.y = pendingYaw;
    } else if (pendingSpin && typeof pendingSpin.startYaw === 'number') {
      // El giro pendiente arranca en un ángulo que no es 0 (ver startYaw en runSpin, usado por la
      // botella ENTRANTE de una transición de caja, que tiene que aparecer ya con la etiqueta para
      // atrás): se aplica ACÁ, antes del primer draw(), para que ni ese primer frame se vea en 0°.
      rig.rotation.y = pendingSpin.startYaw;
    }
    // Por si el hover ya había pedido inclinar la botella antes de que cargara el modelo.
    rig.rotation.x = tiltAngle;
    draw();
    // Ver labelTextureReady: redibuja cuando la etiqueta termina de cargar (si ya estaba cargada,
    // la promesa ya está resuelta y es sólo un draw() de más).
    labelTextureReady.get(labelUrl)?.then(() => {
      if (!disposed) draw();
    });

    if (pendingSpin) {
      const spinOptions = pendingSpin;
      pendingSpin = null;
      runSpin(spinOptions);
    }
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('bottle.js: no se pudo cargar el modelo', error);
  });

  /**
   * Gira la botella y la deja en el ángulo final (`startYaw + turns` vueltas). Por defecto da una
   * vuelta entera arrancando de frente y termina de nuevo de frente (el giro clásico de "entra una
   * fragancia nueva, sin transición de por medio" — carga inicial y resize, ver setDisplayInstant
   * en styles.js). No hay loop permanente: gira una vez y queda quieta.
   *
   * Desde 2026-09-10 también se usa partido en dos mitades para la ilusión de "la botella sigue
   * girando mientras cambia de fragancia" en cada transición de caja (ver goToIndex en motor.js y
   * transitionDisplay/spinOverrides en styles.js): la botella SALIENTE gira `turns: 0.5` desde
   * `startYaw: 0` (de frente a de espaldas, durante el mismo tiempo que tardan los ingredientes en
   * volver al centro) y, al saltar de caja, la botella ENTRANTE aparece YA de espaldas
   * (`startYaw: Math.PI`, sin fade-in) y gira otro `turns: 0.5` (de espaldas a de frente) — dos
   * botellas/canvas distintos, pero como la saliente termina exactamente en el mismo ángulo en el
   * que aparece la entrante, se ve como una sola botella que nunca dejó de girar. Para que esto se
   * sienta realmente continuo (sin frenar y volver a arrancar en el empalme) hace falta además
   * `easing: 'in'` en la saliente y `easing: 'out'` en la entrante (ver spinOptions.easing) — y que
   * las dos duren lo mismo.
   * @param {object} [spinOptions] - Ver runSpin.
   * @param {number} [spinOptions.startYaw] - Ángulo de arranque en radianes (0 = de frente,
   *   Math.PI = de espaldas). Default 0.
   * @param {number} [spinOptions.turns] - Vueltas a dar desde startYaw. Default 1.
   * @param {number} [spinOptions.durationMs] - Duración del giro. Default SPIN_DURATION_MS.
   *   `onReveal` dispara una sola vez, al 80% (SPIN_REVEAL_FRACTION) de ESTE durationMs, mientras
   *   la botella sigue girando; `onComplete` dispara recién cuando el giro ya terminó del todo.
   * @param {string} [spinOptions.easing] - 'inOut' (default, el giro clásico de una sola pieza:
   *   arranca y termina quieto), 'in' (arranca quieto, termina a velocidad máxima — la mitad
   *   saliente de una transición) u 'out' (arranca a velocidad máxima, termina quieto — la mitad
   *   entrante). 'in' seguido de 'out', con la misma duración cada una, da exactamente la misma
   *   curva que 'inOut' de una sola vez pero partida al medio, sin discontinuidad de velocidad en
   *   el punto de corte (ver EASINGS/easeInCubic/easeOutCubic).
   */
  const spin = (spinOptions = {}) => {
    if (disposed) return;
    if (!rig) {
      pendingSpin = spinOptions;
      return;
    }
    runSpin(spinOptions);
  };

  /**
   * Pone la botella en un ángulo fijo (para la página de prueba: arrastrar con el mouse). Si el
   * modelo todavía no cargó, se aplica apenas esté listo.
   * @param {number} yaw - Ángulo en radianes.
   */
  const setYaw = (yaw) => {
    if (disposed) return;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (!rig) {
      pendingYaw = yaw;
      return;
    }
    rig.rotation.y = yaw;
    draw();
  };

  /**
   * Libera esta botella. Por defecto (sin `keepAlive`, comportamiento de siempre) también destruye
   * el renderer/contexto WebGL y el environment de ESTA caja — las geometrías, materiales y
   * texturas del modelo son compartidas entre todas las cajas y viven toda la página, nunca se
   * disponen acá (ver getMasterModel).
   *
   * Si el caller pasa `{ keepAlive: true }` (ver el pool de canvases del producto en styles.js:
   * lo hace cuando este `<canvas>` se va a reusar para la próxima botella en vez de descartarse),
   * el renderer/environment NO se destruyen — quedan vivos en `canvasRendererCache` para que la
   * PRÓXIMA `createBottle` sobre este mismo `<canvas>` los reuse (ver ese comentario). El resto de
   * la limpieza (frames, listeners) es igual en los dos casos: es estado de ESTA instancia, no del
   * renderer.
   * @param {{keepAlive?: boolean}} [opts]
   */
  const dispose = (opts = {}) => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (tiltFrame !== null) cancelAnimationFrame(tiltFrame);
    tiltFrame = null;
    canvas.removeEventListener('mouseenter', handleBottleMouseEnter);
    canvas.removeEventListener('mousemove', handleBottleMouseMove);
    canvas.removeEventListener('mouseleave', handleBottleMouseLeave);
    isHovered = false;
    if (opts.keepAlive) return;
    canvasRendererCache.delete(canvas);
    envTarget.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  return { spin, setYaw, render: draw, dispose };
}
