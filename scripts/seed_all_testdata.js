#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Seed completo: insertando datos de prueba para tablas principales');
  try {
    // Categorías (idempotente)
    const categorias = [
      { nombre: 'Perfumes', descripcion: 'Fragancias listas para la venta' },
      { nombre: 'Materia Prima', descripcion: 'Insumos y esencias para producción' },
      { nombre: 'Envases', descripcion: 'Frascos y tapas' }
    ];
    for (const c of categorias) {
      const exists = await sql`SELECT id FROM categorias WHERE nombre = ${c.nombre} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO categorias (nombre, descripcion) VALUES (${c.nombre}, ${c.descripcion})`;
      }
    }

    // Marcas
    const marcas = [
      { nombre: 'Aromas', descripcion: 'Marca principal interna' },
      { nombre: 'FrascoCo', descripcion: 'Fabricante de envases' }
    ];
    for (const m of marcas) {
      const exists = await sql`SELECT id FROM marcas WHERE nombre = ${m.nombre} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO marcas (nombre, descripcion) VALUES (${m.nombre}, ${m.descripcion})`;
      }
    }

    // Proveedores
    const proveedores = [
      { nombre: 'Proveedor Aromas', telefono: '123456789', email: 'proveedor@aromas.com' },
      { nombre: 'Proveedor Envases', telefono: '987654321', email: 'envases@prov.com' }
    ];
    for (const p of proveedores) {
      const exists = await sql`SELECT id FROM proveedores WHERE nombre = ${p.nombre} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO proveedores (nombre, telefono, email) VALUES (${p.nombre}, ${p.telefono}, ${p.email})`;
      }
    }

    // Bancos y formas de pago
    const bancos = ['Banco Demo'];
    for (const b of bancos) {
      const exists = await sql`SELECT id FROM bancos WHERE nombre = ${b} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO bancos (nombre) VALUES (${b})`;
      }
    }
    const formas = ['Tarjeta', 'Transferencia', 'Efectivo'];
    for (const f of formas) {
      const exists = await sql`SELECT id FROM formas_pago WHERE nombre = ${f} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO formas_pago (nombre) VALUES (${f})`;
      }
    }

    // Productos: materias primas y productos terminados (idempotente)
    const productos = [
      { id: 1, nombre: 'Esencia de Jazmín', unidad: 'ml', stock: 1000, costo: 0.5, proveedor_id: 1, categoria_nombre: 'Materia Prima' },
      { id: 2, nombre: 'Alcohol de Perfumería', unidad: 'ml', stock: 5000, costo: 0.2, proveedor_id: 1, categoria_nombre: 'Materia Prima' },
      { id: 3, nombre: 'Fijador', unidad: 'ml', stock: 2000, costo: 0.3, proveedor_id: 1, categoria_nombre: 'Materia Prima' },
      { id: 4, nombre: 'Frasco de Vidrio 50ml', unidad: 'unidad', stock: 200, costo: 1.0, proveedor_id: 2, categoria_nombre: 'Envases', marca_nombre: 'FrascoCo' },
      { id: 5, nombre: 'Tapa Atomizadora', unidad: 'unidad', stock: 200, costo: 0.5, proveedor_id: 2, categoria_nombre: 'Envases', marca_nombre: 'FrascoCo' },
      { id: 6, nombre: 'Etiqueta Floral', unidad: 'unidad', stock: 200, costo: 0.1, proveedor_id: 2, categoria_nombre: 'Envases', marca_nombre: 'FrascoCo' },
      { id: 7, nombre: 'Perfume Floral N°5', unidad: 'unidad', stock: 20, costo: 0, proveedor_id: 1, categoria_nombre: 'Perfumes', marca_nombre: 'Aromas' }
    ];
    for (const p of productos) {
      const exists = await sql`SELECT id FROM productos WHERE id = ${p.id} LIMIT 1`;
      if (exists && exists.length > 0) continue;
      // obtener category id y marca id si existen
      const cat = await sql`SELECT id FROM categorias WHERE nombre = ${p.categoria_nombre} LIMIT 1`;
      const mar = p.marca_nombre ? await sql`SELECT id FROM marcas WHERE nombre = ${p.marca_nombre} LIMIT 1` : [];
      await sql`INSERT INTO productos (id, nombre, unidad, stock, costo, proveedor_id, categoria_id, marca_id, image_url)
        VALUES (${p.id}, ${p.nombre}, ${p.unidad}, ${p.stock}, ${p.costo}, ${p.proveedor_id}, ${cat && cat[0] ? cat[0].id : null}, ${mar && mar[0] ? mar[0].id : null}, NULL)`;
    }

    // Almacenes (idempotente)
    const almacenes = [
      { nombre: 'Almacén Materia Prima', tipo: 'interno', ubicacion: 'Bodega 1', responsable: 'Operario', es_materia_prima: true },
      { nombre: 'Almacén Venta', tipo: 'venta', ubicacion: 'Tienda', responsable: 'Vendedor', es_materia_prima: false }
    ];
    for (const a of almacenes) {
      const exists = await sql`SELECT id FROM almacenes WHERE nombre = ${a.nombre} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO almacenes (nombre, tipo, ubicacion, responsable, es_materia_prima) VALUES (${a.nombre}, ${a.tipo}, ${a.ubicacion}, ${a.responsable}, ${a.es_materia_prima})`;
      }
    }

    // Inventario para productos (idempotente por producto+almacen)
    const almacenMateriaId = (await sql`SELECT id FROM almacenes WHERE nombre='Almacén Materia Prima' LIMIT 1`)[0].id;
    const almacenVentaId = (await sql`SELECT id FROM almacenes WHERE nombre='Almacén Venta' LIMIT 1`)[0].id;
    const inventarioRows = [
      { producto_id: 1, almacen_id: almacenMateriaId, stock: 1000 },
      { producto_id: 2, almacen_id: almacenMateriaId, stock: 5000 },
      { producto_id: 3, almacen_id: almacenMateriaId, stock: 2000 },
      { producto_id: 4, almacen_id: almacenVentaId, stock: 200 },
      { producto_id: 5, almacen_id: almacenVentaId, stock: 200 },
      { producto_id: 6, almacen_id: almacenVentaId, stock: 200 },
      { producto_id: 7, almacen_id: almacenVentaId, stock: 20 }
    ];
    for (const i of inventarioRows) {
      const exists = await sql`SELECT id FROM inventario WHERE producto_id = ${i.producto_id} AND almacen_id = ${i.almacen_id} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${i.producto_id}, ${i.almacen_id}, ${i.stock}, 0)`;
      }
    }

    // Tamaños: crear para producto 7 (Perfume Floral N°5)
    const tamanos = [
      { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 0.8, precio_venta: 25.0, factor: 1.0 },
      { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 1.4, precio_venta: 45.0, factor: 1.05 }
    ];
    for (const t of tamanos) {
      await sql`INSERT INTO tamanos (nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta)
        VALUES (${t.nombre}, ${t.cantidad}, ${t.unidad}, 7, ${t.costo}, ${t.precio_venta}, ${t.factor})
        ON CONFLICT (producto_id, nombre) DO NOTHING;`;
    }

    // Ingredientes (maestro) a partir de productos materia prima
    const ingredientes = [
      { codigo: 'P1', nombre: 'Esencia de Jazmín', unidad: 'ml', costo: 0.5 },
      { codigo: 'P2', nombre: 'Alcohol de Perfumería', unidad: 'ml', costo: 0.2 },
      { codigo: 'P3', nombre: 'Fijador', unidad: 'ml', costo: 0.3 }
    ];
    for (const ing of ingredientes) {
      const exists = await sql`SELECT id FROM ingredientes WHERE codigo = ${ing.codigo} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO ingredientes (codigo, nombre, unidad, costo) VALUES (${ing.codigo}, ${ing.nombre}, ${ing.unidad}, ${ing.costo})`;
      }
    }

    // Fórmulas: crear una fórmula para producto 7 si no existe
    const formulaExists = await sql`SELECT id FROM formulas WHERE producto_terminado_id = 7 LIMIT 1`;
    let formulaId;
    if (formulaExists && formulaExists.length > 0) {
      formulaId = formulaExists[0].id;
    } else {
      const f = await sql`INSERT INTO formulas (producto_terminado_id, nombre, tamano_id) VALUES (7, 'Formula Floral N5', (SELECT id FROM tamanos WHERE producto_id=7 AND nombre='50ml' LIMIT 1)) RETURNING *`;
      formulaId = f[0].id;
    }

    // Componentes de la fórmula (materia prima -> producto ids 1,2,3) idempotente
    const componentes = [
      { materia_prima_id: 1, cantidad: 10, unidad: 'ml' },
      { materia_prima_id: 2, cantidad: 35, unidad: 'ml' },
      { materia_prima_id: 3, cantidad: 5, unidad: 'ml' }
    ];
    for (const c of componentes) {
      const exists = await sql`SELECT id FROM formula_componentes WHERE formula_id = ${formulaId} AND materia_prima_id = ${c.materia_prima_id} LIMIT 1`;
      if (!exists || exists.length === 0) {
        await sql`INSERT INTO formula_componentes (formula_id, materia_prima_id, cantidad, unidad) VALUES (${formulaId}, ${c.materia_prima_id}, ${c.cantidad}, ${c.unidad})`;
      }
    }

    // Precios calculados demo (precio_productos)
    const tamanosRows = await sql`SELECT id, nombre FROM tamanos WHERE producto_id = 7`;
    for (const t of tamanosRows) {
      const existsPrice = await sql`SELECT id FROM precio_productos WHERE producto_id = 7 AND tamano_id = ${t.id} LIMIT 1`;
      if (existsPrice && existsPrice.length > 0) continue;
      const demoPrice = (t.nombre && t.nombre.toLowerCase().includes('50')) ? 23.45 : 44.9;
      await sql`INSERT INTO precio_productos (producto_id, tamano_id, sku, costo_formula, costo_total_fabricacion, margen_aplicado, precio_venta_base, factor_tamano, precio_venta_final)
        VALUES (7, ${t.id}, ${'SKU-7-' + t.id}, 0, 0, 3.0, 0, 1.0, ${demoPrice})`;
    }

    // Contactos/Clientes
    const contacto = await sql`SELECT id FROM contactos WHERE email = 'cliente@demo.com' LIMIT 1`;
    if (!contacto || contacto.length === 0) {
      await sql`INSERT INTO contactos (nombre, tipo, telefono, email, banco, cuenta_bancaria, formas_pago) VALUES ('Cliente Demo','Cliente','555000111','cliente@demo.com','Banco Demo','00012345678','Tarjeta,Transferencia')`;
    }

    // Pedidos de venta demo (asociar al contacto si existe)
    const cliente = (await sql`SELECT id FROM contactos WHERE email = 'cliente@demo.com' LIMIT 1`)[0];
    if (cliente) {
      const pedido = await sql`SELECT id FROM pedidos_venta WHERE cliente_id = ${cliente.id} LIMIT 1`;
      if (!pedido || pedido.length === 0) {
        await sql`INSERT INTO pedidos_venta (cliente_id, estado, fecha, nombre_cliente) VALUES (${cliente.id}, 'pendiente', NOW(), 'Cliente Demo')`;
      }
    }

    console.log('Seed completo.');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed:', err);
    process.exit(2);
  }
}

main();
