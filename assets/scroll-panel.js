/** Panel de título + lista de ingredientes: nombre del producto y, debajo, sus 3 ingredientes. */
import { panelLineY, INGREDIENT_LINE_COUNT } from '@scroll/layout';

/** Separador entre nombres de ingrediente en la fila única. */
const ITEM_SEPARATOR = ' – ';

/**
 * Arma los items de "display" del panel de una caja: el título (nombre del
 * producto), centrado arriba, y una única fila con los 3 ingredientes
 * unidos por un guión medio, centrada abajo.
 * @param {object} fragancia - Entrada Fragancia<Nombre> (constants.js).
 * @param {object} layout - Layout de layoutFor (layout.js).
 */
export function buildTitlePanelItems(fragancia, layout) {
  const items = [{
    labelText: fragancia.nombre,
    xi: layout.cx,
    yi: panelLineY(0, layout),
    variant: 'title',
    directional: true,
    panelLine: 0,
  }];

  const nombres = fragancia.ingredientes
    .slice(0, INGREDIENT_LINE_COUNT)
    .map((ingrediente) => ingrediente.nombre);

  items.push({
    labelText: nombres.join(ITEM_SEPARATOR),
    xi: layout.cx,
    yi: panelLineY(INGREDIENT_LINE_COUNT, layout),
    variant: 'ingredient',
    directional: true,
    panelLine: INGREDIENT_LINE_COUNT,
  });

  return items;
}
