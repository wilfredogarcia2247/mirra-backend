#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const pagosCols =
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name='pagos' AND column_name IN ('tasa','tasa_simbolo')`;
    const bancosCols =
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name='bancos' AND column_name IN ('moneda')`;
    const res = {
      pagos: (pagosCols || []).map((r) => r.column_name),
      bancos: (bancosCols || []).map((r) => r.column_name),
    };
    console.log(JSON.stringify(res));
    process.exit(0);
  } catch (e) {
    console.error('ERROR', e);
    process.exit(2);
  }
})();
