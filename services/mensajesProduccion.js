// Mensajes claros cuando no se puede producir o entregar un perfume: con nombres en vez de números.
// Ejemplo: "No se pudo producir 215. V.S CHOCOLATE: falta ESC. INSP. EN VS CHOCOLATE DM (hay 7 g, se necesitan 10 g)"

const cantidad = (v) => Number(Math.max(0, Number(v) || 0).toFixed(2)).toLocaleString('es-VE');

/** Nombre de un producto (perfume, esencia, fijador...) o "producto #id" si no se encuentra. */
async function nombreProducto(sql, id) {
  try {
    const r = await sql`SELECT nombre FROM productos WHERE id = ${id}`;
    if (r[0]?.nombre) return r[0].nombre;
  } catch (e) { /* se usa el número */ }
  return `producto #${id}`;
}

/** Falta materia prima para producir un perfume. `requerido`/`disponible` pueden ser null. */
async function mensajeFaltaMateriaPrima(sql, { productoTerminadoId, formulaId, materiaPrimaId, requerido = null, disponible = null }) {
  const perfume = productoTerminadoId != null ? await nombreProducto(sql, productoTerminadoId) : 'el perfume';
  const materia = await nombreProducto(sql, materiaPrimaId);
  let unidad = '';
  try {
    if (formulaId != null) {
      const u = await sql`SELECT unidad FROM formula_componentes WHERE formula_id = ${formulaId} AND materia_prima_id = ${materiaPrimaId} LIMIT 1`;
      if (u[0]?.unidad) unidad = ` ${u[0].unidad}`;
    }
  } catch (e) { /* sin unidad */ }
  const detalle = requerido != null ? ` (hay ${cantidad(disponible)}${unidad}, se necesitan ${cantidad(requerido)}${unidad})` : '';
  return `No se pudo producir ${perfume}: falta ${materia}${detalle}`;
}

module.exports = { nombreProducto, mensajeFaltaMateriaPrima };
