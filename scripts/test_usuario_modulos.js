require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  try {
    const cols = await sql`SELECT column_name,data_type FROM information_schema.columns WHERE table_name='usuario_modulos' ORDER BY ordinal_position`;
    console.log('COLUMNS:', cols);
    const count = await sql`SELECT COUNT(*) AS c FROM usuario_modulos`;
    console.log('COUNT:', count[0] && count[0].c ? count[0].c : 0);
    const ins = await sql`INSERT INTO usuario_modulos (usuario_id,dashboard,tasas_cambio,bancos,marcas,categorias,almacenes,productos,formulas,pedidos) VALUES (NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE) RETURNING *`;
    console.log('INSERTED:', ins && ins[0] ? ins[0] : null);
    const sel = await sql`SELECT * FROM usuario_modulos ORDER BY id DESC LIMIT 3`;
    console.log('LAST ROWS:', sel);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
