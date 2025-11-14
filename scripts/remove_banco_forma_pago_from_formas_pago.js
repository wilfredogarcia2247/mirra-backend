require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    console.log('Intentando eliminar columna banco_forma_pago de formas_pago (si existe)...');
    await sql`ALTER TABLE formas_pago DROP COLUMN IF EXISTS banco_forma_pago;`;
    console.log('Operación completada.');
    process.exit(0);
  } catch (err) {
    console.error('Error al ejecutar el ALTER TABLE:', err);
    process.exit(1);
  }
}

run();
