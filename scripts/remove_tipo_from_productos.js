require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const col =
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'tipo'`;
    if (!col || col.length === 0) {
      console.log('La columna "tipo" no existe en productos. Nada que hacer.');
      process.exit(0);
    }

    console.log('Columna "tipo" encontrada. Procediendo a eliminar...');
    await sql`ALTER TABLE productos DROP COLUMN IF EXISTS tipo;`;
    console.log('Columna "tipo" eliminada correctamente.');
    process.exit(0);
  } catch (err) {
    console.error('Error al eliminar la columna tipo en productos:', err);
    process.exit(1);
  }
}

run();
