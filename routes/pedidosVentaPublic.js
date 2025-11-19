const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarPedido(body) {
  // Para pedidos públicos `cliente_id` es opcional (puede venir null/0).
  if (body.cliente_id != null && body.cliente_id !== '' && isNaN(Number(body.cliente_id)))
    return 'ID de cliente inválido';
  // Aceptamos compatiblemente `productos` o `lineas` como nombre del array enviado desde el front
  const productosArray = Array.isArray(body.productos)
    ? body.productos
    : Array.isArray(body.lineas)
    ? body.lineas
    : null;
  if (!Array.isArray(productosArray) || productosArray.length === 0)
    return 'Productos (array `productos` o `lineas`) requeridos';
  for (const p of productosArray) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return 'ID de producto requerido';
    if (!p.cantidad || isNaN(Number(p.cantidad))) return 'Cantidad requerida';
  }
  // estado es opcional para pedidos públicos (se fuerza a 'Pendiente' en la inserción)
  if (body.estado != null && !['Pendiente', 'Enviado', 'Completado'].includes(body.estado))
    return 'Estado inválido';
  // Si se provee tasa_cambio_monto debe ser un número positivo
  if (
    body.tasa_cambio_monto != null &&
    (isNaN(Number(body.tasa_cambio_monto)) || Number(body.tasa_cambio_monto) <= 0)
  )
    return 'tasa_cambio_monto inválida';
  return null;
}

