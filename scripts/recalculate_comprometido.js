#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function recalcProduct(prodId) {
  // Ejecutar por producto en su propia transacción
  await sql`BEGIN`;
  try {
    const sumRes = await sql`
      SELECT COALESCE(SUM(pvprod.cantidad),0) AS esperado
      FROM pedido_venta_productos pvprod
      JOIN pedidos_venta pv ON pv.id = pvprod.pedido_venta_id
      WHERE pvprod.producto_id = ${prodId} AND pv.estado IN ('Pendiente','Enviado')
    `;
    const esperado = (sumRes && sumRes[0] && Number(sumRes[0].esperado)) || 0;

    const invs = await sql`
      SELECT * FROM inventario WHERE producto_id = ${prodId} ORDER BY stock_fisico DESC FOR UPDATE
    `;

    let remaining = esperado;
    const adjustments = [];
    let totalAvailable = 0;
    for (const inv of invs) totalAvailable += Number(inv.stock_fisico || 0);

    if (invs.length === 0) {
      // nothing to adjust, but still commit
      await sql`COMMIT`;
      return { producto_id: prodId, esperado, totalAvailable: 0, adjustments: [], note: 'No hay inventario para este producto' };
    }

    for (const inv of invs) {
      if (remaining <= 0) {
        if (Number(inv.stock_comprometido) !== 0) {
          await sql`UPDATE inventario SET stock_comprometido = 0 WHERE id = ${inv.id}`;
          adjustments.push({ almacen_id: inv.almacen_id, id: inv.id, set_to: 0 });
        }
        continue;
      }
      const assign = Math.min(Number(inv.stock_fisico || 0), remaining);
      await sql`UPDATE inventario SET stock_comprometido = ${assign} WHERE id = ${inv.id}`;
      adjustments.push({ almacen_id: inv.almacen_id, id: inv.id, set_to: assign });
      remaining -= assign;
    }

    await sql`COMMIT`;
    return { producto_id: prodId, esperado, totalAvailable, adjustments, remaining_not_assigned: remaining };
  } catch (err) {
    try { await sql`ROLLBACK`; } catch(e) {}
    throw err;
  }
}

async function main() {
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log('Precaución: para ejecutar exporta FORCE_CLEAR=true o pasa --yes');
    process.exit(1);
  }

  console.log('Recalculando stock_comprometido para todos los productos (basado en pedidos Pendiente/Enviado)');
  try {
    const prods = await sql`SELECT id FROM productos`;
    const results = [];
    for (const p of prods) {
      try {
        const r = await recalcProduct(p.id);
        results.push(r);
        console.log(`Producto ${p.id}: esperado=${r.esperado} disponible=${r.totalAvailable} remaining=${r.remaining_not_assigned || 0}`);
      } catch (err) {
        console.error('Error recalculando producto', p.id, err.message);
        results.push({ producto_id: p.id, error: err.message });
      }
    }
    console.log('Recalculo completado. Productos procesados:', results.length);
    // Summary counts
    const warnings = results.filter(r => r.remaining_not_assigned && r.remaining_not_assigned > 0);
    console.log('Productos con falta de capacidad (remaining_not_assigned>0):', warnings.length);
    process.exit(0);
  } catch (err) {
    console.error('Error en recalculo global:', err);
    process.exit(2);
  }
}

main();
