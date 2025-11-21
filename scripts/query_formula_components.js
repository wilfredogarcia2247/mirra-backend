require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const fids = [1, 2];
    // Detectar si existe la tabla "ingredientes" en el esquema
    const ingTbl = await sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ingredientes' LIMIT 1`;
    const hasIngredientes = !!(ingTbl && ingTbl.length > 0);
    for (const id of fids) {
      let rows;
      if (hasIngredientes) {
        rows = await sql`SELECT fc.materia_prima_id, fc.cantidad, fc.unidad, mp.id as producto_id_component, ing.id as ingrediente_id_component, COALESCE(mp.nombre, ing.nombre) AS nombre FROM formula_componentes fc LEFT JOIN productos mp ON mp.id=fc.materia_prima_id LEFT JOIN ingredientes ing ON ing.id=fc.materia_prima_id WHERE fc.formula_id=${id}`;
      } else {
        rows = await sql`SELECT fc.materia_prima_id, fc.cantidad, fc.unidad, mp.id as producto_id_component, NULL::int as ingrediente_id_component, COALESCE(mp.nombre, NULL) AS nombre FROM formula_componentes fc LEFT JOIN productos mp ON mp.id=fc.materia_prima_id WHERE fc.formula_id=${id}`;
      }
      console.log('FÓRMULA', id, JSON.stringify(rows, null, 2));
    }
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e);
    process.exit(1);
  }
})();