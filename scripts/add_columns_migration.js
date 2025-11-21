require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async function main(){
  try {
    console.log('Conectando y aplicando ALTERs...');
    await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS orden_produccion_id INT`;
    await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS produccion_creada BOOLEAN DEFAULT FALSE`;
    console.log('ALTERs aplicados. Listando columnas:');
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'pedido_venta_productos' ORDER BY ordinal_position`;
    if (Array.isArray(cols)) {
      console.log(cols.map(c => c.column_name).join(', '));
    } else {
      // fallback: try to print raw
      console.dir(cols);
    }
  } catch (e) {
    console.error('Error en migración:', e && e.message ? e.message : e);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
