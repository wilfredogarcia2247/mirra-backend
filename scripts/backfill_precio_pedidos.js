require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function backfill() {
  try {
    console.log('Iniciando backfill de precio_venta en pedido_venta_productos...');
    // Asegurar las columnas necesarias por si la DB aún no tiene la migración aplicada
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos DROP COLUMN IF EXISTS precio_unitario;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN costo_unitario NUMERIC;`;
    } catch (e) {}
    const beforeRes =
      await sql`SELECT COUNT(*)::int AS c FROM pedido_venta_productos WHERE precio_venta IS NOT NULL`;
    const before = beforeRes && beforeRes[0] ? Number(beforeRes[0].c) : 0;
    // Actualizar nombre_producto con productos.nombre si está vacío
    await sql`
          UPDATE pedido_venta_productos pv
          SET nombre_producto = prod.nombre
          FROM productos prod
          WHERE prod.id = pv.producto_id AND pv.nombre_producto IS NULL
        `;

    await sql`BEGIN`;
    try {
      // Actualizar precio_venta con precio_unitario si existe, si no con productos.precio_venta
      // Actualizar precio_venta con productos.precio_venta para filas sin snapshot
      await sql`
          UPDATE pedido_venta_productos pv
          SET precio_venta = prod.precio_venta
          FROM productos prod
          WHERE prod.id = pv.producto_id AND pv.precio_venta IS NULL
        `;
      await sql`COMMIT`;
    } catch (e) {
      try {
        await sql`ROLLBACK`;
      } catch (e2) {}
      throw e;
    }

    const afterRes =
      await sql`SELECT COUNT(*)::int AS c FROM pedido_venta_productos WHERE precio_venta IS NOT NULL`;
    const after = afterRes && afterRes[0] ? Number(afterRes[0].c) : 0;
    console.log(
      `Backfill completado. Antes: ${before}, Después: ${after}, Afectadas: ${after - before}`
    );
    process.exit(0);
  } catch (err) {
    console.error('Error en backfill:', err);
    process.exit(2);
  }
}

backfill();
