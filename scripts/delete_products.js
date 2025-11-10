#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Eliminar todos los productos (TRUNCATE productos) - acción destructiva');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log('Precaución: para ejecutar exporta FORCE_CLEAR=true o pasa --yes');
    process.exit(1);
  }

  try {
    await sql`BEGIN`;
    // Truncar productos y cualquier tabla que dependa de ellos con CASCADE
    await sql`TRUNCATE TABLE productos RESTART IDENTITY CASCADE;`;
    // También limpiar inventario por si hay referencias residuales
    try { await sql`DELETE FROM inventario WHERE producto_id IS NULL;`; } catch(e) {}
    await sql`COMMIT`;
    console.log('Tabla productos truncada correctamente.');
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    console.error('Error truncando productos:', err);
    process.exit(2);
  }
}

main();
