require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const rows = await sql`SELECT id, nombre, tipo FROM almacenes`;
    console.log('Almacenes rows:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error inspecting almacenes:', err);
    process.exit(2);
  }
})();
