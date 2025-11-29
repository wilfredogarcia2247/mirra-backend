#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function run(query) {
  try {
    #!/usr/bin/env node
    require('dotenv').config();
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    async function run(query) {
      try {
        return await sql.query(query);
      } catch (err) {
        console.warn('SQL error (continuando):', (err && err.message) || err);
        return null;
      }
    }

    async function main() {
      console.log('Seed demo: empezando...');

      // Formas de pago
      await run("INSERT INTO formas_pago (nombre) VALUES ('Efectivo'),('Tarjeta'),('Transferencia') ON CONFLICT (nombre) DO NOTHING;");

      // Bancos
      await run("INSERT INTO bancos (nombre) VALUES ('Banco Demo') ON CONFLICT (nombre) DO NOTHING;");
      await run("INSERT INTO bancos (nombre) VALUES ('Banco de Venezuela') ON CONFLICT (nombre) DO NOTHING;");

      // Asociaciones banco -> formas_pago (si la tabla existe)
      await run("INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles) SELECT b.id, f.id, jsonb_build_object('demo',true) FROM bancos b, formas_pago f WHERE b.nombre='Banco Demo' AND f.nombre='Transferencia' AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);");

      // Marcas y categorías
      await run("INSERT INTO marcas (nombre) VALUES ('Marca Demo') ON CONFLICT (nombre) DO NOTHING;");
      await run("INSERT INTO categorias (nombre) VALUES ('Perfumes') ON CONFLICT (nombre) DO NOTHING;");

      // Almacenes
      await run("INSERT INTO almacenes (nombre, tipo) VALUES ('Almacén Central', 'venta') ON CONFLICT (nombre) DO NOTHING;");

      // Producto demo
      await run("INSERT INTO productos (nombre, unidad, stock, costo, precio_venta, marca_id, categoria_id) VALUES ('Perfume Demo','unidad',0,10.0,25.0, (SELECT id FROM marcas WHERE nombre='Marca Demo'), (SELECT id FROM categorias WHERE nombre='Perfumes')) ON CONFLICT (nombre) DO UPDATE SET unidad=EXCLUDED.unidad, stock=EXCLUDED.stock, costo=EXCLUDED.costo, precio_venta=EXCLUDED.precio_venta;");

      // Obtener id del producto insertado
      const prodRes = await run("SELECT id FROM productos WHERE nombre = 'Perfume Demo' LIMIT 1;");
      const productoId = prodRes && prodRes.rows && prodRes.rows[0] ? prodRes.rows[0].id : 1;

      // Formulas (presentaciones/tamaños) asociadas al producto
      await run(`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${productoId}, '30ml', 10.0, 25.0) ON CONFLICT DO NOTHING;`);
      await run(`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${productoId}, '50ml', 15.0, 35.0) ON CONFLICT DO NOTHING;`);

      // Inventario (stock físico)
      await run(`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${productoId}, (SELECT id FROM almacenes WHERE nombre='Almacén Central' LIMIT 1), 100, 0) ON CONFLICT (producto_id, almacen_id) DO UPDATE SET stock_fisico = EXCLUDED.stock_fisico, stock_comprometido = EXCLUDED.stock_comprometIDO;`);

      // Precios: opcional (si existe tabla precios)
      await run(`INSERT INTO precios (producto_id, precio) VALUES (${productoId}, 25.0) ON CONFLICT (producto_id) DO UPDATE SET precio = EXCLUDED.precio;`);

      // Pedido demo básico
      await run("INSERT INTO pedidos_venta (id, estado) VALUES (1, 'CREADO') ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado;");
      await run(`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad) VALUES (1, ${productoId}, 1) ON CONFLICT (pedido_venta_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;`);

      // Pago demo
      await run(`INSERT INTO pagos (id, pedido_venta_id, forma_pago_id, monto) VALUES (1, 1, (SELECT id FROM formas_pago WHERE nombre='Tarjeta' LIMIT 1), 35.0) ON CONFLICT (id) DO UPDATE SET monto = EXCLUDED.monto, forma_pago_id = EXCLUDED.forma_pago_id;`);

      console.log('Seed demo: finalizado.');
      process.exit(0);
    }

    main().catch(err => {
      console.error('Seed demo: error', err);
      process.exit(2);
    });
    return await sql.query(query);
