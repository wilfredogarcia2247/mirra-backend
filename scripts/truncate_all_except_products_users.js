#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Truncar todas las tablas excepto `productos` y `usuarios` (precaución)');
  const force = process.env.FORCE_CLEAR === 'true' || process.argv.includes('--yes');
  if (!force) {
    console.log(
      'Precaución: este script borrará datos. Para ejecutar exporta FORCE_CLEAR=true o pasa --yes. Ej: FORCE_CLEAR=true node scripts/truncate_all_except_products_users.js'
    );
    process.exit(1);
  }

  try {
    // Lista de tablas que queremos truncar (intentar) — mantenemos `productos` y `usuarios`.
    const tables = [
      'pedido_venta_productos',
      'pedidos_venta',
      'pedido_compra_productos',
      'pedidos_compra',
      'inventario_movimientos',
      'ordenes_produccion',
      'pagos',
      'tasas_cambio',
      'bancos',
      'almacenes',
      'formulas',
      'formula_componentes',
      'formas_pago',
      'inventario',
    ];

    // Ejecutar TRUNCATE dinámico excepto la tabla 'usuarios' usando DO block para evitar problemas de parsing
    console.log('Truncando todas las tablas del schema public excepto `usuarios`...');
    await sql`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type='BASE TABLE' AND table_name <> 'usuarios' LOOP
        -- Evitar truncar metadatos si existieran tablas especiales
        IF r.table_name NOT IN ('productos','usuarios') THEN
          EXECUTE format('TRUNCATE TABLE "%I" RESTART IDENTITY CASCADE', r.table_name);
        END IF;
      END LOOP;
    END$$;
  `;

    console.log('Truncate completado.');
  } catch (err) {
    console.error('Error truncando tablas:', err);
    process.exit(2);
  }
}

main();
