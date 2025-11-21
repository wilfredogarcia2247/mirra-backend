#!/usr/bin/env node
// scripts/clear_except_usuarios.js
// Uso: node scripts/clear_except_usuarios.js [--yes]
// Sin --yes lista las tablas que se vaciarían. Con --yes ejecuta TRUNCATE ... CASCADE.
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL no encontrada en .env');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  // Tablas que NO deben borrarse
  const keepTables = new Set(['usuarios']);

  // Obtener tablas user-defined en schema public
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const names = (tables || []).map((r) => r.table_name).filter(Boolean);
  const toClear = names.filter((n) => !keepTables.has(n));

  if (toClear.length === 0) {
    console.log('No se encontraron tablas para truncar (aparte de `usuarios`). Nada que hacer.');
    process.exit(0);
  }

  console.log('Tablas encontradas (se mantendrá `usuarios`):');
  names.forEach((n) => {
    if (keepTables.has(n)) console.log(`  KEEP: ${n}`);
    else console.log(`  CLEAR: ${n}`);
  });

  const confirmed = process.argv.includes('--yes');
  if (!confirmed) {
    console.log('\nEjecución pendiente. Si estás seguro, vuelve a ejecutar con --yes para confirmar.');
    process.exit(0);
  }

  try {
    await sql`BEGIN`;
    for (const t of toClear) {
      console.log('Truncating', t);
      try {
        // Usamos TRUNCATE ... CASCADE para evitar problemas con FK
        await sql.raw(`TRUNCATE TABLE public."${t}" CASCADE;`);
      } catch (e) {
        console.error('Error truncating', t, e && e.message ? e.message : e);
        throw e;
      }
    }
    await sql`COMMIT`;
    console.log('Truncado completado.');
    process.exit(0);
  } catch (err) {
    try {
      await sql`ROLLBACK`;
    } catch (e) {}
    console.error('Error durante truncado:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Fatal:', e && e.message ? e.message : e);
  process.exit(3);
});
