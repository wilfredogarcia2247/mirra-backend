#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const argv = process.argv.slice(2);
  const doExec = argv.includes('--exec') || argv.includes('--yes') || argv.includes('-y');

  console.log('Preparando borrado de datos (no se eliminarán `formas_pago` ni `usuarios`)');

  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;

  const excluded = new Set(['formas_pago', 'usuarios']);
  const tables = (rows || []).map(r => r.table_name).filter(t => !excluded.has(t));

  if (!tables || tables.length === 0) {
    console.log('No se encontraron tablas para truncar. Nada que hacer.');
    process.exit(0);
  }

  console.log('Tablas que se vaciarán:');
  tables.forEach(t => console.log(' -', t));

  if (!doExec) {
    console.log('\nEjecuta este script con `node scripts/clear_except_formas_pago_usuarios.js --exec` para proceder.');
    process.exit(0);
  }

  try {
    // Construir y ejecutar TRUNCATE para cada tabla de forma segura
    // Usamos RESTART IDENTITY CASCADE para reiniciar secuencias y limpiar dependencias
    for (const t of tables) {
      console.log('Truncando', t);
      // `sql` tagged template doesn't accept identifiers via interpolation here.
      // Use sql.query with a safely-quoted identifier.
      const safeName = t.replace(/"/g, '""');
      await sql.query(`TRUNCATE TABLE "${safeName}" RESTART IDENTITY CASCADE`);
    }
    console.log('Borrado completado. Se han truncado las tablas listadas (excepto formas_pago y usuarios).');
  } catch (err) {
    console.error('Error durante truncado:', err);
    process.exit(2);
  }
}

main();
