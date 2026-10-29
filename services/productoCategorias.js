const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Un perfume puede tener varias categorías (ej. Hombre y Mujer = unisex).
// Se guardan en la tabla producto_categorias; productos.categoria_id queda como la
// categoría principal (la primera elegida) para las pantallas que aún usan una sola.
// Si la tabla todavía no existe (migración sin correr), se usa solo categoria_id.

function isMissingTable(err) {
  return err && (err.code === '42P01' || /producto_categorias/.test(String(err.message || '')) && /does not exist/.test(String(err.message || '')));
}

function normalizeIds(value) {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : [value];
  const ids = [];
  for (const v of list) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

// Devuelve { [producto_id]: [{ id, nombre, descripcion }] }
async function getCategoriasPorProducto(productIds, sqlClient = sql) {
  const ids = normalizeIds(productIds) || [];
  const result = {};
  if (ids.length === 0) return result;
  let rows;
  try {
    rows = await sqlClient`
      SELECT x.producto_id, c.id, c.nombre, c.descripcion
      FROM (
        SELECT pc.producto_id, pc.categoria_id FROM producto_categorias pc WHERE pc.producto_id = ANY(${ids})
        UNION
        SELECT p.id, p.categoria_id FROM productos p WHERE p.id = ANY(${ids}) AND p.categoria_id IS NOT NULL
      ) x
      JOIN categorias c ON c.id = x.categoria_id
      ORDER BY x.producto_id, c.nombre`;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    rows = await sqlClient`
      SELECT p.id AS producto_id, c.id, c.nombre, c.descripcion
      FROM productos p JOIN categorias c ON c.id = p.categoria_id
      WHERE p.id = ANY(${ids})`;
  }
  for (const r of rows || []) {
    const key = Number(r.producto_id);
    if (!result[key]) result[key] = [];
    result[key].push({ id: Number(r.id), nombre: r.nombre, descripcion: r.descripcion || null });
  }
  return result;
}

// Verifica que todas las categorías existan. Devuelve los ids que no existen.
async function categoriasInexistentes(categoriaIds, sqlClient = sql) {
  const ids = normalizeIds(categoriaIds) || [];
  if (ids.length === 0) return [];
  const rows = await sqlClient`SELECT id FROM categorias WHERE id = ANY(${ids})`;
  const found = new Set((rows || []).map((r) => Number(r.id)));
  return ids.filter((id) => !found.has(id));
}

// Reemplaza las categorías del producto por las indicadas (en una sola sentencia).
async function setCategoriasProducto(productoId, categoriaIds, sqlClient = sql) {
  const ids = normalizeIds(categoriaIds) || [];
  const pid = Number(productoId);
  try {
    await sqlClient`
      WITH borrar AS (
        DELETE FROM producto_categorias
        WHERE producto_id = ${pid} AND NOT (categoria_id = ANY(${ids}))
      )
      INSERT INTO producto_categorias (producto_id, categoria_id)
      SELECT ${pid}, unnest(${ids}::int[])
      ON CONFLICT DO NOTHING`;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    // Sin la tabla nueva solo se guarda la categoría principal (productos.categoria_id)
  }
}

module.exports = { normalizeIds, getCategoriasPorProducto, categoriasInexistentes, setCategoriasProducto };
