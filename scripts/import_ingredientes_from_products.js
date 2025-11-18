require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: set DATABASE_URL environment variable antes de ejecutar este script.');
    process.exit(1);
  }

  // Permite --all o --ids=1,2,3
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const idsArg = argv.find(a => a.startsWith('--ids='));
  let ids = null;
  if (idsArg) ids = idsArg.replace('--ids=', '').split(',').map(x => Number(x.trim())).filter(Boolean);

  try {
    let products = [];
    if (all) {
      products = await sql`SELECT id, nombre, unidad, costo FROM productos`;
    } else if (ids && ids.length > 0) {
      products = await sql`SELECT id, nombre, unidad, costo FROM productos WHERE id = ANY(${ids})`;
    } else {
      console.error('Ningún modo seleccionado. Usa --all o --ids=1,2,3');
      process.exit(1);
    }

    let created = 0;
    for (const p of products) {
      const codigo = `P${p.id}`;
      const unidad = p.unidad || 'ml';
      const costo = p.costo != null ? p.costo : 0;
      await sql`
        INSERT INTO ingredientes (codigo, nombre, unidad, costo)
        VALUES (${codigo}, ${p.nombre}, ${unidad}, ${costo})
        ON CONFLICT (codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre, unidad = EXCLUDED.unidad, costo = EXCLUDED.costo
      `;
      created++;
    }
    console.log(`Importación completada. Registros procesados: ${created}`);
  } catch (err) {
    console.error('Error importando ingredientes:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

run();