// Endpoint público para crear pedidos de venta (no requiere token)
router.post('/', async (req, res) => {
  console.log('Public POST /api/pedidos-venta body:', req.body);
  const error = validarPedido(req.body);
  if (error) return res.status(400).json({ error });
  try {
    // Asegurar columnas de snapshot por si la migración no se ejecutó en este entorno
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS nombre_producto TEXT;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS formula_id INT;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS formula_nombre TEXT;`;
    } catch (e) {}
    // Note: no legacy tamano columns required here.
    const { cliente_id, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto } = req.body;
    // Compatibilidad: aceptar `productos` o `lineas`
    const productos = Array.isArray(req.body.productos)
      ? req.body.productos
      : Array.isArray(req.body.lineas)
      ? req.body.lineas
      : [];
    // Si cliente_id no se provee o es 0, lo almacenamos como NULL (pedido público)
    const clienteIdValue =
      cliente_id == null || Number(cliente_id) === 0 ? null : Number(cliente_id);
    const forcedEstado = 'Pendiente';
    // Capturar IP y User-Agent para trazabilidad
    const origenIp = (req.headers['x-forwarded-for'] || req.ip || '').toString();
    const userAgent = (req.headers['user-agent'] || '').toString();

    // Ejecutar en transacción: crear pedido público y guardar snapshots por línea
    await sql`BEGIN`;
    try {
      const tasaMontoVal = tasa_cambio_monto != null ? Number(tasa_cambio_monto) : null;

      // Insertar pedido público (sin validar ni reservar stock)
      const pedido = await sql`
        INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha, origen_ip, user_agent, tasa_cambio_monto)
        VALUES (${clienteIdValue}, ${nombre_cliente || null}, ${telefono || null}, ${
        cedula || null
      }, ${forcedEstado}, NOW(), ${origenIp || null}, ${
        userAgent || null
      }, ${tasaMontoVal}) RETURNING *
      `;

      for (const p of productos) {
        // Obtener snapshot: preferir fórmula si se provee, sino datos del producto
        let precioUnitario = null;
        let costoUnitario = null;
        let nombreProducto = null;
        let formulaIdToSave = null;
        let formulaNombreToSave = null;
        if (p.formula_id != null) {
          const fRow = await sql`SELECT precio_venta, costo, nombre FROM formulas WHERE id = ${p.formula_id} LIMIT 1`;
          if (fRow && fRow[0]) {
            precioUnitario = fRow[0].precio_venta != null ? fRow[0].precio_venta : null;
            costoUnitario = fRow[0].costo != null ? fRow[0].costo : null;
            nombreProducto = fRow[0].nombre != null ? fRow[0].nombre : null;
            formulaIdToSave = Number(p.formula_id);
            formulaNombreToSave = fRow[0].nombre != null ? fRow[0].nombre : null;
          }
        }
        if (precioUnitario == null || costoUnitario == null || nombreProducto == null) {
          const prodRow =
            await sql`SELECT precio_venta, costo, nombre FROM productos WHERE id = ${p.producto_id}`;
          if (prodRow && prodRow[0]) {
            precioUnitario = precioUnitario == null ? prodRow[0].precio_venta : precioUnitario;
            costoUnitario = costoUnitario == null ? prodRow[0].costo : costoUnitario;
            nombreProducto = nombreProducto == null ? prodRow[0].nombre : nombreProducto;
          }
        }
        // insertar la línea (guardando formula_id/formula_nombre si se proporcionó)
        await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto, formula_id, formula_nombre) VALUES (${pedido[0].id}, ${p.producto_id}, ${p.cantidad}, ${costoUnitario}, ${precioUnitario}, ${nombreProducto}, ${formulaIdToSave}, ${formulaNombreToSave})`;
      }
      await sql`COMMIT`;

      const productosDetalle = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
               COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
               COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
               COALESCE(pv.costo_unitario, prod.costo) AS costo,
               prod.image_url,
               (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_creada
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        LEFT JOIN (
          SELECT producto_terminado_id, COALESCE(SUM(cantidad),0) AS produced_total
          FROM ordenes_produccion WHERE estado = 'Completada' GROUP BY producto_terminado_id
        ) op ON op.producto_terminado_id = prod.id
        WHERE pv.pedido_venta_id = ${pedido[0].id}
      `;
      let total = 0;
      const productosMapeados = productosDetalle.map((item) => {
        const cantidad = Number(item.cantidad);
        const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
        const costo = item.costo != null ? parseFloat(item.costo) : null;
        const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
        total += subtotal;
        return {
          id: item.id,
          pedido_venta_id: item.pedido_venta_id,
          producto_id: item.producto_id,
          cantidad,
          producto_nombre: item.producto_nombre,
          precio_venta: isNaN(precio) ? null : precio,
          costo: costo,
          image_url: item.image_url,
          produccion_creada: !!item.produccion_creada,
          componentes: [],
          subtotal,
        };
      });
      // Añadir nombres de componentes si la línea tiene formula_id guardada o se puede resolver por nombre
      for (const prodItem of productosMapeados) {
        prodItem.componentes = prodItem.componentes || [];
        let formulaIdToUse = prodItem.formula_id || null;
        if (!formulaIdToUse && prodItem.producto_nombre) {
          try {
            const frow = await sql`
              SELECT id FROM formulas WHERE producto_terminado_id = ${prodItem.producto_id} AND nombre = ${prodItem.producto_nombre} LIMIT 1
            `;
            if (frow && frow[0] && frow[0].id) formulaIdToUse = frow[0].id;
          } catch (e) {}
        }
        if (formulaIdToUse) {
          try {
            let comps = await sql`
              SELECT fc.materia_prima_id, fc.cantidad, fc.unidad,
                     COALESCE(mp.nombre, ing.nombre) AS nombre
              FROM formula_componentes fc
              LEFT JOIN productos mp ON mp.id = fc.materia_prima_id
              LEFT JOIN ingredientes ing ON ing.id = fc.materia_prima_id
              WHERE fc.formula_id = ${formulaIdToUse}
            `;
            if ((!comps || comps.length === 0) && prodItem.producto_nombre) {
              try {
                const likePattern = '%' + prodItem.producto_nombre + '%';
                const frow = await sql`
                  SELECT id FROM formulas WHERE producto_terminado_id = ${prodItem.producto_id} AND nombre ILIKE ${likePattern} LIMIT 1
                `;
                if (frow && frow[0] && frow[0].id) {
                  comps = await sql`
                    SELECT fc.materia_prima_id, fc.cantidad, fc.unidad,
                           COALESCE(mp.nombre, ing.nombre) AS nombre
                    FROM formula_componentes fc
                    LEFT JOIN productos mp ON mp.id = fc.materia_prima_id
                    LEFT JOIN ingredientes ing ON ing.id = fc.materia_prima_id
                    WHERE fc.formula_id = ${frow[0].id}
                  `;
                }
              } catch (e) {}
            }
            prodItem.componentes = (comps || []).map((c) => ({
              materia_prima_id: c.materia_prima_id,
              nombre: c.nombre || null,
              cantidad: c.cantidad != null ? Number(c.cantidad) : null,
              unidad: c.unidad || null,
            }));
          } catch (e) {
            prodItem.componentes = [];
          }
        }
      }
      const pedidoObj = {
        ...pedido[0],
        productos: productosMapeados,
        total,
        // Compatibilidad cliente: antiguamente se devolvía `produccionesCreadas`.
        // Aquí no creamos producciones al momento de crear el pedido, así que devolvemos arreglo vacío.
        produccionesCreadas: [],
        producciones: [],
      };
      res.status(201).json(pedidoObj);
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) {}
      throw errTx;
    }
  } catch (err) {
    console.error('Error creating public pedido:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
