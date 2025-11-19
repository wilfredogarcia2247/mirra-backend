#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async function () {
  try {
    // Reusar la lógica de producto ids del catálogo
    const prodIdRows = await sql`
      SELECT DISTINCT p.id FROM productos p
      JOIN inventario i ON i.producto_id = p.id
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE a.es_materia_prima IS NOT TRUE AND (i.stock_fisico - i.stock_comprometido) > 0
    `;
    const prodIds = (prodIdRows || []).map((r) => r.id);
    if (prodIds.length === 0) {
      console.log('No hay productos visibles en el catálogo público');
      process.exit(0);
    }
    const rows = await sql`
      SELECT p.id, p.nombre, p.unidad, COALESCE(inv_tot.stock_disponible_total, 0) AS stock
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS stock_disponible_total
        FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE a.es_materia_prima IS NOT TRUE
        GROUP BY producto_id
      ) inv_tot ON inv_tot.producto_id = p.id
      WHERE p.id = ANY(${prodIds})
    `;
    console.log('Productos visibles en catálogo público:');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error listando catálogo público:', e);
    process.exit(2);
  }
})();
