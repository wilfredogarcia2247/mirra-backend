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
  console.log('Seed demo v2: empezando...');

  // Formas de pago: insertar si no existen (evitar ON CONFLICT sobre columnas sin índice único)
  await run("INSERT INTO formas_pago (nombre) SELECT 'Efectivo' WHERE NOT EXISTS (SELECT 1 FROM formas_pago WHERE nombre='Efectivo');");
  await run("INSERT INTO formas_pago (nombre) SELECT 'Tarjeta' WHERE NOT EXISTS (SELECT 1 FROM formas_pago WHERE nombre='Tarjeta');");
  await run("INSERT INTO formas_pago (nombre) SELECT 'Transferencia' WHERE NOT EXISTS (SELECT 1 FROM formas_pago WHERE nombre='Transferencia');");

  // Bancos: usar INSERT ... WHERE NOT EXISTS para evitar dependencias de índices únicos
  await run("INSERT INTO bancos (nombre) SELECT 'Banco Demo' WHERE NOT EXISTS (SELECT 1 FROM bancos WHERE nombre = 'Banco Demo');");
  await run("INSERT INTO bancos (nombre) SELECT 'Banco de Venezuela' WHERE NOT EXISTS (SELECT 1 FROM bancos WHERE nombre = 'Banco de Venezuela');");

  // Asociaciones banco -> formas_pago (si la tabla existe)
  await run("INSERT INTO banco_formas_pago (banco_id, forma_pago_id, detalles) SELECT b.id, f.id, jsonb_build_object('demo',true) FROM bancos b, formas_pago f WHERE b.nombre='Banco Demo' AND f.nombre='Transferencia' AND NOT EXISTS (SELECT 1 FROM banco_formas_pago bf WHERE bf.banco_id = b.id AND bf.forma_pago_id = f.id);");

  // Marcas y categorías
  await run("INSERT INTO marcas (nombre) VALUES ('Marca Demo') ON CONFLICT (nombre) DO NOTHING;");
  await run("INSERT INTO categorias (nombre) VALUES ('Perfumes') ON CONFLICT (nombre) DO NOTHING;");

  // Almacenes: insertar si no existe (no hay unique constraint por nombre en algunas instalaciones)
  await run("INSERT INTO almacenes (nombre, tipo) SELECT 'Almacén Central','venta' WHERE NOT EXISTS (SELECT 1 FROM almacenes WHERE nombre = 'Almacén Central');");

  // Producto demo: insertar o actualizar según exista
  const existingProd = await run("SELECT id FROM productos WHERE nombre = 'Perfume Demo' LIMIT 1;");
  let productoId = 1;
  if (existingProd && existingProd.rows && existingProd.rows[0]) {
    productoId = existingProd.rows[0].id;
    await run(`UPDATE productos SET unidad='unidad', stock=0, costo=10.0, precio_venta=25.0, marca_id=(SELECT id FROM marcas WHERE nombre='Marca Demo'), categoria_id=(SELECT id FROM categorias WHERE nombre='Perfumes') WHERE id=${productoId};`);
  } else {
    const ins = await run("INSERT INTO productos (nombre, unidad, stock, costo, precio_venta, marca_id, categoria_id) VALUES ('Perfume Demo','unidad',0,10.0,25.0, (SELECT id FROM marcas WHERE nombre='Marca Demo'), (SELECT id FROM categorias WHERE nombre='Perfumes')) RETURNING id;");
    if (ins && ins.rows && ins.rows[0]) productoId = ins.rows[0].id;
  }

  // Formulas (presentaciones/tamaños) asociadas al producto
  await run(`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${productoId}, '30ml', 10.0, 25.0) ON CONFLICT DO NOTHING;`);
  await run(`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${productoId}, '50ml', 15.0, 35.0) ON CONFLICT DO NOTHING;`);

  // Inventario (stock físico): insertar o actualizar según existencia
  try {
    const almacenRes = await run("SELECT id FROM almacenes WHERE nombre='Almacén Central' LIMIT 1;");
    const almacenId = almacenRes && almacenRes.rows && almacenRes.rows[0] ? almacenRes.rows[0].id : null;
    if (almacenId) {
      const invExist = await run(`SELECT id FROM inventario WHERE producto_id = ${productoId} AND almacen_id = ${almacenId} LIMIT 1;`);
      if (invExist && invExist.rows && invExist.rows[0]) {
        await run(`UPDATE inventario SET stock_fisico = 100, stock_comprometido = 0 WHERE id = ${invExist.rows[0].id};`);
      } else {
        await run(`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${productoId}, ${almacenId}, 100, 0);`);
      }
    }
  } catch (e) {
    // si la tabla inventario no tiene la estructura esperada, continuar
  }

  // Precios: opcional (si existe tabla precios)
  try {
    await run(`INSERT INTO precios (producto_id, precio) SELECT ${productoId}, 25.0 WHERE NOT EXISTS (SELECT 1 FROM precios WHERE producto_id = ${productoId});`);
  } catch (e) {
    // tabla `precios` puede no existir; continuar
  }

  // Pedido demo básico: crear un pedido sin forzar id (evitar colisiones con sequences)
  await run("INSERT INTO pedidos_venta (estado) SELECT 'CREADO' WHERE NOT EXISTS (SELECT 1 FROM pedidos_venta WHERE estado = 'CREADO');");
  // Asociar una línea de pedido al pedido recién creado (buscar el pedido creado más reciente)
  try {
    const pRes = await run("SELECT id FROM pedidos_venta ORDER BY id DESC LIMIT 1;");
    const pedidoId = pRes && pRes.rows && pRes.rows[0] ? pRes.rows[0].id : null;
    if (pedidoId) {
      const lineExist = await run(`SELECT id FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId} AND producto_id = ${productoId} LIMIT 1;`);
      if (lineExist && lineExist.rows && lineExist.rows[0]) {
        await run(`UPDATE pedido_venta_productos SET cantidad = 1 WHERE id = ${lineExist.rows[0].id};`);
      } else {
        await run(`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad) VALUES (${pedidoId}, ${productoId}, 1);`);
      }
    }
  } catch (e) {
    // si la tabla tiene otra estructura, continuar
  }

  // No insertar pagos con ID fijado — los tests crean y verifican pagos por su cuenta.

  console.log('Seed demo v2: finalizado.');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed demo v2: error', err);
  process.exit(2);
});
