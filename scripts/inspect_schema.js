#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function inspect() {
  try {
    console.log('Listando tablas públicas...');
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`; 
    for (const t of tables) console.log('- ' + t.table_name);

    console.log('\nColumnas por tabla (information_schema.columns):');
    const cols = await sql`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
    let last = null;
    for (const c of cols) {
      if (c.table_name !== last) {
        console.log('\n' + c.table_name + ':');
        last = c.table_name;
      }
      console.log('  - ' + c.column_name + ' (' + c.data_type + ')');
    }
    process.exit(0);
  } catch (err) {
    console.error('Error inspeccionando esquema:', err);
    process.exit(2);
  }
}

inspect();
