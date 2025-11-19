const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { spawn } = require('child_process');

function validarPedido(body) {
  if (!body.cliente_id || isNaN(Number(body.cliente_id))) return 'ID de cliente requerido';
  if (!Array.isArray(body.productos) || body.productos.length === 0) return 'Productos requeridos';
  for (const p of body.productos) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return 'ID de producto requerido';
    if (!p.cantidad || isNaN(Number(p.cantidad))) return 'Cantidad requerida';
    if (p.tamano_id != null && isNaN(Number(p.tamano_id))) return 'tamano_id inválido en productos';
  }
  if (!body.estado || !['Pendiente', 'Enviado', 'Completado'].includes(body.estado))
    return 'Estado inválido';
  // Si se provee tasa_cambio_monto debe ser un número positivo
  if (
    body.tasa_cambio_monto != null &&
    (isNaN(Number(body.tasa_cambio_monto)) || Number(body.tasa_cambio_monto) <= 0)
  )
    return 'tasa_cambio_monto inválida';
  return null;
}

function validarPagoObj(pago) {
  if (!pago) return null; // es opcional
  if (typeof pago !== 'object') return 'Pago inválido';
  if (pago.forma_pago_id == null || isNaN(Number(pago.forma_pago_id)))
    return 'forma_pago_id requerido en pago';
  if (pago.monto == null || isNaN(Number(pago.monto)) || Number(pago.monto) <= 0)
    return 'monto inválido en pago';
  if (pago.banco_id != null && isNaN(Number(pago.banco_id))) return 'banco_id inválido en pago';
  // referencia y fecha_transaccion son opcionales; si fecha_transaccion existe debe ser parseable
  if (pago.fecha_transaccion) {
    const d = new Date(pago.fecha_transaccion);
    if (isNaN(d.getTime())) return 'fecha_transaccion inválida';
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    // Asegurar columnas de snapshot por si la migración no se ejecutó en este entorno
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN costo_unitario NUMERIC;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN nombre_producto TEXT;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN tamano_id INT;`;
    } catch (e) {}
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN tamano_nombre TEXT;`;
    } catch (e) {}
    const pedidos = await sql`SELECT * FROM pedidos_venta`;
    const pedidosConDetalle = [];
    for (const p of pedidos) {
      const productos = await sql`
         SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.tamano_id,
           COALESCE(pv.tamano_nombre, f.nombre) AS tamano_nombre,
           prod.nombre AS producto_nombre, prod.precio_venta, prod.costo, prod.image_url,
           f.costo AS tamano_costo, f.precio_venta AS tamano_precio_venta
         FROM pedido_venta_productos pv
         LEFT JOIN productos prod ON prod.id = pv.producto_id
         LEFT JOIN formulas f ON f.id = pv.tamano_id
         WHERE pv.pedido_venta_id = ${p.id}
      `;
      // Normalizar tipos y calcular subtotales
      let total = 0;
      const productosMapeados = productos.map((item) => {
        const cantidad = Number(item.cantidad);
        const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
        const costo = item.costo != null ? parseFloat(item.costo) : null;
        const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
        total += subtotal;
        return {
          id: item.id,
          pedido_venta_id: item.pedido_venta_id,
          producto_id: item.producto_id,
          tamano_id: item.tamano_id || null,
          tamano_nombre: item.tamano_nombre || null,
          cantidad,
          producto_nombre: item.producto_nombre,
          precio_venta: isNaN(precio) ? null : precio,
          costo: costo,
          image_url: item.image_url,
          subtotal,
        };
      });
      pedidosConDetalle.push({
        ...p,
        productos: productosMapeados,
        total,
      });
    }
    res.json(pedidosConDetalle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarPedido(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { cliente_id, productos, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto } =
      req.body;
    // Ejecutar en transacción: crear pedido y guardar snapshot por línea.
    await sql`BEGIN`;
    try {
      const produccionesCreadas = [];
      const tasaMontoVal = tasa_cambio_monto != null ? Number(tasa_cambio_monto) : null;
      const pedido = await sql`
        INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha, tasa_cambio_monto)
        VALUES (${cliente_id || null}, ${nombre_cliente || null}, ${telefono || null}, ${
        cedula || null
      }, ${estado}, NOW(), ${tasaMontoVal}) RETURNING *
      `;

      for (const p of productos) {
        // Validar cantidad
        const qty = Number(p.cantidad);
        if (isNaN(qty) || qty <= 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Cantidad inválida en productos' });
        }
        // Obtener precio/costo/nombre al momento del pedido para snapshot (preferir tamano)
        let precioUnitario = null;
        let costoUnitario = null;
        let nombreProducto = null;
        if (p.tamano_id != null) {
          // Intentar obtener snapshot desde formulas (ahora representan tamaños)
          const tamRow =
            await sql`SELECT precio_venta, costo, nombre FROM formulas WHERE id = ${p.tamano_id}`;
          if (tamRow && tamRow[0]) {
            precioUnitario = tamRow[0].precio_venta != null ? tamRow[0].precio_venta : null;
            costoUnitario = tamRow[0].costo != null ? tamRow[0].costo : null;
            nombreProducto = tamRow[0].nombre != null ? tamRow[0].nombre : null;
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

        await sql`
          INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, tamano_id, cantidad, costo_unitario, precio_venta, nombre_producto, tamano_nombre)
          VALUES (${pedido[0].id}, ${p.producto_id}, ${p.tamano_id || null}, ${
          p.cantidad
        }, ${costoUnitario}, ${precioUnitario}, ${nombreProducto}, ${p.tamano_nombre || null})
        `;
      }

      await sql`COMMIT`;

      // Recuperar y devolver pedido con detalle
      const productosDetalle = await sql`
         SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.tamano_id,
           COALESCE(pv.tamano_nombre, f.nombre) AS tamano_nombre,
           COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
           COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
           COALESCE(pv.costo_unitario, prod.costo) AS costo,
           prod.image_url,
           f.costo AS tamano_costo, f.precio_venta AS tamano_precio_venta
         FROM pedido_venta_productos pv
         LEFT JOIN productos prod ON prod.id = pv.producto_id
         LEFT JOIN formulas f ON f.id = pv.tamano_id
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
          tamano_id: item.tamano_id || null,
          tamano_nombre: item.tamano_nombre || null,
          cantidad,
          producto_nombre: item.producto_nombre,
          precio_venta: isNaN(precio) ? null : precio,
          costo: costo,
          image_url: item.image_url,
          subtotal,
        };
      });
      const pedidoObj = {
        ...pedido[0],
        productos: productosMapeados,
        total,
        producciones: produccionesCreadas,
      };
      return res.status(201).json(pedidoObj);
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) {}
      throw errTx;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pedido = await sql`SELECT * FROM pedidos_venta WHERE id = ${req.params.id}`;
    if (pedido.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const productos = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
             COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
             COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
             COALESCE(pv.costo_unitario, prod.costo) AS costo,
             prod.image_url
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.pedido_venta_id = ${req.params.id}
    `;
    let total = 0;
    const productosMapeados = productos.map((item) => {
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
        subtotal,
      };
    });
    const pedidoObj = { ...pedido[0], productos: productosMapeados, total };
    res.json(pedidoObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper transaccional para completar un pedido: consume reservas y marca Completado
async function completarPedidoTransaccional(pedidoId) {
  // completarPedidoTransaccional ahora puede recibir un objeto pago opcional al llamarlo;
  // si no se facilita, se llamará sin pago. Para compatibilidad, revisamos arguments
  const pagoObj = arguments && arguments[1] ? arguments[1] : null;
  await sql`BEGIN`;
  const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
  if (!pedidoRows || pedidoRows.length === 0) {
    await sql`ROLLBACK`;
    const e = new Error('Pedido no encontrado');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const pedido = pedidoRows[0];
  if (pedido.estado === 'Completado') {
    await sql`ROLLBACK`;
    const e = new Error('Pedido ya completado');
    e.code = 'ALREADY_COMPLETED';
    throw e;
  }

  const lineas =
    await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
  const movimientos = [];

  for (const linea of lineas) {
    let qtyNeeded = Number(linea.cantidad);
    if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
      await sql`ROLLBACK`;
      const e = new Error('Cantidad inválida en líneas del pedido');
      e.code = 'INVALID_QTY';
      throw e;
    }
    const invs = await sql`
      SELECT i.* FROM inventario i
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE i.producto_id = ${linea.producto_id} AND a.tipo IN ('venta','interno') AND i.stock_comprometido > 0
      ORDER BY i.stock_comprometido DESC
      FOR UPDATE
    `;
    for (const inv of invs) {
      if (qtyNeeded <= 0) break;
      const committed = Number(inv.stock_comprometido);
      if (committed <= 0) continue;
      const take = Math.min(committed, qtyNeeded);
      const consumed = await sql`
        UPDATE inventario
        SET stock_fisico = stock_fisico - ${take}, stock_comprometido = stock_comprometido - ${take}
        WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0 AND stock_comprometido >= ${take}
        RETURNING id, stock_fisico, stock_comprometido, almacen_id
      `;
      if (!consumed || consumed.length === 0) {
        await sql`ROLLBACK`;
        const e = new Error(
          `No se pudo consumir inventario reservado para producto ${linea.producto_id}`
        );
        e.code = 'INVENTORY_CONFLICT';
        throw e;
      }
      await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${
        linea.producto_id
      }, ${inv.almacen_id}, 'salida', ${take}, ${'Venta pedido ' + pedidoId})`;
      movimientos.push({
        producto_id: linea.producto_id,
        almacen_id: inv.almacen_id,
        cantidad: take,
      });
      qtyNeeded -= take;
    }
    if (qtyNeeded > 0) {
      await sql`ROLLBACK`;
      const e = new Error(`Stock comprometido insuficiente para producto ${linea.producto_id}`);
      e.code = 'INSUFFICIENT_RESERVED';
      throw e;
    }
  }

  await sql`UPDATE pedidos_venta SET estado = 'Completado' WHERE id = ${pedidoId}`;
  // Insertar pago si viene información
  let pagoInserted = null;
  if (pagoObj) {
    try {
      // Asegurar tabla pagos existe (defensivo)
      try {
        await sql`CREATE TABLE IF NOT EXISTS pagos (
          id SERIAL PRIMARY KEY,
          pedido_venta_id INT,
          forma_pago_id INT,
          banco_id INT,
          monto NUMERIC,
          referencia TEXT,
          fecha_transaccion TIMESTAMP,
          fecha TIMESTAMP,
          tasa NUMERIC,
          tasa_simbolo VARCHAR(10)
        );`;
      } catch (e) {}

      // Determinar tasa a aplicar según la moneda del banco (si se provee banco_id)
      let tasaVal = null;
      let tasaSimbolo = null;
      try {
        // Priorizar la moneda del banco y su tasa activa si está disponible
        if (pagoObj.banco_id != null) {
          try {
            const bancoRow = await sql`SELECT moneda FROM bancos WHERE id = ${pagoObj.banco_id}`;
            const moneda =
              bancoRow && bancoRow[0] && bancoRow[0].moneda ? bancoRow[0].moneda : null;
            if (moneda) {
              const tasaRow =
                await sql`SELECT monto FROM tasas_cambio WHERE simbolo = ${moneda} LIMIT 1`;
              if (tasaRow && tasaRow[0]) {
                tasaVal = tasaRow[0].monto;
                tasaSimbolo = moneda; // usar el símbolo del banco
              }
            }
          } catch (e) {}
        }
        // Si no se obtuvo tasa desde la moneda del banco, intentar detalles por combinación banco+forma
        if (tasaVal == null && pagoObj.banco_id != null && pagoObj.forma_pago_id != null) {
          try {
            const bf =
              await sql`SELECT detalles FROM banco_formas_pago WHERE banco_id = ${pagoObj.banco_id} AND forma_pago_id = ${pagoObj.forma_pago_id} LIMIT 1`;
            if (bf && bf[0] && bf[0].detalles) {
              const det = bf[0].detalles;
              if (det.tasa != null) tasaVal = det.tasa;
              if (det.tasa_simbolo && !tasaSimbolo) tasaSimbolo = det.tasa_simbolo;
              else if (det.simbolo && !tasaSimbolo) tasaSimbolo = det.simbolo;
            }
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // ignore, fallback below
      }
      // Fallback: si no encontramos una tasa específica, usar la tasa activa cualquiera
      if (tasaVal == null) {
        try {
          const anyT =
            await sql`SELECT monto, simbolo FROM tasas_cambio WHERE activo = TRUE LIMIT 1`;
          if (anyT && anyT[0]) {
            tasaVal = anyT[0].monto;
            tasaSimbolo = anyT[0].simbolo;
          }
        } catch (e) {}
      }

      // Insertar registro de pago incluyendo tasa y símbolo
      const inserted = await sql`
        INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
        VALUES (${pedidoId}, ${pagoObj.forma_pago_id}, ${pagoObj.banco_id || null}, ${
        pagoObj.monto
      }, ${pagoObj.referencia || null}, ${pagoObj.fecha_transaccion || null}, NOW(), ${
        tasaVal || null
      }, ${tasaSimbolo || null}) RETURNING *
      `;
      pagoInserted = inserted && inserted[0] ? inserted[0] : null;
    } catch (e) {
      // Si falla la inserción de pago, rollback para mantener atomicidad
      await sql`ROLLBACK`;
      const err = new Error('Error registrando pago: ' + e.message);
      err.code = 'PAYMENT_INSERT_ERROR';
      throw err;
    }
  }
  await sql`COMMIT`;
  return { success: true, pedido_id: pedidoId, movimientos, pago: pagoInserted };
}

// POST /api/pedidos-venta/:id/completar (usa helper transaccional)
router.post('/:id/completar', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const pago = req.body && req.body.pago ? req.body.pago : null;
  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });
  try {
    const result = await completarPedidoTransaccional(pedidoId, pago);
    return res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVALID_QTY' || err.code === 'INSUFFICIENT_RESERVED')
      return res.status(400).json({ error: err.message });
    if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
    if (err.code === 'PAYMENT_INSERT_ERROR') return res.status(500).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos-venta/:id/finalizar -> endpoint explícito para completar y registrar pago
router.post('/:id/finalizar', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const pago = req.body && req.body.pago ? req.body.pago : null;
  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });
  try {
    const result = await completarPedidoTransaccional(pedidoId, pago);
    return res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVALID_QTY' || err.code === 'INSUFFICIENT_RESERVED')
      return res.status(400).json({ error: err.message });
    if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
    if (err.code === 'PAYMENT_INSERT_ERROR') return res.status(500).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos-venta/:id/pagos -> registrar pago adicional sin cambiar estado del pedido
router.post('/:id/pagos', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const pago = req.body && (req.body.pago || req.body);
  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });
  try {
    await sql`BEGIN`;
    try {
      const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
      if (!pedidoRows || pedidoRows.length === 0) {
        await sql`ROLLBACK`;
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      // Asegurar existencia de tabla pagos de forma defensiva
      try {
        await sql`CREATE TABLE IF NOT EXISTS pagos (
          id SERIAL PRIMARY KEY,
          pedido_venta_id INT,
          forma_pago_id INT,
          banco_id INT,
          monto NUMERIC,
          referencia TEXT,
          fecha_transaccion TIMESTAMP,
          fecha TIMESTAMP,
          tasa NUMERIC,
          tasa_simbolo VARCHAR(10)
        );`;
      } catch (e) {}

      // Determinar tasa según moneda del banco
      let tasaVal = null;
      let tasaSimbolo = null;
      try {
        // Priorizar moneda del banco y su tasa activa
        if (pago && pago.banco_id != null) {
          try {
            const bancoRow = await sql`SELECT moneda FROM bancos WHERE id = ${pago.banco_id}`;
            const moneda =
              bancoRow && bancoRow[0] && bancoRow[0].moneda ? bancoRow[0].moneda : null;
            if (moneda) {
              const tasaRow =
                await sql`SELECT monto FROM tasas_cambio WHERE simbolo = ${moneda} LIMIT 1`;
              if (tasaRow && tasaRow[0]) {
                tasaVal = tasaRow[0].monto;
                tasaSimbolo = moneda;
              }
            }
          } catch (e) {}
          // Fallback: si no se obtuvo tasa desde moneda del banco, verificar detalles por banco+forma
          if (tasaVal == null) {
            try {
              const bf =
                await sql`SELECT detalles FROM banco_formas_pago WHERE banco_id = ${pago.banco_id} AND forma_pago_id = ${pago.forma_pago_id} LIMIT 1`;
              if (bf && bf[0] && bf[0].detalles) {
                const det = bf[0].detalles;
                if (det.tasa != null) tasaVal = det.tasa;
                if (det.tasa_simbolo && !tasaSimbolo) tasaSimbolo = det.tasa_simbolo;
                else if (det.simbolo && !tasaSimbolo) tasaSimbolo = det.simbolo;
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        // ignore and fallback
      }
      if (tasaVal == null) {
        try {
          const anyT =
            await sql`SELECT monto, simbolo FROM tasas_cambio WHERE activo = TRUE LIMIT 1`;
          if (anyT && anyT[0]) {
            tasaVal = anyT[0].monto;
            tasaSimbolo = anyT[0].simbolo;
          }
        } catch (e) {}
      }

      const inserted = await sql`
        INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
        VALUES (${pedidoId}, ${pago.forma_pago_id}, ${pago.banco_id || null}, ${pago.monto}, ${
        pago.referencia || null
      }, ${pago.fecha_transaccion || null}, NOW(), ${tasaVal || null}, ${
        tasaSimbolo || null
      }) RETURNING *
      `;
      await sql`COMMIT`;
      return res.status(201).json({ ok: true, pago: inserted && inserted[0] ? inserted[0] : null });
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) {}
      throw errTx;
    }
  } catch (err) {
    console.error('Error registrando pago adicional:', err);
    return res.status(500).json({ error: 'Error registrando pago' });
  }
});

// GET /api/pedidos-venta/:id/pagos -> listar pagos asociados a un pedido
router.get('/:id/pagos', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Seleccionar pagos asociados con detalles de banco y forma de pago
    const rows = await sql`
      SELECT p.*, b.nombre AS banco_nombre, b.moneda AS banco_moneda,
             f.nombre AS forma_nombre, bf.detalles AS forma_detalles
      FROM pagos p
      LEFT JOIN bancos b ON b.id = p.banco_id
      LEFT JOIN formas_pago f ON f.id = p.forma_pago_id
      LEFT JOIN banco_formas_pago bf ON bf.banco_id = p.banco_id AND bf.forma_pago_id = p.forma_pago_id
      WHERE p.pedido_venta_id = ${pedidoId}
      ORDER BY p.fecha DESC
    `;
    const enriched = (rows || []).map((r) => {
      return {
        id: r.id,
        pedido_venta_id: r.pedido_venta_id,
        forma_pago_id: r.forma_pago_id,
        banco_id: r.banco_id,
        monto: r.monto,
        referencia: r.referencia,
        fecha_transaccion: r.fecha_transaccion,
        fecha: r.fecha,
        tasa: r.tasa,
        tasa_simbolo: r.tasa_simbolo,
        banco: r.banco_id
          ? {
              id: r.banco_id,
              nombre: r.banco_nombre,
              moneda: r.banco_moneda,
              detalles: r.banco_detalles,
            }
          : null,
        forma_pago: r.forma_pago_id
          ? { id: r.forma_pago_id, nombre: r.forma_nombre, detalles: r.forma_detalles }
          : null,
      };
    });
    return res.json(enriched);
  } catch (err) {
    console.error('Error listando pagos por pedido:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error listando pagos' });
  }
});

// PUT /api/pedidos-venta/:id/status -> cambiar estado con lógica (verificar reservas para 'Enviado', ejecutar completar para 'Completado')
router.put('/:id/status', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const { estado } = req.body;
  const allowed = ['Pendiente', 'Enviado', 'Completado', 'Cancelado'];
  if (!estado || !allowed.includes(estado))
    return res.status(400).json({ error: 'Estado inválido' });
  try {
    // Obtener pedido y bloquear
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0)
      return res.status(404).json({ error: 'Pedido no encontrado' });
    const pedido = pedidoRows[0];

    const transitions = {
      Pendiente: ['Enviado', 'Completado', 'Cancelado'],
      Enviado: ['Completado', 'Cancelado'],
      Completado: [],
      Cancelado: [],
    };
    if (pedido.estado === estado) return res.json({ success: true, estado });
    if (!transitions[pedido.estado] || !transitions[pedido.estado].includes(estado))
      return res.status(400).json({ error: `Transición inválida: ${pedido.estado} -> ${estado}` });

    // Si se marca como Enviado, verificar que exista stock_comprometido suficiente por producto
    if (estado === 'Enviado') {
      const faltantes = [];
      const lineas =
        await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
      for (const linea of lineas) {
        const sumRes =
          await sql`SELECT COALESCE(SUM(stock_comprometido),0) AS comprometido FROM inventario WHERE producto_id = ${linea.producto_id}`;
        const comprometido = (sumRes && sumRes[0] && Number(sumRes[0].comprometido)) || 0;
        if (comprometido < Number(linea.cantidad)) {
          faltantes.push({
            producto_id: linea.producto_id,
            comprometido,
            requerido: Number(linea.cantidad),
          });
        }
      }
      if (faltantes.length > 0)
        return res
          .status(400)
          .json({ error: 'Stock comprometido insuficiente para enviar', faltantes });
      await sql`UPDATE pedidos_venta SET estado = 'Enviado' WHERE id = ${pedidoId}`;
      return res.json({ success: true, estado: 'Enviado' });
    }

    // Si se solicita Completado, reutilizar la función transaccional
    if (estado === 'Completado') {
      try {
        const pago = req.body && req.body.pago ? req.body.pago : null;
        const pagoError = validarPagoObj(pago);
        if (pagoError) return res.status(400).json({ error: pagoError });
        const result = await completarPedidoTransaccional(pedidoId, pago);
        return res.json(result);
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
        if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
        if (err.code === 'INSUFFICIENT_RESERVED')
          return res.status(400).json({ error: err.message });
        if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
        console.error(err);
        return res.status(500).json({ error: 'Error completando pedido' });
      }
    }

    // Cancelado u otros estados: actualizar sin efectos secundarios
    if (estado === 'Cancelado') {
      await sql`UPDATE pedidos_venta SET estado = 'Cancelado' WHERE id = ${pedidoId}`;
      return res.json({ success: true, estado: 'Cancelado' });
    }

    return res.status(400).json({ error: 'Acción no implementada para este estado' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error cambiando estado del pedido' });
  }
});

// POST /api/pedidos-venta/:id/cancelar -> marcar pedido Cancelado (no libera reservas automáticamente)
router.post('/:id/cancelar', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Hacer liberación de reservas en una transacción para recalcular stock_comprometido
    await sql`BEGIN`;
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.estado === 'Completado') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'No se puede cancelar un pedido ya completado' });
    }

    const lineas =
      await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
    const liberaciones = [];
    const warnings = [];

    for (const linea of lineas) {
      let qtyToRelease = Number(linea.cantidad);
      if (isNaN(qtyToRelease) || qtyToRelease <= 0) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'Cantidad inválida en líneas del pedido' });
      }
      // Buscar inventarios donde haya stock_comprometido para este producto
      const invs = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${linea.producto_id} AND i.stock_comprometido > 0
        ORDER BY i.stock_comprometido DESC
        FOR UPDATE
      `;
      let releasedForLine = 0;
      for (const inv of invs) {
        if (qtyToRelease <= 0) break;
        const committed = Number(inv.stock_comprometido);
        if (committed <= 0) continue;
        const take = Math.min(committed, qtyToRelease);
        await sql`UPDATE inventario SET stock_comprometido = stock_comprometido - ${take} WHERE id = ${inv.id}`;
        // Registrar movimiento de inventario para auditoría (tipo 'entrada' indica liberación/retorno a disponible)
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${
          linea.producto_id
        }, ${inv.almacen_id}, 'entrada', ${take}, ${'Liberación reserva pedido ' + pedidoId})`;
        liberaciones.push({
          producto_id: linea.producto_id,
          almacen_id: inv.almacen_id,
          cantidad: take,
        });
        releasedForLine += take;
        qtyToRelease -= take;
      }
      if (qtyToRelease > 0) {
        // No había suficiente stock_comprometido registrado — anotar warning y continuar
        warnings.push({ producto_id: linea.producto_id, restante_no_liberado: qtyToRelease });
      }
    }
    // Después de liberar, recalcular stock_comprometido por producto para evitar inconsistencias
    const productosARecalcular = [...new Set(lineas.map((l) => l.producto_id))];
    const recalculations = [];
    for (const prodId of productosARecalcular) {
      // Expected comprometido = sum de cantidades en pedidos activos (Pendiente, Enviado)
      const sumRes = await sql`
        SELECT COALESCE(SUM(pvprod.cantidad),0) AS esperado
        FROM pedido_venta_productos pvprod
        JOIN pedidos_venta pv ON pv.id = pvprod.pedido_venta_id
        WHERE pvprod.producto_id = ${prodId} AND pv.estado IN ('Pendiente','Enviado')
      `;
      const esperado = (sumRes && sumRes[0] && Number(sumRes[0].esperado)) || 0;

      // Obtener inventarios para el producto y bloquearlos
      const invs = await sql`
        SELECT * FROM inventario WHERE producto_id = ${prodId} ORDER BY stock_fisico DESC FOR UPDATE
      `;
      // Resetear comprometido y redistribuir según 'esperado'
      let remaining = esperado;
      let totalAvailable = 0;
      for (const inv of invs) totalAvailable += Number(inv.stock_fisico);
      const adjustments = [];
      if (invs.length === 0) {
        recalculations.push({
          producto_id: prodId,
          esperado,
          totalAvailable: 0,
          note: 'No hay inventario registrado para este producto',
        });
        continue;
      }
      for (const inv of invs) {
        if (remaining <= 0) {
          // asegurar que quede 0 comprometido
          if (Number(inv.stock_comprometido) !== 0) {
            await sql`UPDATE inventario SET stock_comprometido = 0 WHERE id = ${inv.id}`;
            adjustments.push({ almacen_id: inv.almacen_id, id: inv.id, set_to: 0 });
          }
          continue;
        }
        const assign = Math.min(Number(inv.stock_fisico), remaining);
        await sql`UPDATE inventario SET stock_comprometido = ${assign} WHERE id = ${inv.id}`;
        adjustments.push({ almacen_id: inv.almacen_id, id: inv.id, set_to: assign });
        remaining -= assign;
      }
      recalculations.push({
        producto_id: prodId,
        esperado,
        totalAvailable,
        adjustments,
        remaining_not_assigned: remaining,
      });
    }

    // Finalmente marcar pedido como Cancelado
    await sql`UPDATE pedidos_venta SET estado = 'Cancelado' WHERE id = ${pedidoId}`;
    await sql`COMMIT`;

    // Ejecutar recalculo global en background para asegurar consistencia en todos los productos
    try {
      const child = spawn(process.execPath, ['scripts/recalculate_comprometido.js', '--yes'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      // indicar en la respuesta que el recalculo fue programado
      return res.json({
        success: true,
        pedido_id: pedidoId,
        estado: 'Cancelado',
        reservasLiberadas: true,
        liberaciones,
        warnings,
        recalculations,
        recalculo_disparado: true,
      });
    } catch (errSpawn) {
      // Si no se pudo disparar el proceso, devolver igualmente éxito pero con nota
      console.error('No se pudo disparar recalculo en background:', errSpawn);
      return res.json({
        success: true,
        pedido_id: pedidoId,
        estado: 'Cancelado',
        reservasLiberadas: true,
        liberaciones,
        warnings,
        recalculations,
        recalculo_disparado: false,
        recalculo_error: errSpawn.message,
      });
    }
  } catch (err) {
    try {
      await sql`ROLLBACK`;
    } catch (e) {}
    console.error('Error cancelando pedido:', err);
    return res.status(500).json({ error: 'Error cancelando pedido', detail: err.message });
  }
});

module.exports = router;
