const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// GET / -> catálogo público de productos
// Query params opcionales:
//  - q: texto a buscar en nombre (LIKE)
//  - includeOutOfStock=true: incluir productos con stock <= 0
//  - limit: número máximo de resultados
router.get('/', async (req, res) => {
  try {
    const { q, includeOutOfStock, limit } = req.query;
    const cols = 'id, nombre, tipo, unidad, stock, precio_venta, image_url';
    const hasQ = q && q.toString().trim() !== '';
    const includeOut = includeOutOfStock === 'true';
    const lim = limit && !isNaN(Number(limit)) ? Number(limit) : null;
    let result = [];

    const pattern = hasQ ? `%${q}%` : null;

    // Si no incluimos agotados, traemos y filtramos en JS (evita problemas de sintaxis en algunos clientes SQL)
    if (!includeOut) {
      if (hasQ) {
  if (lim) result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern} LIMIT ${lim}`;
  else result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern}`;
      } else {
  if (lim) result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos LIMIT ${lim}`;
  else result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos`;
      }
      result = (result || []).filter(r => Number(r.stock) > 0);
    } else {
      // incluir agotados: directamente en SQL
      if (hasQ) {
  if (lim) result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern} LIMIT ${lim}`;
  else result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern}`;
      } else {
  if (lim) result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos LIMIT ${lim}`;
  else result = await sql`SELECT id, nombre, tipo, unidad, stock, precio_venta, image_url FROM productos`;
      }
    }

    // Enriquecer cada producto con inventario por almacén (opcional para front)
    const enriched = [];
    for (const prod of result) {
      const inv = await sql`
        SELECT i.id, i.producto_id, i.almacen_id, i.stock_fisico, i.stock_comprometido,
               (i.stock_fisico - i.stock_comprometido) AS stock_disponible,
               a.nombre AS almacen_nombre, a.tipo AS almacen_tipo
        FROM inventario i
        LEFT JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${prod.id}
      `;
      const inventarioMapeado = (inv || []).map(i => ({
        id: i.id,
        almacen_id: i.almacen_id,
        almacen_nombre: i.almacen_nombre,
        almacen_tipo: i.almacen_tipo,
        stock_fisico: Number(i.stock_fisico),
        stock_comprometido: Number(i.stock_comprometido),
        stock_disponible: Number(i.stock_disponible)
      }));
      enriched.push({ ...prod, inventario: inventarioMapeado });
    }
    res.json(enriched);
  } catch (err) {
    console.error('Error en /api/productos/catalogo', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
