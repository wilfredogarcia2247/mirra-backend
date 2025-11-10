require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function reset() {
  try {
    console.log('Borrando y recreando tablas pedidos_venta y pedido_venta_productos...');
    await sql`BEGIN`;
    try {
      // Borrar tablas si existen (uso CASCADE para eliminar dependencias)
      await sql`DROP TABLE IF EXISTS pedido_venta_productos CASCADE`;
      await sql`DROP TABLE IF EXISTS pedidos_venta CASCADE`;

      // Recrear tabla pedidos_venta
      await sql`
        CREATE TABLE pedidos_venta (
          id SERIAL PRIMARY KEY,
          cliente_id INT,
          nombre_cliente TEXT,
          telefono TEXT,
          cedula TEXT,
          estado VARCHAR(30),
          fecha TIMESTAMP,
          origen_ip TEXT,
          user_agent TEXT,
          tasa_cambio_monto NUMERIC
        )
      `;

      // Recrear tabla pedido_venta_productos
      await sql`
        CREATE TABLE pedido_venta_productos (
          id SERIAL PRIMARY KEY,
          pedido_venta_id INT,
          producto_id INT,
          cantidad INT,
          costo_unitario NUMERIC,
          precio_venta NUMERIC,
          nombre_producto TEXT
        )
      `;

      await sql`COMMIT`;
      console.log('Tablas recreadas correctamente.');
      process.exit(0);
    } catch (e) {
      try { await sql`ROLLBACK`; } catch (e2) {}
      throw e;
    }
  } catch (err) {
    console.error('Error recreando tablas de pedidos:', err);
    process.exit(2);
  }
}

reset();
