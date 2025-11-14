#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('ATENCIÓN: este script TRUNCARÁ todas las tablas excepto `usuarios`.');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log('Para ejecutar exporta FORCE_CLEAR=true o pasa --yes. Ej: FORCE_CLEAR=true node scripts/truncate_except_usuarios.js');
    process.exit(1);
  }

  try {
    // Ejecutar truncado dinámico: truncar todas las tablas excepto 'usuarios' y 'formas_pago'
    await sql`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type='BASE TABLE' AND table_name NOT IN ('usuarios','formas_pago') LOOP
          EXECUTE format('TRUNCATE TABLE "%I" RESTART IDENTITY CASCADE', r.table_name);
        END LOOP;
      END$$;
    `;

    console.log('Truncado completado. Solo `usuarios` debería conservar filas (si existían).');
    process.exit(0);
  } catch (err) {
    console.error('Error ejecutando truncado:', err);
    process.exit(2);
  }
}

main();
