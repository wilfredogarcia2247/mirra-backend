require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    // Buscar dos pares producto-tamano disponibles
    const pairs = await sql`
      SELECT p.id AS producto_id, p.nombre AS producto_nombre, t.id AS tamano_id, t.nombre AS tamano_nombre
      FROM productos p
      JOIN tamanos t ON t.producto_id = p.id
      LIMIT 2
    `;

    if (!pairs || pairs.length < 2) {
      console.error('No se encontraron al menos dos productos con tamaños. Ejecuta seeds o crea tamaños antes.');
      process.exit(1);
    }

    // Crear pedido
    // Asegurar columnas `tamano_id` y `tamano_nombre` en pedido_venta_productos
    try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS tamano_id INT`; } catch(e) {}
    try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS tamano_nombre TEXT`; } catch(e) {}

    const pedidoRes = await sql`
      INSERT INTO pedidos_venta (cliente_id, estado, fecha, nombre_cliente, telefono)
      VALUES (${null}, 'Pendiente', NOW(), ${'Pedido de prueba'}, ${'000000000'}) RETURNING *
    `;
    const pedido = pedidoRes && pedidoRes[0];
    console.log('Pedido creado:', pedido);

    const insertedLines = [];
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const cantidad = i === 0 ? 2 : 1; // ejemplo: 2 unidades del primer producto, 1 del segundo

      // Intentar obtener snapshot desde tamanos
      const tam = await sql`SELECT precio_venta, costo, nombre FROM tamanos WHERE id = ${p.tamano_id}`;
      let precio = null;
      let costo = null;
      let nombreProducto = null;
      if (tam && tam[0]) {
        precio = tam[0].precio_venta != null ? tam[0].precio_venta : null;
        costo = tam[0].costo != null ? tam[0].costo : null;
        nombreProducto = tam[0].nombre || null;
      }
      // Fallback a producto
      if (precio == null || costo == null || nombreProducto == null) {
        const prod = await sql`SELECT precio_venta, costo, nombre FROM productos WHERE id = ${p.producto_id}`;
        if (prod && prod[0]) {
          precio = precio == null ? prod[0].precio_venta : precio;
          costo = costo == null ? prod[0].costo : costo;
          nombreProducto = nombreProducto == null ? prod[0].nombre : nombreProducto;
        }
      }

      const inserted = await sql`
        INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, tamano_id, cantidad, costo_unitario, precio_venta, nombre_producto, tamano_nombre)
        VALUES (${pedido.id}, ${p.producto_id}, ${p.tamano_id}, ${cantidad}, ${costo}, ${precio}, ${nombreProducto}, ${p.tamano_nombre}) RETURNING *
      `;
      insertedLines.push(inserted[0]);
    }

    console.log('Líneas insertadas:', insertedLines);

    // Recuperar y mostrar el pedido con detalle
    const productosDetalle = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.tamano_id, pv.tamano_nombre, pv.cantidad, pv.precio_venta, pv.costo_unitario, pv.nombre_producto
      FROM pedido_venta_productos pv
      WHERE pv.pedido_venta_id = ${pedido.id}
    `;

    let total = 0;
    const productosMap = (productosDetalle || []).map(item => {
      const cantidad = Number(item.cantidad);
      const precioUnit = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
      const subtotal = cantidad * (isNaN(precioUnit) ? 0 : precioUnit);
      total += subtotal;
      return {
        id: item.id,
        producto_id: item.producto_id,
        tamano_id: item.tamano_id,
        tamano_nombre: item.tamano_nombre,
        cantidad,
        precio_venta: isNaN(precioUnit) ? null : precioUnit,
        costo: item.costo_unitario != null ? Number(item.costo_unitario) : null,
        nombre_producto: item.nombre_producto,
        subtotal
      };
    });

    console.log('Pedido final:', { ...pedido, productos: productosMap, total });

    // Actualizar TODO: marcar completado
    try { await sql`SELECT 1`; } catch(e) {}
    process.exit(0);
  } catch (err) {
    console.error('Error creando pedido de prueba:', err);
    process.exit(2);
  }
}

main();
