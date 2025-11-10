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
  }
  if (!body.estado || !['Pendiente', 'Enviado', 'Completado'].includes(body.estado)) return 'Estado inválido';
  // Si se provee tasa_cambio_monto debe ser un número positivo
  if (body.tasa_cambio_monto != null && (isNaN(Number(body.tasa_cambio_monto)) || Number(body.tasa_cambio_monto) <= 0)) return 'tasa_cambio_monto inválida';
  return null;
}

router.get('/', async (req, res) => {
  try {
  // Asegurar columnas de snapshot por si la migración no se ejecutó en este entorno
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN costo_unitario NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN precio_venta NUMERIC;`; } catch(e) {}
  try { await sql`ALTER TABLE pedido_venta_productos ADD COLUMN nombre_producto TEXT;`; } catch(e) {}
    const pedidos = await sql`SELECT * FROM pedidos_venta`;
    const pedidosConDetalle = [];
    for (const p of pedidos) {
      const productos = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
               prod.nombre AS producto_nombre, prod.precio_venta, prod.costo, prod.image_url
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        WHERE pv.pedido_venta_id = ${p.id}
      `;
      // Normalizar tipos y calcular subtotales
      let total = 0;
      const productosMapeados = productos.map(item => {
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
          subtotal
        };
      });
      pedidosConDetalle.push({
        ...p,
        productos: productosMapeados,
        total
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
  const { cliente_id, productos, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto } = req.body;
    // Ejecutar en transacción: reservar stock de venta, crear orden de producción si hace falta y crear pedido
    await sql`BEGIN`;
    try {
      // Reserva/producción acumulados para retornar
      const produccionesCreadas = [];

      // Primero validar disponibilidad y reservar
      for (const p of productos) {
        let qtyNeeded = Number(p.cantidad);
        if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Cantidad inválida en productos' });
        }
        // Intentar reservar desde almacenes de tipo 'Venta'
        const inventariosVenta = await sql`
          SELECT i.* FROM inventario i
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE i.producto_id = ${p.producto_id} AND a.tipo = 'Venta'
          ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
        `;
        for (const inv of inventariosVenta) {
          const disponible = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
          if (disponible <= 0) continue;
          const take = Math.min(disponible, qtyNeeded);
          await sql`
            UPDATE inventario SET stock_comprometido = stock_comprometido + ${take} WHERE id = ${inv.id}
          `;
          qtyNeeded -= take;
          if (qtyNeeded === 0) break;
        }

        if (qtyNeeded > 0) {
          // No hay suficiente en venta, intentar producir desde materia prima
          // Buscar fórmula del producto terminado
          const formula = await sql`SELECT * FROM formulas WHERE producto_terminado_id = ${p.producto_id}`;
          if (formula.length === 0) {
            await sql`ROLLBACK`;
            return res.status(400).json({ error: `Producto ${p.producto_id} sin stock suficiente y sin fórmula para producir` });
          }
          const formulaId = formula[0].id;
          // Obtener componentes
          const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${formulaId}`;
          // Verificar disponibilidad de materia prima para producir qtyNeeded unidades
          for (const comp of componentes) {
            const required = Number(comp.cantidad) * qtyNeeded;
            // sumar stock disponible en almacenes MateriaPrima
            const mpInventarios = await sql`
              SELECT i.* FROM inventario i
              JOIN almacenes a ON a.id = i.almacen_id
              WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
              ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
            `;
            let totalDisponible = 0;
            for (const inv of mpInventarios) totalDisponible += Number(inv.stock_fisico) - Number(inv.stock_comprometido);
            if (totalDisponible < required) {
              await sql`ROLLBACK`;
              return res.status(400).json({ error: `Materia prima ${comp.materia_prima_id} insuficiente para producir producto ${p.producto_id}` });
            }
          }
          // Si llegamos aquí hay materia prima suficiente -> crear orden de producción
          const orden = await sql`
            INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha)
            VALUES (${p.producto_id}, ${qtyNeeded}, ${formulaId}, 'Pendiente', NOW()) RETURNING *
          `;
          produccionesCreadas.push(orden[0]);
          // Reservar materia prima (incrementar stock_comprometido) distribuyendo entre inventarios
          for (const comp of componentes) {
            let required = Number(comp.cantidad) * qtyNeeded;
            const mpInventarios = await sql`
              SELECT i.* FROM inventario i
              JOIN almacenes a ON a.id = i.almacen_id
              WHERE i.producto_id = ${comp.materia_prima_id} AND a.tipo = 'MateriaPrima'
              ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
            `;
            for (const inv of mpInventarios) {
              if (required <= 0) break;
              const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
              if (available <= 0) continue;
              const take = Math.min(available, required);
              await sql`UPDATE inventario SET stock_comprometido = stock_comprometido + ${take} WHERE id = ${inv.id}`;
              required -= take;
            }
          }
        }
      }

      // Si llegamos aquí, todo reservado/ordenado correctamente -> insertar pedido y sus líneas
      const tasaMontoVal = tasa_cambio_monto != null ? Number(tasa_cambio_monto) : null;

      const pedido = await sql`
        INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha, tasa_cambio_monto)
        VALUES (${cliente_id || null}, ${nombre_cliente || null}, ${telefono || null}, ${cedula || null}, ${estado}, NOW(), ${tasaMontoVal}) RETURNING *
      `;
      for (const p of productos) {
        // Obtener precio/costo/nombre al momento del pedido para snapshot
        const prodRow = await sql`SELECT precio_venta, costo, nombre FROM productos WHERE id = ${p.producto_id}`;
        const precioUnitario = (prodRow && prodRow[0] && prodRow[0].precio_venta != null) ? prodRow[0].precio_venta : null;
        const costoUnitario = (prodRow && prodRow[0] && prodRow[0].costo != null) ? prodRow[0].costo : null;
        const nombreProducto = (prodRow && prodRow[0] && prodRow[0].nombre != null) ? prodRow[0].nombre : null;
        // Guardar snapshot: nombre y precio_venta
        await sql`
          INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto)
          VALUES (${pedido[0].id}, ${p.producto_id}, ${p.cantidad}, ${costoUnitario}, ${precioUnitario}, ${nombreProducto})
        `;
      }
      // Commit
      await sql`COMMIT`;

      // Recuperar y devolver pedido con detalle (como antes)
        const productosDetalle = await sql`
          SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad,
                 COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
                 COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
                 COALESCE(pv.costo_unitario, prod.costo) AS costo,
                 prod.image_url
          FROM pedido_venta_productos pv
          LEFT JOIN productos prod ON prod.id = pv.producto_id
          WHERE pv.pedido_venta_id = ${pedido[0].id}
        `;
      let total = 0;
      const productosMapeados = productosDetalle.map(item => {
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
          subtotal
        };
      });
      const pedidoObj = { ...pedido[0], productos: productosMapeados, total, producciones: produccionesCreadas };
      return res.status(201).json(pedidoObj);
    } catch (errTx) {
      try { await sql`ROLLBACK`; } catch (e) {}
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
    const productosMapeados = productos.map(item => {
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
        subtotal
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
  await sql`BEGIN`;
  const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
  if (!pedidoRows || pedidoRows.length === 0) {
    await sql`ROLLBACK`;
    const e = new Error('Pedido no encontrado'); e.code = 'NOT_FOUND'; throw e;
  }
  const pedido = pedidoRows[0];
  if (pedido.estado === 'Completado') {
    await sql`ROLLBACK`;
    const e = new Error('Pedido ya completado'); e.code = 'ALREADY_COMPLETED'; throw e;
  }

  const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
  const movimientos = [];

  for (const linea of lineas) {
    let qtyNeeded = Number(linea.cantidad);
    if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
      await sql`ROLLBACK`;
      const e = new Error('Cantidad inválida en líneas del pedido'); e.code = 'INVALID_QTY'; throw e;
    }
    const invs = await sql`
      SELECT i.* FROM inventario i
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE i.producto_id = ${linea.producto_id} AND a.tipo = 'Venta' AND i.stock_comprometido > 0
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
        const e = new Error(`No se pudo consumir inventario reservado para producto ${linea.producto_id}`); e.code = 'INVENTORY_CONFLICT'; throw e;
      }
      await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id}, ${inv.almacen_id}, 'salida', ${take}, ${'Venta pedido ' + pedidoId})`;
      movimientos.push({ producto_id: linea.producto_id, almacen_id: inv.almacen_id, cantidad: take });
      qtyNeeded -= take;
    }
    if (qtyNeeded > 0) {
      await sql`ROLLBACK`;
      const e = new Error(`Stock comprometido insuficiente para producto ${linea.producto_id}`); e.code = 'INSUFFICIENT_RESERVED'; throw e;
    }
  }

  await sql`UPDATE pedidos_venta SET estado = 'Completado' WHERE id = ${pedidoId}`;
  await sql`COMMIT`;
  return { success: true, pedido_id: pedidoId, movimientos };
}

// POST /api/pedidos-venta/:id/completar (usa helper transaccional)
router.post('/:id/completar', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await completarPedidoTransaccional(pedidoId);
    return res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVALID_QTY' || err.code === 'INSUFFICIENT_RESERVED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/pedidos-venta/:id/status -> cambiar estado con lógica (verificar reservas para 'Enviado', ejecutar completar para 'Completado')
router.put('/:id/status', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const { estado } = req.body;
  const allowed = ['Pendiente', 'Enviado', 'Completado', 'Cancelado'];
  if (!estado || !allowed.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    // Obtener pedido y bloquear
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    const pedido = pedidoRows[0];

    const transitions = {
      Pendiente: ['Enviado', 'Completado', 'Cancelado'],
      Enviado: ['Completado', 'Cancelado'],
      Completado: [],
      Cancelado: []
    };
    if (pedido.estado === estado) return res.json({ success: true, estado });
    if (!transitions[pedido.estado] || !transitions[pedido.estado].includes(estado)) return res.status(400).json({ error: `Transición inválida: ${pedido.estado} -> ${estado}` });

    // Si se marca como Enviado, verificar que exista stock_comprometido suficiente por producto
    if (estado === 'Enviado') {
      const faltantes = [];
      const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
      for (const linea of lineas) {
        const sumRes = await sql`SELECT COALESCE(SUM(stock_comprometido),0) AS comprometido FROM inventario WHERE producto_id = ${linea.producto_id}`;
        const comprometido = (sumRes && sumRes[0] && Number(sumRes[0].comprometido)) || 0;
        if (comprometido < Number(linea.cantidad)) {
          faltantes.push({ producto_id: linea.producto_id, comprometido, requerido: Number(linea.cantidad) });
        }
      }
      if (faltantes.length > 0) return res.status(400).json({ error: 'Stock comprometido insuficiente para enviar', faltantes });
      await sql`UPDATE pedidos_venta SET estado = 'Enviado' WHERE id = ${pedidoId}`;
      return res.json({ success: true, estado: 'Enviado' });
    }

    // Si se solicita Completado, reutilizar la función transaccional
    if (estado === 'Completado') {
      try {
        const result = await completarPedidoTransaccional(pedidoId);
        return res.json(result);
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
        if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
        if (err.code === 'INSUFFICIENT_RESERVED') return res.status(400).json({ error: err.message });
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

    const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
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
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id}, ${inv.almacen_id}, 'entrada', ${take}, ${'Liberación reserva pedido ' + pedidoId})`;
        liberaciones.push({ producto_id: linea.producto_id, almacen_id: inv.almacen_id, cantidad: take });
        releasedForLine += take;
        qtyToRelease -= take;
      }
      if (qtyToRelease > 0) {
        // No había suficiente stock_comprometido registrado — anotar warning y continuar
        warnings.push({ producto_id: linea.producto_id, restante_no_liberado: qtyToRelease });
      }
    }
    // Después de liberar, recalcular stock_comprometido por producto para evitar inconsistencias
    const productosARecalcular = [...new Set(lineas.map(l => l.producto_id))];
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
        recalculations.push({ producto_id: prodId, esperado, totalAvailable: 0, note: 'No hay inventario registrado para este producto' });
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
      recalculations.push({ producto_id: prodId, esperado, totalAvailable, adjustments, remaining_not_assigned: remaining });
    }

    // Finalmente marcar pedido como Cancelado
    await sql`UPDATE pedidos_venta SET estado = 'Cancelado' WHERE id = ${pedidoId}`;
    await sql`COMMIT`;

    // Ejecutar recalculo global en background para asegurar consistencia en todos los productos
    try {
      const child = spawn(process.execPath, ['scripts/recalculate_comprometido.js', '--yes'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      // indicar en la respuesta que el recalculo fue programado
      return res.json({ success: true, pedido_id: pedidoId, estado: 'Cancelado', reservasLiberadas: true, liberaciones, warnings, recalculations, recalculo_disparado: true });
    } catch (errSpawn) {
      // Si no se pudo disparar el proceso, devolver igualmente éxito pero con nota
      console.error('No se pudo disparar recalculo en background:', errSpawn);
      return res.json({ success: true, pedido_id: pedidoId, estado: 'Cancelado', reservasLiberadas: true, liberaciones, warnings, recalculations, recalculo_disparado: false, recalculo_error: errSpawn.message });
    }
  } catch (err) {
    try { await sql`ROLLBACK`; } catch(e) {}
    console.error('Error cancelando pedido:', err);
    return res.status(500).json({ error: 'Error cancelando pedido', detail: err.message });
  }
});

module.exports = router;

