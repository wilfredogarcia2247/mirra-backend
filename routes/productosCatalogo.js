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
    const hasQ = q && q.toString().trim() !== '';
    const includeOut = includeOutOfStock === 'true';
    const lim = limit && !isNaN(Number(limit)) ? Number(limit) : null;

    // Enriquecer cada producto con inventario por almacén (solo almacenes de venta)
    // Primero obtener los IDs de productos que tienen inventario en almacenes que NO sean materia prima
    const patternClause = hasQ ? `%${q}%` : null;
    let prodIdRows;
    if (hasQ) {
      if (includeOut) {
        prodIdRows = await sql`
          SELECT DISTINCT p.id FROM productos p
          JOIN inventario i ON i.producto_id = p.id
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE a.es_materia_prima IS NOT TRUE AND p.nombre ILIKE ${patternClause}
          ${lim ? sql`LIMIT ${lim}` : sql``}
        `;
      } else {
        prodIdRows = await sql`
          SELECT DISTINCT p.id FROM productos p
          JOIN inventario i ON i.producto_id = p.id
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE a.es_materia_prima IS NOT TRUE AND p.nombre ILIKE ${patternClause}
          ${lim ? sql`LIMIT ${lim}` : sql``}
        `;
      }
    } else {
      if (includeOut) {
        prodIdRows = await sql`
          SELECT DISTINCT p.id FROM productos p
          JOIN inventario i ON i.producto_id = p.id
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE a.es_materia_prima IS NOT TRUE
          ${lim ? sql`LIMIT ${lim}` : sql``}
        `;
      } else {
        prodIdRows = await sql`
          SELECT DISTINCT p.id FROM productos p
          JOIN inventario i ON i.producto_id = p.id
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE a.es_materia_prima IS NOT TRUE
          ${lim ? sql`LIMIT ${lim}` : sql``}
        `;
      }
    }
    const prodIds = (prodIdRows || []).map(r => r.id);
    if (prodIds.length === 0) return res.json([]);

    const rows = await sql`
      SELECT p.*, c.nombre AS categoria_nombre, c.descripcion AS categoria_descripcion, m.nombre AS marca_nombre, COALESCE(inv_tot.stock_disponible_total, 0) AS stock, COALESCE(inv_arr.inventario, '[]'::json) AS inventario
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN marcas m ON m.id = p.marca_id
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
        WHERE a.es_materia_prima IS NOT TRUE
        GROUP BY producto_id
      ) inv_arr ON inv_arr.producto_id = p.id
      LEFT JOIN (
        SELECT producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS stock_disponible_total
        FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE a.es_materia_prima IS NOT TRUE
        GROUP BY producto_id
      ) inv_tot ON inv_tot.producto_id = p.id
      WHERE p.id = ANY(${prodIds})
    `;
    // Obtener fórmulas (ahora sirven como definición de tamaño) para los productos listados
    const productIds = (rows || []).map(r => r.id);
    let formulasRows = [];
    if (productIds.length > 0) {
      formulasRows = await sql`
        SELECT id, producto_terminado_id AS producto_id, nombre AS tamano_descripcion, costo, precio_venta
        FROM formulas WHERE producto_terminado_id = ANY(${productIds}) ORDER BY producto_terminado_id, nombre
      `;
    }

    // Agrupar 'tamaños' por producto usando las fórmulas
    const tamanosPorProducto = {};
    (formulasRows || []).forEach(f => {
      const entry = {
        id: f.id, // id de la fórmula
        nombre: f.tamano_descripcion || null,
        cantidad: null,
        unidad: null,
        costo: f.costo != null ? Number(f.costo) : null,
        precio_venta: f.precio_venta != null ? Number(f.precio_venta) : null,
        factor_multiplicador_venta: null,
        precio_calculado: null,
        costo_pedido: f.costo != null ? Number(f.costo) : null
      };
      if (!tamanosPorProducto[f.producto_id]) tamanosPorProducto[f.producto_id] = [];
      tamanosPorProducto[f.producto_id].push(entry);
    });

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
      const categoria = p.categoria_id ? {
        id: p.categoria_id,
        nombre: p.categoria_nombre || null,
        descripcion: p.categoria_descripcion || null
      } : null;
      const marca = p.marca_id ? {
        id: p.marca_id,
        nombre: p.marca_nombre || null
      } : null;
      return {
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        stock: Number(p.stock),
        precio_venta: p.precio_venta,
        tamanos: tamanosPorProducto[p.id] || [],
        image_url: p.image_url,
        categoria,
        marca,
        inventario
      };
    });
    res.json(enriched);
  } catch (err) {
    console.error('Error en /api/productos/catalogo', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
