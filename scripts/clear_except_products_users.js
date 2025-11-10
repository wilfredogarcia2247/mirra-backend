#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Script de vaciado selectivo: mantiene tablas `productos` y `usuarios` y reinicia pedidos/inventarios.');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log('Precaución: este script borrará datos. Para ejecutar exporta FORCE_CLEAR=true o pasa --yes. Ej: FORCE_CLEAR=true node scripts/clear_except_products_users.js');
    process.exit(1);
  }

  try {
    await sql`BEGIN`;

    // Truncar tablas relacionadas a pedidos, compras, produccion, movimientos y tasas
    await sql`
      TRUNCATE TABLE
        pedido_venta_productos,
        pedidos_venta,
        pedido_compra_productos,
        pedidos_compra,
        inventario_movimientos,
        ordenes_produccion,
        pagos,
        tasas_cambio
      RESTART IDENTITY CASCADE;
    `;

    // Dejar inventario pero resetear cantidades a 0 (conserva filas de inventario por almacen/producto)
    await sql`UPDATE inventario SET stock_fisico = 0, stock_comprometido = 0;`;

    // Recalcular inventario inicial: asignar el stock declarado en productos.stock al primer almacén de tipo 'Venta'
    const ventaAlmacen = await sql`SELECT id FROM almacenes WHERE tipo = 'Venta' LIMIT 1`;
    let ventaAlmacenId = null;
    if (ventaAlmacen && ventaAlmacen.length > 0) ventaAlmacenId = ventaAlmacen[0].id;
    if (!ventaAlmacenId) {
      console.log('No se encontró almacén de tipo Venta. Creando uno por defecto.');
      const created = await sql`INSERT INTO almacenes (nombre, tipo) VALUES ('Almacén de Venta', 'Venta') RETURNING id`;
      ventaAlmacenId = created[0].id;
    }

    // Para cada producto con campo stock, actualizar/insertar fila en inventario para el almacén de venta
    const productos = await sql`SELECT id, COALESCE(stock,0) AS stock FROM productos`;
    for (const prod of productos) {
      const prodId = prod.id;
      const stock = Number(prod.stock) || 0;
      const existing = await sql`SELECT id FROM inventario WHERE producto_id = ${prodId} AND almacen_id = ${ventaAlmacenId}`;
      if (existing && existing.length > 0) {
        await sql`UPDATE inventario SET stock_fisico = ${stock}, stock_comprometido = 0 WHERE id = ${existing[0].id}`;
      } else {
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${prodId}, ${ventaAlmacenId}, ${stock}, 0)`;
      }
    }

    // Opcional: dejar formulas, proveedores, almacenes, productos y usuarios intactos

    await sql`COMMIT`;
    console.log('Vaciado selectivo completado. Tablas truncadas y inventario reseteado.');
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    console.error('Error ejecutando vaciado selectivo:', err);
    process.exit(2);
  }
}

main();
