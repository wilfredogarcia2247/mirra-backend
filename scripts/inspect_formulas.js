require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const rows = await sql`SELECT id, producto_terminado_id, nombre FROM formulas ORDER BY id`;
    console.log('Formulas rows:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error inspecting formulas:', err);
    process.exit(2);
  }
})();
