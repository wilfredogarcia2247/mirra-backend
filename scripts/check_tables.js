#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const t = await sql`SELECT to_regclass('public.banco_formas_pago') AS t`;
    const cols =
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name='pagos' AND column_name IN ('referencia','fecha_transaccion')`;
    const table = t && t[0] && t[0].t ? t[0].t : null;
    console.log(JSON.stringify({ table, columns: (cols || []).map((r) => r.column_name) }));
  } catch (e) {
    console.error('ERROR', e);
    process.exit(2);
  } finally {
    process.exit(0);
  }
})();
