require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log(
    'Aplicando migraciones: agregando columnas de pricing (productos.margen, tamanos.factor_multiplicador_venta) ...'
  );
  try {
    try {
      await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen NUMERIC;`;
    } catch (e) {}
    try {
      await sql`UPDATE productos SET margen = 3.0 WHERE margen IS NULL;`;
    } catch (e) {}

    // Skip tamanos migration when the table does not exist in this schema
    try {
      const tbl =
        await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tamanos' LIMIT 1`;
      if (tbl && tbl.length > 0) {
        try {
          await sql`ALTER TABLE tamanos ADD COLUMN IF NOT EXISTS factor_multiplicador_venta NUMERIC;`;
        } catch (e) {}
        try {
          await sql`UPDATE tamanos SET factor_multiplicador_venta = 1.0 WHERE factor_multiplicador_venta IS NULL;`;
        } catch (e) {}
      }
    } catch (e) {}

    console.log('Migración completada.');
  } catch (err) {
    console.error('Error aplicando migración:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

run();
