#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('ATENCIÓN: este script TRUNCARÁ todas las tablas excepto las listadas en EXCLUDE.');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log(
      'Para ejecutar exporta FORCE_CLEAR=true o pasa --yes. Ej: FORCE_CLEAR=true node scripts/truncate_except_tables.js'
    );
    process.exit(1);
  }

  // EXCLUDE puede venir como variable de entorno separada por comas, por defecto 'usuarios,formas_pago'
  const excludeEnv = process.env.EXCLUDE || 'usuarios,formas_pago';
  const excludeList = excludeEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  try {
    const excludeLiterals = excludeList.map((s) => `'${s}'`).join(',');
    const program = `DO $$\n      DECLARE r RECORD;\n      BEGIN\n        FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type='BASE TABLE' LOOP\n          IF lower(r.table_name) IN (${excludeLiterals}) THEN\n            -- skip\n          ELSE\n            EXECUTE format('TRUNCATE TABLE "%I" RESTART IDENTITY CASCADE', r.table_name);\n          END IF;\n        END LOOP;\n      END$$;`;
    await sql.query(program);

    console.log('Truncado completado. Tablas excluidas:', excludeList.join(', '));
    process.exit(0);
  } catch (err) {
    console.error('Error ejecutando truncado:', err);
    process.exit(2);
  }
}

main();
