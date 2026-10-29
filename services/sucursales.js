const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
let tableEnsured = false;

async function ensureSucursalesTable() {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS sucursales (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      direccion TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT TRUE,
      creado_en TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
  `;
  tableEnsured = true;
}

module.exports = { sql, ensureSucursalesTable };
