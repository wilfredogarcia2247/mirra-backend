require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async function () {
  try {
    const tables =
      await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
    for (const r of tables) {
      const t = r.table_name;
      const res = await sql.query(`SELECT COUNT(*) AS c FROM "${t}"`);
      const c = res && res[0] && res[0].c ? res[0].c : res && res.rowCount ? res.rowCount : 0;
      console.log(t.padEnd(30), c.toString());
    }
    process.exit(0);
  } catch (e) {
    console.error('Error listando conteos:', e);
    process.exit(2);
  }
})();
