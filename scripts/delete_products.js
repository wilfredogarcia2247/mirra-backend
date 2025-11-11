#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Eliminar todos los productos (TRUNCATE productos) - acción destructiva');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
  if (!force) {
    if (dryRun) {
      console.log('Modo dry-run activado: no se realizará ningún borrado. Mostrando información de lo que se eliminaría:');
    } else {
      console.log('Precaución: para ejecutar exporta FORCE_CLEAR=true o pasa --yes');
      process.exit(1);
    }
  }

  try {
    // En modo dry-run no ejecutamos cambios destructivos, pero mostramos conteos útiles
    if (dryRun) {
      try {
        const prodCount = await sql`SELECT COUNT(*)::int AS c FROM productos`;
        const inventarioRefs = await sql`SELECT COUNT(*)::int AS c FROM inventario WHERE producto_id IS NOT NULL`;
        const prodC = (prodCount && prodCount[0] && prodCount[0].c) || 0;
        const invC = (inventarioRefs && inventarioRefs[0] && inventarioRefs[0].c) || 0;
        console.log(`Productos totales: ${prodC}`);
        console.log(`Filas en inventario con producto_id no nulo: ${invC}`);
        console.log('NOTA: El TRUNCATE propuesto sería: TRUNCATE TABLE productos RESTART IDENTITY CASCADE;');
        console.log('Dry-run completado. No se realizaron cambios.');
        try { await sql`ROLLBACK`; } catch (e) {}
        process.exit(0);
      } catch (e) {
        console.error('Error obteniendo conteos en dry-run:', e);
        try { await sql`ROLLBACK`; } catch (ee) {}
        process.exit(2);
      }
    } else {
      await sql`BEGIN`;
      // Truncar productos y cualquier tabla que dependa de ellos con CASCADE
      await sql`TRUNCATE TABLE productos RESTART IDENTITY CASCADE;`;
      // También limpiar inventario por si hay referencias residuales
      try { await sql`DELETE FROM inventario WHERE producto_id IS NULL;`; } catch(e) {}
      await sql`COMMIT`;
      console.log('Tabla productos truncada correctamente.');
    }
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    console.error('Error truncando productos:', err);
    process.exit(2);
  }
}

main();
