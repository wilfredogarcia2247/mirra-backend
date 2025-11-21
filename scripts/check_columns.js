require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async ()=>{
  try {
    console.log('Checking columns for pedido_venta_productos...');
    const pvp = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='pedido_venta_productos' ORDER BY column_name`;
    console.log(JSON.stringify(pvp, null, 2));

    console.log('\nChecking columns for productos...');
    const prod = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='productos' ORDER BY column_name`;
    console.log(JSON.stringify(prod, null, 2));

    console.log('\nChecking columns for inventario...');
    const inv = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='inventario' ORDER BY column_name`;
    console.log(JSON.stringify(inv, null, 2));
  } catch (e) {
    console.error('Error running check:', e && e.message ? e.message : e);
    console.error(e);
  } finally {
    process.exit();
  }
})();
