require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrateAndDrop() {
  try {
    console.log('Iniciando migración de precio_unitario -> precio_venta y DROP COLUMN...');

    // Asegurar columnas objetivo (no hacen daño si ya existen)
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`;
    } catch (e) {}

    // Ver si la columna precio_unitario existe
    const colExistsRes = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'pedido_venta_productos' AND column_name = 'precio_unitario' AND table_schema = 'public'
    `;
    const colExists = !!(colExistsRes && colExistsRes.length > 0);
    if (!colExists) {
      console.log('La columna precio_unitario no existe — nada que migrar o dropear.');
    } else {
      // Ver cuántas filas tienen precio_unitario
      const countBefore =
        await sql`SELECT COUNT(*)::int AS c FROM pedido_venta_productos WHERE precio_unitario IS NOT NULL`;
      const before = countBefore && countBefore[0] ? Number(countBefore[0].c) : 0;
      console.log('Filas con precio_unitario antes:', before);

      await sql`BEGIN`;
      try {
        // Migrar valores: copiar precio_unitario a precio_venta solo donde precio_venta IS NULL
        await sql`
          UPDATE pedido_venta_productos pv
          SET precio_venta = pv.precio_unitario
          WHERE pv.precio_unitario IS NOT NULL AND pv.precio_venta IS NULL
        `;

        // DROP column precio_unitario
        await sql`ALTER TABLE pedido_venta_productos DROP COLUMN IF EXISTS precio_unitario`;

        await sql`COMMIT`;
      } catch (err) {
        try {
          await sql`ROLLBACK`;
        } catch (e) {}
        throw err;
      }

      const countAfter =
        await sql`SELECT COUNT(*)::int AS c FROM pedido_venta_productos WHERE precio_unitario IS NOT NULL`;
      const after = countAfter && countAfter[0] ? Number(countAfter[0].c) : 0;
      console.log('Filas con precio_unitario después (debe ser 0):', after);
    }

    console.log('Migración y DROP COLUMN completados.');
    process.exit(0);
  } catch (err) {
    console.error('Error en migración y DROP COLUMN:', err);
    process.exit(2);
  }
}

migrateAndDrop();
