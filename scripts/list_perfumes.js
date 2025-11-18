#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async function(){
  try {
    const rows = await sql`
      SELECT p.id, p.nombre,
        COALESCE(json_agg(json_build_object('id',t.id,'nombre',t.nombre,'precio_calculado',(SELECT precio_venta_final FROM precio_productos pp WHERE pp.producto_id=p.id AND pp.tamano_id=t.id LIMIT 1)) ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tamanos
      FROM productos p
      LEFT JOIN tamanos t ON t.producto_id = p.id
      WHERE p.nombre ILIKE 'Perfume %'
      GROUP BY p.id
      ORDER BY p.id
    `;
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error listando perfumes:', e);
    process.exit(2);
  }
})();
