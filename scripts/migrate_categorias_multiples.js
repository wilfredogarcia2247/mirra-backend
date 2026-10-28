/*
 * Permite que un perfume tenga varias categorías y elimina "Unisex".
 *
 * 1. Crea la tabla producto_categorias (si no existe).
 * 2. Copia la categoría actual de cada producto (productos.categoria_id) a esa tabla.
 * 3. Los productos en "Unisex" pasan a tener "Hombre" y "Mujer", y se borra la categoría "Unisex".
 *
 * Uso:
 *   node scripts/migrate_categorias_multiples.js            -> solo muestra lo que haría (no cambia nada)
 *   node scripts/migrate_categorias_multiples.js --aplicar  -> hace los cambios
 *
 * Se puede correr varias veces sin problema.
 */
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const aplicar = process.argv.includes('--aplicar');

async function buscarCategoria(nombre) {
  const rows = await sql`SELECT id, nombre FROM categorias WHERE LOWER(TRIM(nombre)) = ${nombre} ORDER BY id`;
  if (rows.length > 1) throw new Error(`Hay ${rows.length} categorías llamadas "${nombre}". Unifíquelas antes de continuar.`);
  return rows[0] || null;
}

async function main() {
  console.log('Base de datos:', new URL(process.env.DATABASE_URL).host);
  console.log(aplicar ? 'Modo: APLICAR CAMBIOS\n' : 'Modo: SOLO REVISAR (use --aplicar para hacer los cambios)\n');

  const hombre = await buscarCategoria('hombre');
  const mujer = await buscarCategoria('mujer');
  const unisex = await buscarCategoria('unisex');
  console.log('Hombre:', hombre ? `id ${hombre.id}` : 'NO EXISTE');
  console.log('Mujer: ', mujer ? `id ${mujer.id}` : 'NO EXISTE');
  console.log('Unisex:', unisex ? `id ${unisex.id}` : 'no existe (nada que convertir)');

  if (unisex && (!hombre || !mujer)) {
    throw new Error('Para convertir Unisex deben existir las categorías "Hombre" y "Mujer".');
  }

  const conCategoria = await sql`SELECT COUNT(*)::int AS n FROM productos WHERE categoria_id IS NOT NULL`;
  console.log(`\nProductos con categoría que se copiarán a la tabla nueva: ${conCategoria[0].n}`);

  let unisexProductos = [];
  if (unisex) {
    const tabla = await sql`SELECT to_regclass('public.producto_categorias') AS t`;
    unisexProductos = tabla[0].t
      ? await sql`
          SELECT p.id, p.nombre FROM productos p
          WHERE p.categoria_id = ${unisex.id}
             OR p.id IN (SELECT producto_id FROM producto_categorias WHERE categoria_id = ${unisex.id})
          ORDER BY p.nombre`
      : await sql`SELECT id, nombre FROM productos WHERE categoria_id = ${unisex.id} ORDER BY nombre`;
    console.log(`Productos Unisex que pasarán a Hombre y Mujer: ${unisexProductos.length}`);
    unisexProductos.slice(0, 20).forEach((p) => console.log(`  - ${p.nombre}`));
    if (unisexProductos.length > 20) console.log(`  ... y ${unisexProductos.length - 20} más`);
  }

  if (!aplicar) {
    console.log('\nNo se cambió nada. Para aplicar: node scripts/migrate_categorias_multiples.js --aplicar');
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS producto_categorias (
      producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
      PRIMARY KEY (producto_id, categoria_id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_producto_categorias_categoria ON producto_categorias (categoria_id)`;
  console.log('\nTabla producto_categorias lista.');

  const copiados = await sql`
    INSERT INTO producto_categorias (producto_id, categoria_id)
    SELECT id, categoria_id FROM productos WHERE categoria_id IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING producto_id`;
  console.log(`Categorías copiadas: ${copiados.length}`);

  if (unisex) {
    // Todo en una sola sentencia para que no quede a medias
    const res = await sql`
      WITH afectados AS (
        SELECT id AS producto_id FROM productos WHERE categoria_id = ${unisex.id}
        UNION SELECT producto_id FROM producto_categorias WHERE categoria_id = ${unisex.id}
      ),
      nuevas AS (
        INSERT INTO producto_categorias (producto_id, categoria_id)
        SELECT a.producto_id, c.id FROM afectados a CROSS JOIN (VALUES (${hombre.id}::int), (${mujer.id}::int)) AS c(id)
        ON CONFLICT DO NOTHING
        RETURNING producto_id
      ),
      principal AS (
        UPDATE productos SET categoria_id = ${hombre.id} WHERE categoria_id = ${unisex.id} RETURNING id
      ),
      quitar AS (
        DELETE FROM producto_categorias WHERE categoria_id = ${unisex.id} RETURNING producto_id
      )
      SELECT (SELECT COUNT(*) FROM afectados)::int AS productos,
             (SELECT COUNT(*) FROM nuevas)::int AS nuevas,
             (SELECT COUNT(*) FROM principal)::int AS principal`;
    console.log(`Unisex convertidos: ${res[0].productos} productos (${res[0].nuevas} categorías agregadas).`);
    await sql`DELETE FROM categorias WHERE id = ${unisex.id}`;
    console.log('Categoría "Unisex" eliminada.');
  }

  console.log('\nListo.');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
