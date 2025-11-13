require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    console.log('Iniciando migración: MateriaPrima -> interno, normalizando almacenes');

    // Mostrar conteo antes
    const antesAlm = await sql`SELECT tipo, COUNT(*)::int AS c FROM almacenes GROUP BY tipo`;
    console.log('Antes - almacenes por tipo:', antesAlm);
    const antesProd = await sql`SELECT tipo, COUNT(*)::int AS c FROM productos GROUP BY tipo`;
    console.log('Antes - productos por tipo:', antesProd);

    // Normalizar almacenes: cualquier variante de 'venta' -> 'venta'
    await sql`UPDATE almacenes SET tipo = 'venta' WHERE LOWER(tipo) = 'venta'`;
    // Normalizar variantes internas: 'MateriaPrima', 'Materia Prima', 'Interno' -> 'interno'
    await sql`UPDATE almacenes SET tipo = 'interno' WHERE LOWER(tipo) = 'interno' OR tipo ILIKE 'materia%'`;

    // Actualizar productos: MateriaPrima -> interno
    await sql`UPDATE productos SET tipo = 'interno' WHERE tipo ILIKE 'materia%'`;

    // Mostrar conteo después
    const despuesAlm = await sql`SELECT tipo, COUNT(*)::int AS c FROM almacenes GROUP BY tipo`;
    console.log('Después - almacenes por tipo:', despuesAlm);
    const despuesProd = await sql`SELECT tipo, COUNT(*)::int AS c FROM productos GROUP BY tipo`;
    console.log('Después - productos por tipo:', despuesProd);

    console.log('Migración completada.');
    process.exit(0);
  } catch (err) {
    console.error('Error en migración:', err);
    process.exit(2);
  }
})();
