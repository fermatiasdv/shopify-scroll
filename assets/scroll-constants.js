/**
 * Constantes de assets: rutas a las imágenes recortadas de productos e
 * ingredientes, y el mapeo de cada fragancia a su imagen de producto + sus
 * ingredientes.
 *
 * En el tema estas rutas ya NO apuntan a archivos reales: ni las imágenes de producto (la botella
 * la dibuja el GLB, ver createDisplayElement en styles.js) ni las de ingrediente por archivo (cada
 * fragancia usa una única imagen fija, ver FIXED_INGREDIENT_IMAGE_OVERRIDES en content.js) se
 * subieron a `assets/`. Se conservan como identificadores porque `buildContent` descarta toda
 * fragancia con `fragancia === ''` — vaciarlas haría desaparecer las fragancias.
 */

/** Prefijo (sólo identificador, sin archivo detrás) de las imágenes de productos. */
const PRODUCTS_PATH = 'products/';

/** Prefijo (sólo identificador, sin archivo detrás) de las imágenes de ingredientes. */
const INGREDIENTS_PATH = 'ingredients/';

// ---------------------------------------------------------------------------
// Productos (assets/products/recortadas)
// ---------------------------------------------------------------------------

export const Rebellious = `${PRODUCTS_PATH}rebellious.png`;
export const ForbiddenFlower = `${PRODUCTS_PATH}forbidenflower.png`;
export const WonderOfTheWorld = `${PRODUCTS_PATH}wonderoftheworld.png`;
export const Painkiller = `${PRODUCTS_PATH}painkiller.png`;
export const JaggedEdge = `${PRODUCTS_PATH}jaggededge.png`;
export const CrimsonDesert = `${PRODUCTS_PATH}crimsondesert.png`;
export const Glitterati = `${PRODUCTS_PATH}glitterati.png`;
export const Ecstasy = `${PRODUCTS_PATH}ecstasy.png`;
export const Epicurean = `${PRODUCTS_PATH}epicurean.png`;
export const LondonLegend = `${PRODUCTS_PATH}londonlegend.png`;

// ---------------------------------------------------------------------------
// Ingredientes (assets/ingredients/recortadas)
// ---------------------------------------------------------------------------

export const Saffron = [
  `${INGREDIENTS_PATH}Saffron.png`,
  `${INGREDIENTS_PATH}Saffron1.png`,
  `${INGREDIENTS_PATH}Saffron2.png`,
];
export const PinkPepper = [];
export const Caramel = [
  `${INGREDIENTS_PATH}Caramel.png`,
  `${INGREDIENTS_PATH}Caramel1.png`,
  `${INGREDIENTS_PATH}Caramel2.png`,
  `${INGREDIENTS_PATH}Caramel3.png`,
];
export const Lychee = [
  `${INGREDIENTS_PATH}Lychee.png`,
  `${INGREDIENTS_PATH}Lychee1.png`,
  `${INGREDIENTS_PATH}Lychee2.png`,
];
export const Bergamot = [
  `${INGREDIENTS_PATH}Bergamot.png`,
  `${INGREDIENTS_PATH}Bergamot1.png`,
  `${INGREDIENTS_PATH}Bergamot2.png`,
  `${INGREDIENTS_PATH}Bergamot3.png`,
];
export const Freesia = [
  `${INGREDIENTS_PATH}Freesia.png`,
  `${INGREDIENTS_PATH}Freesia1.png`,
  `${INGREDIENTS_PATH}Freesia2.png`,
];
export const Almond = [
  `${INGREDIENTS_PATH}Almond.png`,
  `${INGREDIENTS_PATH}Almond1.png`,
  `${INGREDIENTS_PATH}Almond2.png`,
];
export const Dates = [];
export const Lilac = [
  `${INGREDIENTS_PATH}Lilac.png`,
  `${INGREDIENTS_PATH}Lilac1.png`,
  `${INGREDIENTS_PATH}Lilac2.png`,
];
export const Musk = [
  `${INGREDIENTS_PATH}Musk.png`,
  `${INGREDIENTS_PATH}Musk1.png`,
  `${INGREDIENTS_PATH}Musk2.png`,
];
export const TonkaBean = [
  `${INGREDIENTS_PATH}TonkaBean.png`,
  `${INGREDIENTS_PATH}TonkaBean1.png`,
  `${INGREDIENTS_PATH}TonkaBean2.png`,
];
export const Rose = [
  `${INGREDIENTS_PATH}Rose.png`,
  `${INGREDIENTS_PATH}Rose1.png`,
  `${INGREDIENTS_PATH}Rose2.png`,
];
export const Raspberry = [
  `${INGREDIENTS_PATH}Raspberry.png`,
  `${INGREDIENTS_PATH}Raspberry1.png`,
  `${INGREDIENTS_PATH}Raspberry2.png`,
];
export const Mandarin = [
  `${INGREDIENTS_PATH}Mandarin.png`,
  `${INGREDIENTS_PATH}Mandarin1.png`,
  `${INGREDIENTS_PATH}Mandarin2.png`,
];
export const Jasmine = [
  `${INGREDIENTS_PATH}Jasmine.png`,
  `${INGREDIENTS_PATH}Jasmine1.png`,
  `${INGREDIENTS_PATH}Jasmine2.png`,
];
export const YangLang = [];
export const Vanilla = [
  `${INGREDIENTS_PATH}Vanilla.png`,
  `${INGREDIENTS_PATH}Vanilla1.png`,
  `${INGREDIENTS_PATH}Vanilla2.png`,
];
export const BlackCurrant = [
  `${INGREDIENTS_PATH}BlackCurrant.png`,
  `${INGREDIENTS_PATH}BlackCurrant1.png`,
  `${INGREDIENTS_PATH}BlackCurrant2.png`,
];
export const Ginger = [
  `${INGREDIENTS_PATH}Ginger.png`,
  `${INGREDIENTS_PATH}Ginger1.png`,
  `${INGREDIENTS_PATH}Ginger2.png`,
];
export const BulgarianRose = [
  `${INGREDIENTS_PATH}BulgarianRose.png`,
  `${INGREDIENTS_PATH}BulgarianRose1.png`,
  `${INGREDIENTS_PATH}BulgarianRose2.png`,
];

