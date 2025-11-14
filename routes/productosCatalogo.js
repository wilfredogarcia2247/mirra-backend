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
    const cols = 'id, nombre, unidad, stock, precio_venta, image_url';
    const hasQ = q && q.toString().trim() !== '';
    const includeOut = includeOutOfStock === 'true';
    const lim = limit && !isNaN(Number(limit)) ? Number(limit) : null;
    let result = [];

    const pattern = hasQ ? `%${q}%` : null;

    // Si no incluimos agotados, traemos y filtramos en JS (evita problemas de sintaxis en algunos clientes SQL)
    if (!includeOut) {
        if (hasQ) {
        if (lim) result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern} LIMIT ${lim}`;
        else result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern}`;
      } else {
        if (lim) result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos LIMIT ${lim}`;
        else result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos`;
      }
      result = (result || []).filter(r => Number(r.stock) > 0);
    } else {
      // incluir agotados: directamente en SQL
        if (hasQ) {
      if (lim) result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern} LIMIT ${lim}`;
      else result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos WHERE nombre ILIKE ${pattern}`;
        } else {
      if (lim) result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos LIMIT ${lim}`;
      else result = await sql`SELECT id, nombre, unidad, stock, precio_venta, image_url FROM productos`;
        }
    }

    // Enriquecer cada producto con inventario por almacén (opcional para front)
    // Obtener productos con inventario agregado en una sola consulta para rendimiento
    const prodIds = (result || []).map(r => r.id);
    if (prodIds.length === 0) return res.json([]);
    const rows = await sql`
      SELECT p.*, COALESCE(inv_tot.stock_disponible_total, 0) AS stock, COALESCE(inv_arr.inventario, '[]'::json) AS inventario
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, json_agg(json_build_object(
          'id', i.id,
          'almacen_id', i.almacen_id,
          'almacen_nombre', a.nombre,
          'almacen_tipo', a.tipo,
          'stock_fisico', i.stock_fisico,
          'stock_comprometido', i.stock_comprometido,
          'stock_disponible', (i.stock_fisico - i.stock_comprometido)
        ) ORDER BY (i.stock_fisico - i.stock_comprometido) DESC) AS inventario
        FROM inventario i
        LEFT JOIN almacenes a ON a.id = i.almacen_id
        GROUP BY producto_id
      ) inv_arr ON inv_arr.producto_id = p.id
      LEFT JOIN (
        SELECT producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS stock_disponible_total
        FROM inventario i
        GROUP BY producto_id
      ) inv_tot ON inv_tot.producto_id = p.id
      WHERE p.id = ANY(${prodIds})
    `;
    const enriched = (rows || []).map(p => {
      const inventario = (p.inventario && Array.isArray(p.inventario)) ? p.inventario.map(i => ({
        id: i.id,
        almacen_id: i.almacen_id,
        almacen_nombre: i.almacen_nombre,
        almacen_tipo: i.almacen_tipo,
        stock_fisico: Number(i.stock_fisico),
        stock_comprometido: Number(i.stock_comprometido),
        stock_disponible: Number(i.stock_disponible)
      })) : [];
      return { ...p, stock: Number(p.stock), inventario };
    });
    res.json(enriched);
  } catch (err) {
    console.error('Error en /api/productos/catalogo', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
