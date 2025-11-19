#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Ejecutando truncado seguro.');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log(
      'Para ejecutar exporta FORCE_CLEAR=true o pasa --yes. Ej: FORCE_CLEAR=true node scripts/truncate_except_tables_safe.js'
    );
    process.exit(1);
  }
  const excludeEnv = process.env.EXCLUDE || 'usuarios,formas_pago';
  const excludeList = excludeEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  try {
    const tables =
      await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type='BASE TABLE'`;
    for (const r of tables) {
      const t = r.table_name;
      if (excludeList.includes(t.toLowerCase())) {
        console.log('Preservando tabla:', t);
        continue;
      }
      console.log('Truncando tabla:', t);
      try {
        await sql.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE;`);
      } catch (e) {
        console.error('Error truncando', t, e.message || e);
        throw e;
      }
    }
    console.log('Truncado seguro completado. Excluidas:', excludeList.join(', '));
    process.exit(0);
  } catch (err) {
    console.error('Error en truncado seguro:', err);
    process.exit(2);
  }
}

main();