// ---------------------------------------------------------------------------
// Fragancias: producto + sus ingredientes
// ---------------------------------------------------------------------------

export const FraganciaRebellious = {
  idx: 1,
  nombre: 'Rebellious',
  fragancia: Rebellious,
  ingredientes: [
    { nombre: 'Saffron', imagenes: Saffron },
    // { nombre: 'Pink Pepper', imagenes: PinkPepper }, // falta imagen
    { nombre: 'Bergamot', imagenes: Bergamot }, // Quitar este
    { nombre: 'Caramel', imagenes: Caramel },
  ],
};
export const FraganciaForbiddenFlower = {
  idx: 2,
  nombre: 'Forbidden Flower',
  fragancia: ForbiddenFlower,
  ingredientes: [
    { nombre: 'Lychee', imagenes: Lychee },
    { nombre: 'Bergamot', imagenes: Bergamot },
    { nombre: 'Freesia', imagenes: Freesia },
  ],
};
export const FraganciaWonderOfTheWorld = {
  idx: 3,
  nombre: 'Wonder of the World',
  fragancia: WonderOfTheWorld,
  ingredientes: [
    { nombre: 'Almond', imagenes: Almond },
    //    { nombre: 'Dates', imagenes: Dates }, // falta imagen
    { nombre: 'Freesia', imagenes: Freesia }, // sacar esta
    { nombre: 'Caramel', imagenes: Caramel },
  ],
};
export const FraganciaPainkiller = {
  idx: 4,
  nombre: 'Painkiller',
  fragancia: Painkiller,
  ingredientes: [
    { nombre: 'Lilac', imagenes: Lilac },
    { nombre: 'Bergamot', imagenes: Bergamot },
    { nombre: 'Musk', imagenes: Musk },
  ],
};
export const FraganciaJaggedEdge = {
  idx: 5,
  nombre: 'Jagged Edge',
  fragancia: JaggedEdge,
  ingredientes: [
    // { nombre: 'Pink Pepper', imagenes: PinkPepper }, // falta imagen
    { nombre: 'Bergamot', imagenes: Bergamot }, // Quitar este
    { nombre: 'Tonka Bean', imagenes: TonkaBean },
    { nombre: 'Rose', imagenes: Rose },
  ],
};
export const FraganciaCrimsonDesert = {
  idx: 6,
  nombre: 'Crimson Desert',
  fragancia: CrimsonDesert,
  ingredientes: [
    { nombre: 'Raspberry', imagenes: Raspberry },
    { nombre: 'Mandarin', imagenes: Mandarin },
    { nombre: 'Jasmine', imagenes: Jasmine },
  ],
};
export const FraganciaGlitterati = {
  idx: 7,
  nombre: 'Glitterati',
  fragancia: Glitterati,
  ingredientes: [
    // { nombre: 'Yang Lang', imagenes: YangLang }, // falta imagen
    { nombre: 'Jasmine', imagenes: Jasmine }, // Quitar este
    { nombre: 'Vanilla', imagenes: Vanilla },
    { nombre: 'Musk', imagenes: Musk },
  ],
};
export const FraganciaEcstasy = {
  idx: 8,
  nombre: 'Ecstasy',
  fragancia: Ecstasy,
  ingredientes: [
    { nombre: 'Black Currant', imagenes: BlackCurrant },
    { nombre: 'Ginger', imagenes: Ginger },
    { nombre: 'Rose', imagenes: Rose },
  ],
};
export const FraganciaEpicurean = {
  idx: 9,
  nombre: 'Epicurean',
  fragancia: Epicurean,
  ingredientes: [
    { nombre: 'Jasmine', imagenes: Jasmine },
    { nombre: 'Rose', imagenes: Rose },
    { nombre: 'Black Currant', imagenes: BlackCurrant },
  ],
};
export const FraganciaLondonLegend = {
  idx: 10,
  nombre: 'London Legend',
  fragancia: LondonLegend,
  ingredientes: [
    { nombre: 'Saffron', imagenes: Saffron },
    { nombre: 'Bulgarian Rose', imagenes: BulgarianRose },
    { nombre: 'Vanilla', imagenes: Vanilla },
  ],
};
