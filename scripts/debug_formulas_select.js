require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  try {
    const rows = await sql`SELECT f.*, t.id AS tamano_id, t.nombre AS tamano_nombre, t.cantidad AS tamano_cantidad, t.unidad AS tamano_unidad FROM formulas f LEFT JOIN tamanos t ON t.id = f.tamano_id`;
    console.log('formulas rows:', rows);
    for (const f of rows) {
      const comps = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${f.id}`;
      console.log('formula', f.id, 'components:', comps);
    }
    process.exit(0);
  } catch (e) {
    console.error('Error running diagnostic select:', e);
    process.exit(2);
  }
})();
