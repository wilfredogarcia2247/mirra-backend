require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Migrando datos de `tamanos` a `formulas` (cuando formulas.tamano_id referencia tamaño)...');
  try {
    const rows = await sql`SELECT f.id AS formula_id, f.tamano_id FROM formulas f WHERE f.tamano_id IS NOT NULL`;
    if (!rows || rows.length === 0) {
      console.log('No hay fórmulas con tamano_id para migrar.');
      process.exit(0);
    }
    let updated = 0;
    for (const r of rows) {
      try {
        const tam = await sql`SELECT nombre, costo, precio_venta FROM tamanos WHERE id = ${r.tamano_id}`;
        if (!tam || tam.length === 0) continue;
        const t = tam[0];
        await sql`
          UPDATE formulas SET nombre = ${t.nombre}, costo = ${t.costo}, precio_venta = ${t.precio_venta} WHERE id = ${r.formula_id}
        `;
        updated++;
      } catch (e) {
        console.error('Error migrando fórmula', r, e.message || e);
      }
    }
    console.log(`Migración completa. Fórmulas actualizadas: ${updated}/${rows.length}`);
    process.exit(0);
  } catch (err) {
    console.error('Error en migración:', err);
    process.exit(2);
  }
}

main();
