// Mínimo de perfumes de 7 ml en los pedidos de la tienda web: si el pedido no tiene ningún perfume
// de 30, 50, 60 o 100 ml, hacen falta al menos 4 de 7 ml. Los de 10 ml no cuentan para nada.
// No aplica a los pedidos que hace el personal en el panel.
// Misma regla que muestra el carrito (mirra-perfumeria-frontend/src/lib/minimoSieteMl.ts).
const { mlDe } = require('./descuentoMayor');

const MINIMO_SIETE_ML = 4;
const TAMANOS_GRANDES = [30, 50, 60, 100];

/** lineas: [{ nombre, cantidad }] (nombre de la presentación, p. ej. "Presentación 7 ml"). Devuelve cuántos faltan. */
function faltanSieteMl(lineas) {
  let siete = 0;
  for (const l of lineas || []) {
    const cantidad = Number(l?.cantidad) || 0;
    if (cantidad <= 0) continue;
    const ml = mlDe(l?.nombre);
    if (ml != null && TAMANOS_GRANDES.includes(ml)) return 0;
    if (ml === 7) siete += cantidad;
  }
  if (siete === 0) return 0;
  return Math.max(0, MINIMO_SIETE_ML - siete);
}

function avisoSieteMl(faltan) {
  return `Los perfumes de 7 ml se venden desde ${MINIMO_SIETE_ML} unidades. Te ${faltan === 1 ? 'falta 1' : `faltan ${faltan}`}, o agrega un perfume de 30 ml o más.`;
}

module.exports = { MINIMO_SIETE_ML, faltanSieteMl, avisoSieteMl };
