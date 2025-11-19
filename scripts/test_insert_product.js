require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  try {
    const res =
      await sql`INSERT INTO productos (nombre,tipo,unidad,stock,costo,precio_venta) VALUES ('TestIns', 'ProductoTerminado','u',0,1,2) RETURNING *`;
    console.log('Inserted:', res[0]);
    process.exit(0);
  } catch (err) {
    console.error('ERR', err);
    process.exit(2);
  }
})();
