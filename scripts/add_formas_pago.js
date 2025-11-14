require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function upsert() {
  try {
    const formas = ['tarjeta', 'transferencia', 'efectivo'];
    for (const nombre of formas) {
      const exists = await sql`SELECT * FROM formas_pago WHERE LOWER(nombre) = ${nombre} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO formas_pago (nombre) VALUES (${nombre})`;
        console.log('Inserted:', nombre);
      } else {
        console.log('Already exists:', nombre);
      }
    }
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

upsert();
