const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { spawn } = require('child_process');
const { sendTextMessage, formatOrderSuccessMessage } = require('../services/waha');

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 700);
const PROFILE_QUERIES = String(process.env.PROFILE_QUERIES || 'true').toLowerCase() !== 'false';

function logQueryTime(name, startMs, extra) {
  if (!PROFILE_QUERIES) return;
  const durationMs = Date.now() - startMs;
  const isSlow = durationMs >= SLOW_QUERY_MS;
  const prefix = isSlow ? '[sql:slow]' : '[sql:ok]';
  const suffix = extra ? ` | ${extra}` : '';
  console.log(`${prefix} ${name} | ${durationMs}ms${suffix}`);
}

const AJUSTE_TIPOS = new Set(['descuento', 'recargo']);
const AJUSTE_MODOS = new Set(['porcentaje', 'monto']);
let ajustesTableEnsured = false;

async function ensurePedidoAjustesTable() {
  if (ajustesTableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS pedido_venta_ajustes (
      id SERIAL PRIMARY KEY,
      pedido_venta_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      modo VARCHAR(20) NOT NULL,
      valor NUMERIC NOT NULL,
      motivo TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_pedido_venta_ajustes_pedido ON pedido_venta_ajustes (pedido_venta_id)`;
  ajustesTableEnsured = true;
}

function roundCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function normalizeAjustesInput(rawAjustes) {
  if (rawAjustes == null) return [];
  if (!Array.isArray(rawAjustes)) {
    const err = new Error('Formato de ajustes inválido');
    err.code = 'INVALID_AJUSTES';
    throw err;
  }
  return rawAjustes.map((item, index) => {
    const idxLabel = index + 1;
    if (!item || typeof item !== 'object') {
      const err = new Error(`Ajuste #${idxLabel}: formato inválido`);
      err.code = 'INVALID_AJUSTES';
      throw err;
    }
    const tipoRaw = String(item.tipo || '').trim().toLowerCase();
    if (!AJUSTE_TIPOS.has(tipoRaw)) {
      const err = new Error(`Ajuste #${idxLabel}: tipo inválido (usar descuento/recargo)`);
      err.code = 'INVALID_AJUSTES';
      throw err;
    }
    const modoRaw = String(item.modo || '').trim().toLowerCase();
    if (!AJUSTE_MODOS.has(modoRaw)) {
      const err = new Error(`Ajuste #${idxLabel}: modo inválido (usar porcentaje/monto)`);
      err.code = 'INVALID_AJUSTES';
      throw err;
    }
    const valorNum = Number(item.valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      const err = new Error(`Ajuste #${idxLabel}: valor debe ser numérico y mayor a cero`);
      err.code = 'INVALID_AJUSTES';
      throw err;
    }
    const motivoRaw = String(item.motivo || '').trim();
    if (!motivoRaw) {
      const err = new Error(`Ajuste #${idxLabel}: motivo requerido`);
      err.code = 'INVALID_AJUSTES';
      throw err;
    }
    return {
      tipo: tipoRaw,
      modo: modoRaw,
      valor: roundCurrency(valorNum),
      motivo: motivoRaw,
    };
  });
}

function computeAjustesBreakdown(baseTotal, ajustes) {
  const base = roundCurrency(baseTotal || 0);
  const list = Array.isArray(ajustes) ? ajustes : [];
  let totalDescuentos = 0;
  let totalRecargos = 0;
  const decorated = list.map((ajuste) => {
    const tipo = String(ajuste.tipo || '').toLowerCase();
    const modo = String(ajuste.modo || '').toLowerCase();
    const valorNum = roundCurrency(ajuste.valor || 0);
    const montoAplicado = modo === 'porcentaje'
      ? roundCurrency(base * (valorNum / 100))
      : roundCurrency(valorNum);
    if (tipo === 'descuento') totalDescuentos += montoAplicado;
    else if (tipo === 'recargo') totalRecargos += montoAplicado;
    return { ...ajuste, tipo, modo, valor: valorNum, monto_aplicado: montoAplicado };
  });
  totalDescuentos = roundCurrency(totalDescuentos);
  totalRecargos = roundCurrency(totalRecargos);
  let totalFinal = roundCurrency(base - totalDescuentos + totalRecargos);
  if (totalFinal < 0) totalFinal = 0;
  return {
    ajustes: decorated,
    total_base: base,
    total_descuentos: totalDescuentos,
    total_recargos: totalRecargos,
    total_final: totalFinal,
  };
}

async function fetchAjustesMapByPedidoIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  await ensurePedidoAjustesTable();
  const rows = await sql`
    SELECT id, pedido_venta_id, tipo, modo, valor, motivo, created_at
    FROM pedido_venta_ajustes
    WHERE pedido_venta_id = ANY(${ids})
    ORDER BY created_at ASC, id ASC
  `;
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.pedido_venta_id)) map.set(row.pedido_venta_id, []);
    map.get(row.pedido_venta_id).push({
      id: row.id,
      pedido_venta_id: row.pedido_venta_id,
      tipo: row.tipo,
      modo: row.modo,
      valor: row.valor != null ? Number(row.valor) : 0,
      motivo: row.motivo,
      created_at: row.created_at,
    });
  }
  return map;
}

async function attachAjustesToPedidos(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return pedidos;
  const ids = Array.from(
    new Set(
      pedidos
        .map((p) => Number(p?.id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  if (ids.length === 0) {
    for (const pedido of pedidos) {
      pedido.ajustes = [];
      const base = roundCurrency(pedido.total_base ?? pedido.total ?? 0);
      const breakdown = computeAjustesBreakdown(base, []);
      pedido.total_base = breakdown.total_base;
      pedido.total_descuentos = breakdown.total_descuentos;
      pedido.total_recargos = breakdown.total_recargos;
      pedido.total_final = breakdown.total_final;
      pedido.total = pedido.total_final;
    }
    return pedidos;
  }
  const ajustesMap = await fetchAjustesMapByPedidoIds(ids);
  for (const pedido of pedidos) {
    const base = roundCurrency(pedido.total_base ?? pedido.total ?? 0);
    const ajustes = ajustesMap.get(Number(pedido.id)) || [];
    const breakdown = computeAjustesBreakdown(base, ajustes);
    pedido.ajustes = breakdown.ajustes;
    pedido.total_base = breakdown.total_base;
    pedido.total_descuentos = breakdown.total_descuentos;
    pedido.total_recargos = breakdown.total_recargos;
    pedido.total_final = breakdown.total_final;
    pedido.total = pedido.total_final;
  }
  return pedidos;
}

function formatOrderWhatsappPayload(pedido, lineas) {
  const items = (lineas || []).map((linea) => {
    const quantity = Number(linea.cantidad || 0);
    const unitPrice = Number(linea.precio_venta || 0);
    return {
      name: linea.nombre_producto || `Producto ${linea.producto_id}`,
      quantity,
      price: unitPrice,
    };
  });

  const total = items.reduce((acc, item) => acc + item.quantity * item.price, 0);

  return {
    orderId: pedido.id,
    customerName: pedido.nombre_cliente || 'Cliente',
    total,
    paymentMethod: 'Registrado en sistema',
    address: 'N/D',
    items,
  };
}

async function notifyOrderCompletedByWhatsapp(pedido, lineas) {
  try {
    const to = pedido?.telefono ? String(pedido.telefono).trim() : '';
    if (!to) return;

    const message = formatOrderSuccessMessage(formatOrderWhatsappPayload(pedido, lineas));
    await sendTextMessage({
      to,
      text: message,
      meta: { type: 'order-success', orderId: pedido?.id || null },
    });
  } catch (error) {
    console.warn('[whatsapp] Error enviando notificacion:', error.message);
  }
}

function validarPedido(body) {
  if (!body.cliente_id || isNaN(Number(body.cliente_id))) return 'ID de cliente requerido';
  if (!Array.isArray(body.productos) || body.productos.length === 0) return 'Productos requeridos';
  for (const p of body.productos) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return 'ID de producto requerido';
    if (!p.cantidad || isNaN(Number(p.cantidad))) return 'Cantidad requerida';
    if (p.formula_id != null && isNaN(Number(p.formula_id))) return 'formula_id inválido en productos';
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

// Helper: resolver componentes para una línea de pedido
async function getComponentesForLine(productoId, formulaId, formulaNombre, productoNombre) {
  try {
    const tryQuery = async (fid) => {
      try {
        const res = await sql`
          SELECT fc.materia_prima_id, fc.cantidad, fc.unidad,
                 COALESCE(mp.nombre, ing.nombre) AS nombre,
                 CASE WHEN mp.id IS NOT NULL THEN 'producto' WHEN ing.id IS NOT NULL THEN 'ingrediente' ELSE NULL END AS tipo
         FROM formula_componentes fc
          LEFT JOIN productos mp ON mp.id = fc.materia_prima_id
          LEFT JOIN ingredientes ing ON ing.id = fc.materia_prima_id
          WHERE fc.formula_id = ${fid}
        `;
        return res;
      } catch (innerErr) {
        // Fallback: si la tabla `ingredientes` no existe, ejecutar consulta que solo une con `productos`.
        if (innerErr && String(innerErr.message).toLowerCase().includes('ingredientes')) {
          const res2 = await sql`
            SELECT fc.materia_prima_id, fc.cantidad, fc.unidad,
                   mp.nombre AS nombre,
                   'producto' AS tipo
            FROM formula_componentes fc
            LEFT JOIN productos mp ON mp.id = fc.materia_prima_id
            WHERE fc.formula_id = ${fid}
          `;
          return res2;
        }
        throw innerErr;
      }
    };

    let useFormulaId = formulaId || null;

    // Intentos de resolución: 1) si ya viene formulaId usarla, 2) coincidir por formulaNombre exacto,
    // 3) coincidir por productoNombre exacto, 4) búsqueda difusa ILIKE por formulaNombre/productoNombre
    if (!useFormulaId) {
      if (formulaNombre) {
        const frow = await sql`
          SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre = ${formulaNombre} LIMIT 1
        `;
        if (frow && frow[0] && frow[0].id) useFormulaId = frow[0].id;
      }
      if (!useFormulaId && productoNombre) {
        const frow2 = await sql`
          SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre = ${productoNombre} LIMIT 1
        `;
        if (frow2 && frow2[0] && frow2[0].id) useFormulaId = frow2[0].id;
      }
    }

    if (useFormulaId) {
      let comps = await tryQuery(useFormulaId);
      if ((!comps || comps.length === 0) && formulaNombre) {
        const likePattern = '%' + formulaNombre + '%';
        const frow = await sql`
          SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre ILIKE ${likePattern} LIMIT 1
        `;
        if (frow && frow[0] && frow[0].id) comps = await tryQuery(frow[0].id);
      }
      if ((!comps || comps.length === 0) && productoNombre) {
        const likePattern2 = '%' + productoNombre + '%';
        const frow2 = await sql`
          SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre ILIKE ${likePattern2} LIMIT 1
        `;
        if (frow2 && frow2[0] && frow2[0].id) comps = await tryQuery(frow2[0].id);
      }
      if (comps && comps.length > 0) {
        return comps.map((c) => ({
          materia_prima_id: c.materia_prima_id,
          nombre: c.nombre || null,
          tipo: c.tipo || null,
          cantidad: c.cantidad != null ? Number(c.cantidad) : null,
          unidad: c.unidad || null,
        }));
      }
    } else {
      // intentar búsqueda difusa por productoNombre si no hay formulaId
      if (productoNombre) {
        const like = '%' + productoNombre + '%';
        const frow = await sql`
          SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre ILIKE ${like} LIMIT 1
        `;
        if (frow && frow[0] && frow[0].id) {
          const comps = await tryQuery(frow[0].id);
          if (comps && comps.length > 0) {
            return comps.map((c) => ({
              materia_prima_id: c.materia_prima_id,
              nombre: c.nombre || null,
              tipo: c.tipo || null,
              cantidad: c.cantidad != null ? Number(c.cantidad) : null,
              unidad: c.unidad || null,
            }));
          }
        }
      }
    }
  } catch (e) {
    // ignore y devolver array vacío
  }
  return [];
}

router.get('/', async (req, res) => {
  try {
    const qStart = Date.now();
    const rows = await sql`
      SELECT
        p.*,
        pv.id AS pv_id,
        pv.pedido_venta_id,
        pv.producto_id,
        pv.cantidad,
        pv.formula_id,
        COALESCE(pv.formula_nombre, f.nombre) AS formula_nombre,
        COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
        COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
        COALESCE(pv.costo_unitario, prod.costo) AS costo,
        pv.orden_produccion_id,
        COALESCE(pv.produccion_creada, FALSE) AS produccion_creada,
        prod.image_url,
        (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_completada
      FROM pedidos_venta p
      LEFT JOIN pedido_venta_productos pv ON pv.pedido_venta_id = p.id
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      LEFT JOIN formulas f ON f.id = pv.formula_id
      LEFT JOIN (
        SELECT producto_terminado_id, COALESCE(SUM(cantidad),0) AS produced_total
        FROM ordenes_produccion WHERE estado = 'Completada' GROUP BY producto_terminado_id
      ) op ON op.producto_terminado_id = prod.id
      ORDER BY p.id DESC, pv.id ASC
    `;
    logQueryTime('pedidosVenta.getAll', qStart, `rows=${rows?.length || 0}`);

    const map = new Map();
    for (const row of rows || []) {
      if (!map.has(row.id)) map.set(row.id, { ...row, productos: [], total: 0 });
      if (row.pv_id == null) continue;
      const cantidad = Number(row.cantidad);
      const precio = row.precio_venta != null ? parseFloat(row.precio_venta) : 0;
      const costo = row.costo != null ? parseFloat(row.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      const pedido = map.get(row.id);
      pedido.total += subtotal;
      pedido.productos.push({
        id: row.pv_id,
        pedido_venta_id: row.pedido_venta_id,
        producto_id: row.producto_id,
        formula_id: row.formula_id || null,
        formula_nombre: row.formula_nombre || null,
        orden_produccion_id: row.orden_produccion_id || null,
        produccion_creada: !!row.produccion_creada,
        cantidad,
        producto_nombre: row.producto_nombre,
        produccion_completada: !!row.produccion_completada,
        precio_venta: isNaN(precio) ? null : precio,
        costo,
        image_url: row.image_url,
        subtotal,
      });
    }

    const pedidos = Array.from(map.values());
    await attachAjustesToPedidos(pedidos);
    res.json(pedidos);
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

    await sql`BEGIN`;
    try {
      const insertedPedido =
        await sql`INSERT INTO pedidos_venta (cliente_id, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto, fecha) VALUES (${cliente_id}, ${estado}, ${nombre_cliente || null}, ${telefono || null}, ${cedula || null}, ${tasa_cambio_monto || null}, CURRENT_TIMESTAMP AT TIME ZONE 'America/Caracas') RETURNING *`;
      const pedidoId = insertedPedido && insertedPedido[0] ? insertedPedido[0].id : null;
      if (!pedidoId) {
        await sql`ROLLBACK`;
        return res.status(500).json({ error: 'No se pudo crear el pedido' });
      }

      for (const p of productos) {
        const productoId = Number(p.producto_id);
        const cantidad = Number(p.cantidad);
        if (isNaN(productoId) || isNaN(cantidad) || cantidad <= 0) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: 'Producto o cantidad inválidos en líneas' });
        }

        const prodRow = await sql`SELECT id, nombre, precio_venta, costo FROM productos WHERE id = ${productoId} LIMIT 1`;
        if (!prodRow || !prodRow[0]) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: `Producto no encontrado: ${productoId}` });
        }
        const prod = prodRow[0];

        // Si se provee formula_id, validar que pertenece al producto (si existe relación en esquema)
        let formulaId = null;
        let formulaNombre = null;
        let costoUnitario = prod.costo;
        let precioVenta = prod.precio_venta;
        if (p.formula_id != null) {
          formulaId = Number(p.formula_id);
          if (isNaN(formulaId)) {
            await sql`ROLLBACK`;
            return res.status(400).json({ error: 'formula_id inválido en líneas' });
          }
          const frow = await sql`SELECT id, nombre, costo, precio_venta FROM formulas WHERE id = ${formulaId} LIMIT 1`;
          if (!frow || !frow[0]) {
            await sql`ROLLBACK`;
            return res.status(400).json({ error: `Fórmula no encontrada: ${formulaId}` });
          }
          const f = frow[0];
          formulaNombre = f.nombre || null;
          // Si la formula tiene costos/precios específicos, priorizarlos
          if (f.costo != null) costoUnitario = f.costo;
          if (f.precio_venta != null) precioVenta = f.precio_venta;
        }

        await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, nombre_producto, precio_venta, costo_unitario, formula_id, formula_nombre, orden_produccion_id, produccion_creada) VALUES (${pedidoId}, ${productoId}, ${cantidad}, ${prod.nombre}, ${precioVenta || null}, ${costoUnitario || null}, ${formulaId || null}, ${formulaNombre || null}, ${null}, ${false})`;
      }

      await sql`COMMIT`;

      // Devolver pedido con detalle
      const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId}`;
      const productosDetalle = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id, pv.formula_nombre,
               COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
               COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
               COALESCE(pv.costo_unitario, prod.costo) AS costo, prod.image_url
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        WHERE pv.pedido_venta_id = ${pedidoId}
      `;
      let total = 0;
      const productosMapeados = (productosDetalle || []).map((item) => {
        const cantidad = Number(item.cantidad);
        const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
        const costo = item.costo != null ? parseFloat(item.costo) : null;
        const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
        total += subtotal;
        return {
          id: item.id,
          pedido_venta_id: item.pedido_venta_id,
          producto_id: item.producto_id,
          formula_id: item.formula_id || null,
          formula_nombre: item.formula_nombre || null,
          cantidad,
          producto_nombre: item.producto_nombre,
          precio_venta: isNaN(precio) ? null : precio,
          costo: costo,
          image_url: item.image_url,
          subtotal,
        };
      });
      const pedidoObj = { ...(pedidoRows && pedidoRows[0] ? pedidoRows[0] : {}), productos: productosMapeados, total };
      await attachAjustesToPedidos([pedidoObj]);
      return res.status(201).json(pedidoObj);
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) { }
      throw errTx;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await sql`
      SELECT estado, COUNT(*)::int as count 
      FROM pedidos_venta 
      GROUP BY estado
    `;

    // Formatear la respuesta para que sea fácil de consumir
    const result = {
      Pendiente: 0,
      Enviado: 0,
      Completado: 0,
      Cancelado: 0,
      Total: 0
    };

    let total = 0;
    stats.forEach(s => {
      if (result.hasOwnProperty(s.estado)) {
        result[s.estado] = s.count;
      }
      total += s.count;
    });
    result.Total = total;

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar pedidos por ID o nombre del cliente
// GET /api/pedidos-venta/buscar?q=termino
router.get('/buscar', async (req, res) => {
  try {
    const searchTerm = req.query.q;
    if (!searchTerm || searchTerm.trim() === '') {
      return res.status(400).json({ error: 'Término de búsqueda requerido' });
    }

    // Verificar si es una búsqueda por ID (numérico)
    const isNumericSearch = !isNaN(searchTerm) && !isNaN(parseFloat(searchTerm));

    let pedidos;
    if (isNumericSearch) {
      // Búsqueda por ID de pedido (búsqueda exacta)
      pedidos = await sql`
        SELECT * FROM pedidos_venta 
        WHERE id = ${parseInt(searchTerm)}
        ORDER BY fecha DESC
        LIMIT 20
      `;
    } else {
      // Búsqueda por nombre (búsqueda parcial case-insensitive)
      const searchPattern = `%${searchTerm}%`;
      pedidos = await sql`
        SELECT * FROM pedidos_venta
        WHERE nombre_cliente ILIKE ${searchPattern}
        ORDER BY 
          CASE 
            WHEN nombre_cliente ILIKE ${searchPattern} THEN 1
            ELSE 2
          END,
          fecha DESC
        LIMIT 20
      `;
    }

    // Enriquecer los pedidos con los detalles de productos
    const pedidosConDetalle = [];
    for (const p of pedidos) {
      const productos = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id,
          COALESCE(pv.formula_nombre, f.nombre) AS formula_nombre,
          COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
          COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
          COALESCE(pv.costo_unitario, prod.costo) AS costo,
          pv.orden_produccion_id,
          COALESCE(pv.produccion_creada, FALSE) AS produccion_creada,
          prod.image_url,
          (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_completada
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        LEFT JOIN formulas f ON f.id = pv.formula_id
        LEFT JOIN (
          SELECT producto_terminado_id, COALESCE(SUM(cantidad),0) AS produced_total
          FROM ordenes_produccion 
          WHERE estado = 'Completada' 
          GROUP BY producto_terminado_id
        ) op ON op.producto_terminado_id = prod.id
        WHERE pv.pedido_venta_id = ${p.id}
      `;

      // Calcular total del pedido
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
          formula_id: item.formula_id || null,
          formula_nombre: item.formula_nombre || null,
          orden_produccion_id: item.orden_produccion_id || null,
          produccion_creada: !!item.produccion_creada,
          cantidad,
          producto_nombre: item.producto_nombre,
          produccion_completada: !!item.produccion_completada,
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

    await attachAjustesToPedidos(pedidosConDetalle);

    // Si solo hay un resultado y es búsqueda por ID, devolver directamente el objeto
    if (isNumericSearch && pedidosConDetalle.length === 1) {
      return res.json(pedidosConDetalle[0]);
    }

    res.json(pedidosConDetalle);
  } catch (err) {
    console.error('Error en búsqueda de pedidos:', err);
    res.status(500).json({
      error: 'Error al buscar pedidos',
      details: err.message
    });
  }
});



router.get('/paginated', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const countStart = Date.now();
    const countResult = await sql`SELECT COUNT(*) FROM pedidos_venta`;
    logQueryTime('pedidosVenta.paginated.count', countStart);
    const total = parseInt(countResult[0].count);

    const pageStart = Date.now();
    const rows = await sql`
      WITH selected AS (
        SELECT * FROM pedidos_venta ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}
      )
      SELECT
        s.*,
        pv.id AS pv_id,
        pv.pedido_venta_id,
        pv.producto_id,
        pv.cantidad,
        pv.formula_id,
        COALESCE(pv.formula_nombre, f.nombre) AS formula_nombre,
        COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
        COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
        COALESCE(pv.costo_unitario, prod.costo) AS costo,
        pv.orden_produccion_id,
        COALESCE(pv.produccion_creada, FALSE) AS produccion_creada,
        prod.image_url,
        (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_completada
      FROM selected s
      LEFT JOIN pedido_venta_productos pv ON pv.pedido_venta_id = s.id
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      LEFT JOIN formulas f ON f.id = pv.formula_id
      LEFT JOIN (
        SELECT producto_terminado_id, COALESCE(SUM(cantidad),0) AS produced_total
        FROM ordenes_produccion WHERE estado = 'Completada' GROUP BY producto_terminado_id
      ) op ON op.producto_terminado_id = prod.id
      ORDER BY s.id DESC, pv.id ASC
    `;
    logQueryTime(
      'pedidosVenta.paginated.data',
      pageStart,
      `page=${page} limit=${limit} rows=${rows?.length || 0}`
    );

    const map = new Map();
    for (const row of rows || []) {
      if (!map.has(row.id)) map.set(row.id, { ...row, productos: [], total: 0 });
      if (row.pv_id == null) continue;
      const cantidad = Number(row.cantidad);
      const precio = row.precio_venta != null ? parseFloat(row.precio_venta) : 0;
      const costo = row.costo != null ? parseFloat(row.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      const pedido = map.get(row.id);
      pedido.total += subtotal;
      pedido.productos.push({
        id: row.pv_id,
        pedido_venta_id: row.pedido_venta_id,
        producto_id: row.producto_id,
        formula_id: row.formula_id || null,
        formula_nombre: row.formula_nombre || null,
        orden_produccion_id: row.orden_produccion_id || null,
        produccion_creada: !!row.produccion_creada,
        cantidad,
        producto_nombre: row.producto_nombre,
        produccion_completada: !!row.produccion_completada,
        precio_venta: isNaN(precio) ? null : precio,
        costo,
        image_url: row.image_url,
        subtotal,
      });
    }

    const pedidosConDetalle = Array.from(map.values());
    await attachAjustesToPedidos(pedidosConDetalle);
    res.json({
      data: pedidosConDetalle,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint optimizado para reportes (evita N+1 y payload innecesario)
router.get('/reportes-resumen', async (req, res) => {
  try {
    const qStart = Date.now();
    const rows = await sql`
      SELECT
        pv.id,
        pv.estado,
        pv.fecha,
        pv.nombre_cliente,
        pv.telefono,
        pv.cedula,
        pvp.producto_id,
        pvp.cantidad,
        COALESCE(pvp.nombre_producto, prod.nombre) AS nombre_producto,
        COALESCE(pvp.precio_venta, prod.precio_venta, 0) AS precio_venta
      FROM pedidos_venta pv
      LEFT JOIN pedido_venta_productos pvp ON pvp.pedido_venta_id = pv.id
      LEFT JOIN productos prod ON prod.id = pvp.producto_id
      ORDER BY pv.id DESC
    `;
    logQueryTime('pedidosVenta.reportesResumen', qStart, `rows=${rows?.length || 0}`);

    const byPedidoId = new Map();
    for (const row of rows || []) {
      if (!byPedidoId.has(row.id)) {
        byPedidoId.set(row.id, {
          id: row.id,
          estado: row.estado,
          fecha: row.fecha,
          nombre_cliente: row.nombre_cliente,
          telefono: row.telefono,
          cedula: row.cedula,
          productos: [],
          total: 0,
        });
      }

      if (row.producto_id != null) {
        const cantidad = Number(row.cantidad || 0);
        const precio = Number(row.precio_venta || 0);
        const subtotal = cantidad * precio;
        const pedido = byPedidoId.get(row.id);
        pedido.productos.push({
          producto_id: row.producto_id,
          cantidad,
          precio_venta: precio,
          nombre_producto: row.nombre_producto,
          subtotal,
        });
        pedido.total += subtotal;
      }
    }

    res.json(Array.from(byPedidoId.values()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reportes-presentaciones', async (req, res) => {
  try {
    const estadosVendidos = [
      'completado',
      'completada',
      'completa',
      'finalizado',
      'finalizada',
      'entregado',
      'pagado',
      'terminado',
    ];

    const qStart = Date.now();
    const rows = await sql`
      WITH lineas AS (
        SELECT
          (COALESCE(NULLIF(TRIM(pvp.cantidad::text), ''), '0'))::numeric AS cantidad,
          LOWER(COALESCE(pvp.nombre_producto, pvp.formula_nombre, prod.nombre, '')) AS nombre_lower,
          DATE_TRUNC('month', pv.fecha)::date AS fecha_mes
        FROM pedidos_venta pv
        INNER JOIN pedido_venta_productos pvp ON pvp.pedido_venta_id = pv.id
        LEFT JOIN productos prod ON prod.id = pvp.producto_id
        WHERE LOWER(COALESCE(pv.estado, '')) = ANY(${estadosVendidos})
      ),
      normalizados AS (
        SELECT
          cantidad,
          fecha_mes,
          CASE
            WHEN nombre_lower = '' THEN NULL
            ELSE SUBSTRING(nombre_lower FROM '([0-9]+(?:\\.[0-9]+)?)\\s*ml')
          END AS ml_text
        FROM lineas
      ),
      presentaciones AS (
        SELECT
          cantidad,
          fecha_mes,
          CASE
            WHEN ml_text IS NULL THEN NULL
            ELSE (ml_text)::numeric
          END AS ml_numeric
        FROM normalizados
      ),
      series AS (
        SELECT
          CASE
            WHEN ml_numeric IS NULL THEN 'Sin presentación (ml)'
            ELSE CONCAT(ml_numeric::text, 'ml')
          END AS presentacion_ml,
          ml_numeric,
          fecha_mes,
          TO_CHAR(fecha_mes, 'YYYY-MM') AS month_key,
          SUM(cantidad)::numeric AS unidades_vendidas_mes
        FROM presentaciones
        GROUP BY presentacion_ml, ml_numeric, fecha_mes
      )
      SELECT
        presentacion_ml,
        SUM(unidades_vendidas_mes)::numeric AS unidades_vendidas,
        MAX(ml_numeric) AS ml_numeric,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'month', month_key,
              'unidades_vendidas', unidades_vendidas_mes
            ) ORDER BY month_key
          ) FILTER (WHERE month_key IS NOT NULL),
          '[]'::jsonb
        ) AS ventas_mensuales
      FROM series
      GROUP BY presentacion_ml, ml_numeric
      ORDER BY ml_numeric NULLS LAST, presentacion_ml
    `;
    logQueryTime('pedidosVenta.reportesPresentaciones', qStart, `rows=${rows?.length || 0}`);

    res.json(
      rows.map((row) => ({
        presentacion_ml: row.presentacion_ml,
        unidades_vendidas: row.unidades_vendidas != null ? Number(row.unidades_vendidas) : 0,
        ventas_mensuales: Array.isArray(row.ventas_mensuales)
          ? row.ventas_mensuales.map((item) => ({
              month: item?.month || null,
              unidades_vendidas:
                item?.unidades_vendidas != null ? Number(item.unidades_vendidas) : 0,
            }))
          : [],
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clientes-top-resumen', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 10);
    const pedidosLimitRaw = Number(req.query.pedidos_limit || 5);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
    const pedidosLimit = Number.isFinite(pedidosLimitRaw)
      ? Math.min(Math.max(pedidosLimitRaw, 1), 20)
      : 5;

    const qStart = Date.now();
    const rows = await sql`
      WITH pedidos_totales AS (
        SELECT
          pv.id,
          pv.fecha,
          pv.estado,
          COALESCE(NULLIF(TRIM(pv.nombre_cliente), ''), 'Cliente sin nombre') AS cliente_nombre,
          COALESCE(NULLIF(TRIM(pv.telefono), ''), NULLIF(TRIM(pv.cedula), ''), NULLIF(TRIM(pv.nombre_cliente), ''), CONCAT('cliente-', pv.id::text)) AS cliente_key,
          COUNT(pvp.id)::int AS items_count,
          COALESCE(SUM(COALESCE(pvp.cantidad, 0) * COALESCE(pvp.precio_venta, prod.precio_venta, 0)), 0) AS total
        FROM pedidos_venta pv
        LEFT JOIN pedido_venta_productos pvp ON pvp.pedido_venta_id = pv.id
        LEFT JOIN productos prod ON prod.id = pvp.producto_id
        WHERE LOWER(COALESCE(pv.estado, '')) IN ('completado', 'completada', 'completa', 'finalizado', 'finalizada', 'entregado', 'pagado', 'terminado')
        GROUP BY pv.id, pv.fecha, pv.estado, cliente_nombre, cliente_key
      ),
      top_clientes AS (
        SELECT
          cliente_key,
          MAX(cliente_nombre) AS cliente_nombre,
          COUNT(*)::int AS pedidos_count,
          COALESCE(SUM(total), 0) AS monto_total
        FROM pedidos_totales
        GROUP BY cliente_key
        ORDER BY COALESCE(SUM(total), 0) DESC
        LIMIT ${limit}
      ),
      pedidos_rank AS (
        SELECT
          pt.*,
          ROW_NUMBER() OVER (PARTITION BY pt.cliente_key ORDER BY pt.fecha DESC, pt.id DESC) AS rn
        FROM pedidos_totales pt
        INNER JOIN top_clientes tc ON tc.cliente_key = pt.cliente_key
      )
      SELECT
        tc.cliente_key,
        tc.cliente_nombre,
        tc.pedidos_count,
        tc.monto_total,
        pr.id AS pedido_id,
        pr.fecha AS pedido_fecha,
        pr.estado AS pedido_estado,
        pr.total AS pedido_total,
        pr.items_count AS pedido_items_count
      FROM top_clientes tc
      LEFT JOIN pedidos_rank pr ON pr.cliente_key = tc.cliente_key AND pr.rn <= ${pedidosLimit}
      ORDER BY tc.monto_total DESC, tc.cliente_nombre ASC, pr.fecha DESC, pr.id DESC
    `;
    logQueryTime(
      'pedidosVenta.clientesTopResumen',
      qStart,
      `limit=${limit} pedidos_limit=${pedidosLimit} rows=${rows?.length || 0}`
    );

    const grouped = [];
    const byKey = new Map();
    for (const row of rows || []) {
      if (!byKey.has(row.cliente_key)) {
        const clientObj = {
          cliente_key: row.cliente_key,
          nombre: row.cliente_nombre,
          pedidos: Number(row.pedidos_count || 0),
          monto: Number(row.monto_total || 0),
          pedidos_resumen: [],
        };
        byKey.set(row.cliente_key, clientObj);
        grouped.push(clientObj);
      }

      if (row.pedido_id != null) {
        byKey.get(row.cliente_key).pedidos_resumen.push({
          id: row.pedido_id,
          fecha: row.pedido_fecha,
          estado: row.pedido_estado,
          total: Number(row.pedido_total || 0),
          items_count: Number(row.pedido_items_count || 0),
        });
      }
    }

    res.json({
      limit,
      pedidos_limit: pedidosLimit,
      data: grouped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pedidoStart = Date.now();
    const pedido = await sql`SELECT * FROM pedidos_venta WHERE id = ${req.params.id}`;
    logQueryTime('pedidosVenta.getById.pedido', pedidoStart, `pedidoId=${req.params.id}`);
    if (pedido.length === 0) return res.status(404).json({ error: 'No encontrado' });

    const lineasStart = Date.now();
    const productos = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id,
             COALESCE(pv.formula_nombre, f.nombre) AS formula_nombre,
             COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
             COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
             COALESCE(pv.costo_unitario, prod.costo) AS costo,
             pv.orden_produccion_id,
             COALESCE(pv.produccion_creada, FALSE) AS produccion_creada,
             prod.image_url,
             (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_completada
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      LEFT JOIN formulas f ON f.id = pv.formula_id
      LEFT JOIN (
        SELECT producto_terminado_id, COALESCE(SUM(cantidad),0) AS produced_total
        FROM ordenes_produccion WHERE estado = 'Completada' GROUP BY producto_terminado_id
      ) op ON op.producto_terminado_id = prod.id
      WHERE pv.pedido_venta_id = ${req.params.id}
    `;
    logQueryTime('pedidosVenta.getById.lineas', lineasStart, `pedidoId=${req.params.id} rows=${productos?.length || 0}`);
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
        formula_id: item.formula_id || null,
        formula_nombre: item.formula_nombre || null,
        orden_produccion_id: item.orden_produccion_id || null,
        produccion_creada: !!item.produccion_creada,
        cantidad,
        producto_nombre: item.producto_nombre,
        produccion_completada: !!item.produccion_completada,
        precio_venta: isNaN(precio) ? null : precio,
        costo: costo,
        image_url: item.image_url,
        subtotal,
      };
    });
    // No incluir componentes: el front recibirá `formula_id` y `formula_nombre` para crear la orden de producción
    const pedidoObj = { ...pedido[0], productos: productosMapeados, total };
    await attachAjustesToPedidos([pedidoObj]);
    res.json(pedidoObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper transaccional para completar un pedido: consume reservas, aplica ajustes y marca Completado
async function completarPedidoTransaccional(pedidoId, options) {
  let pagoObj = null;
  let ajustesRaw = null;

  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const hasPagoKey = Object.prototype.hasOwnProperty.call(options, 'pago');
    const hasAjustesKey = Object.prototype.hasOwnProperty.call(options, 'ajustes');
    if (hasPagoKey || hasAjustesKey) {
      if (hasPagoKey) pagoObj = options.pago || null;
      if (hasAjustesKey) ajustesRaw = options.ajustes;
    } else {
      pagoObj = options;
    }
  } else if (options) {
    pagoObj = options;
  }

  let ajustesSanitizados = null;
  if (ajustesRaw != null) {
    ajustesSanitizados = normalizeAjustesInput(ajustesRaw);
  }

  if (ajustesSanitizados !== null) {
    await ensurePedidoAjustesTable();
  }

  let baseTotal = 0;
  const movimientos = [];
  let pagoInserted = null;

  await sql`BEGIN`;
  try {
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

    const lineas = await sql`SELECT * FROM pedido_venta_productos WHERE pedido_venta_id = ${pedidoId}`;
    for (const linea of lineas || []) {
      const cantidad = Number(linea.cantidad);
      const precio = Number(linea.precio_venta);
      if (Number.isFinite(cantidad) && Number.isFinite(precio)) {
        baseTotal += cantidad * precio;
      }
    }
    baseTotal = roundCurrency(baseTotal);

    for (const linea of lineas) {
      let qtyNeeded = Number(linea.cantidad);
      if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
        await sql`ROLLBACK`;
        const e = new Error('Cantidad inválida en líneas del pedido');
        e.code = 'INVALID_QTY';
        throw e;
      }
      if (linea.formula_id) {
        try {
          const prodRes = await sql`
            SELECT COALESCE(SUM(cantidad),0) AS produced FROM ordenes_produccion
            WHERE producto_terminado_id = ${linea.producto_id} AND estado = 'Completada'
          `;
          const produced = (prodRes && prodRes[0] && Number(prodRes[0].produced)) || 0;
          if (produced < qtyNeeded) {
            await sql`ROLLBACK`;
            const e = new Error(`Producto ${linea.producto_id} no producido suficiente (${produced}/${qtyNeeded})`);
            e.code = 'NOT_PRODUCED';
            throw e;
          }
        } catch (errCheck) {
          if (errCheck && errCheck.code === 'NOT_PRODUCED') throw errCheck;
        }
      }

      const invsReserved = await sql`
        SELECT i.* FROM inventario i
        JOIN almacenes a ON a.id = i.almacen_id
        WHERE i.producto_id = ${linea.producto_id} AND a.tipo IN ('venta','interno') AND i.stock_comprometido > 0
        ORDER BY i.stock_comprometido DESC
        FOR UPDATE
      `;
      for (const inv of invsReserved) {
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
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id
          }, ${inv.almacen_id}, 'salida', ${take}, ${'Venta pedido ' + pedidoId})`;
        movimientos.push({
          producto_id: linea.producto_id,
          almacen_id: inv.almacen_id,
          cantidad: take,
        });
        qtyNeeded -= take;
      }

      if (qtyNeeded > 0) {
        const invsAvailable = await sql`
          SELECT i.* FROM inventario i
          JOIN almacenes a ON a.id = i.almacen_id
          WHERE i.producto_id = ${linea.producto_id} AND a.tipo IN ('venta','interno') AND (i.stock_fisico - i.stock_comprometido) > 0
          ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
          FOR UPDATE
        `;
        for (const inv of invsAvailable) {
          if (qtyNeeded <= 0) break;
          const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido || 0);
          if (available <= 0) continue;
          const take = Math.min(available, qtyNeeded);
          const consumed = await sql`
            UPDATE inventario
            SET stock_fisico = stock_fisico - ${take}
            WHERE id = ${inv.id} AND stock_fisico - ${take} >= 0
            RETURNING id, stock_fisico, stock_comprometido, almacen_id
          `;
          if (!consumed || consumed.length === 0) {
            await sql`ROLLBACK`;
            const e = new Error(
              `No se pudo consumir inventario disponible para producto ${linea.producto_id}`
            );
            e.code = 'INVENTORY_CONFLICT';
            throw e;
          }
          await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id
            }, ${inv.almacen_id}, 'salida', ${take}, ${'Venta pedido ' + pedidoId})`;
          movimientos.push({
            producto_id: linea.producto_id,
            almacen_id: inv.almacen_id,
            cantidad: take,
          });
          qtyNeeded -= take;
        }
      }

      if (qtyNeeded > 0) {
        await sql`ROLLBACK`;
        const e = new Error(`Stock insuficiente para producto ${linea.producto_id}`);
        e.code = 'INSUFFICIENT_STOCK';
        throw e;
      }
    }

    if (ajustesSanitizados !== null) {
      const preview = computeAjustesBreakdown(baseTotal, ajustesSanitizados);
      if (preview.total_descuentos > preview.total_base) {
        await sql`ROLLBACK`;
        const e = new Error('Los descuentos superan el total del pedido');
        e.code = 'INVALID_AJUSTES';
        throw e;
      }
      await sql`DELETE FROM pedido_venta_ajustes WHERE pedido_venta_id = ${pedidoId}`;
      for (const adj of ajustesSanitizados) {
        await sql`
          INSERT INTO pedido_venta_ajustes (pedido_venta_id, tipo, modo, valor, motivo)
          VALUES (${pedidoId}, ${adj.tipo}, ${adj.modo}, ${adj.valor}, ${adj.motivo})
        `;
      }
    }

    await sql`UPDATE pedidos_venta SET estado = 'Completado' WHERE id = ${pedidoId}`;

    if (pagoObj) {
      try {
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
        } catch (e) { }

        let tasaVal = null;
        let tasaSimbolo = null;
        try {
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
                  tasaSimbolo = moneda;
                }
              }
            } catch (e) { }
          }
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
        }
        if (tasaVal == null) {
          try {
            const anyT =
              await sql`SELECT monto, simbolo FROM tasas_cambio WHERE activo = TRUE LIMIT 1`;
            if (anyT && anyT[0]) {
              tasaVal = anyT[0].monto;
              tasaSimbolo = anyT[0].simbolo;
            }
          } catch (e) { }
        }

        const inserted = await sql`
          INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
          VALUES (${pedidoId}, ${pagoObj.forma_pago_id}, ${pagoObj.banco_id || null}, ${pagoObj.monto
          }, ${pagoObj.referencia || null}, ${pagoObj.fecha_transaccion || null}, NOW(), ${tasaVal || null
          }, ${tasaSimbolo || null}) RETURNING *
        `;
        pagoInserted = inserted && inserted[0] ? inserted[0] : null;
      } catch (e) {
        await sql`ROLLBACK`;
        const err = new Error('Error registrando pago: ' + e.message);
        err.code = 'PAYMENT_INSERT_ERROR';
        throw err;
      }
    }

    await sql`COMMIT`;
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) { }
    throw err;
  }

  const resumen = [{ id: pedidoId, total: baseTotal, total_base: baseTotal }];
  await attachAjustesToPedidos(resumen);
  const enriched = resumen[0];

  return {
    success: true,
    pedido_id: pedidoId,
    movimientos,
    pago: pagoInserted,
    ajustes: enriched.ajustes,
    total_base: enriched.total_base,
    total_descuentos: enriched.total_descuentos,
    total_recargos: enriched.total_recargos,
    total_final: enriched.total_final,
  };
}

// POST /api/pedidos-venta/:id/completar (usa helper transaccional)
router.post('/:id/completar', async (req, res) => {
  const pedidoId = Number(req.params.id);

  console.log('--- PETICIÓN DE DESCARGO (PEDIDO VENTA) ---');
  console.log(`Pedido ID: ${pedidoId}`);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-------------------------------------------');

  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const body = req.body || {};
  const pago = body && body.pago ? body.pago : null;
  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });
  try {
    const hasAjustes = Object.prototype.hasOwnProperty.call(body, 'ajustes');
    const options = {};
    if (pago) options.pago = pago;
    if (hasAjustes) options.ajustes = body.ajustes;
    const optionsProvided = Object.keys(options).length > 0;
    const result = optionsProvided
      ? await completarPedidoTransaccional(pedidoId, options)
      : await completarPedidoTransaccional(pedidoId);
    return res.json(result);
  } catch (err) {
    if (err.code === 'NOT_PRODUCED') return res.status(400).json({ error: err.message });
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVALID_QTY' || err.code === 'INSUFFICIENT_RESERVED' || err.code === 'INSUFFICIENT_STOCK')
      return res.status(400).json({ error: err.message });
    if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
    if (err.code === 'INVALID_AJUSTES') return res.status(400).json({ error: err.message });
    if (err.code === 'PAYMENT_INSERT_ERROR') return res.status(500).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/pedidos-venta/:id/finalizar -> endpoint explícito para completar y registrar pago
router.post('/:id/finalizar', async (req, res) => {
  const pedidoId = Number(req.params.id);

  console.log('--- PETICIÓN DE FINALIZAR Y DESCARGAR ---');
  console.log(`Pedido ID: ${pedidoId}`);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('-----------------------------------------');

  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });
  const body = req.body || {};
  const pago = body && body.pago ? body.pago : null;
  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });
  try {
    const hasAjustes = Object.prototype.hasOwnProperty.call(body, 'ajustes');
    const options = {};
    if (pago) options.pago = pago;
    if (hasAjustes) options.ajustes = body.ajustes;
    const optionsProvided = Object.keys(options).length > 0;
    const result = optionsProvided
      ? await completarPedidoTransaccional(pedidoId, options)
      : await completarPedidoTransaccional(pedidoId);
    return res.json(result);
  } catch (err) {
    if (err.code === 'NOT_PRODUCED') return res.status(400).json({ error: err.message });
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
    if (err.code === 'INVALID_QTY' || err.code === 'INSUFFICIENT_RESERVED' || err.code === 'INSUFFICIENT_STOCK')
      return res.status(400).json({ error: err.message });
    if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
    if (err.code === 'INVALID_AJUSTES') return res.status(400).json({ error: err.message });
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
      } catch (e) { }

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
          } catch (e) { }
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
            } catch (e) { }
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
        } catch (e) { }
      }

      const inserted = await sql`
        INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
        VALUES (${pedidoId}, ${pago.forma_pago_id}, ${pago.banco_id || null}, ${pago.monto}, ${pago.referencia || null
        }, ${pago.fecha_transaccion || null}, NOW(), ${tasaVal || null}, ${tasaSimbolo || null
        }) RETURNING *
      `;
      await sql`COMMIT`;
      return res.status(201).json({ ok: true, pago: inserted && inserted[0] ? inserted[0] : null });
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) { }
      throw errTx;
    }
  } catch (err) {
    console.error('Error registrando pago adicional:', err);
    return res.status(500).json({ error: 'Error registrando pago' });
  }
});

// POST /api/pedidos-venta/:id/items -> agregar más items (líneas) a un pedido existente
router.post('/:id/items', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });

  // aceptar body { productos: [...] } o un solo objeto { producto: {...} }
  let productos = [];
  if (Array.isArray(req.body.productos)) productos = req.body.productos;
  else if (req.body.producto) productos = [req.body.producto];
  else if (Array.isArray(req.body)) productos = req.body;

  if (!Array.isArray(productos) || productos.length === 0)
    return res.status(400).json({ error: 'Productos requeridos' });

  // validar formato básico de las líneas
  for (const p of productos) {
    if (!p.producto_id || isNaN(Number(p.producto_id))) return res.status(400).json({ error: 'ID de producto requerido en líneas' });
    if (!p.cantidad || isNaN(Number(p.cantidad)) || Number(p.cantidad) <= 0) return res.status(400).json({ error: 'Cantidad requerida e inválida en líneas' });
    if (p.formula_id != null && isNaN(Number(p.formula_id))) return res.status(400).json({ error: 'formula_id inválido en líneas' });
  }

  try {
    await sql`BEGIN`;
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.estado === 'Completado' || pedido.estado === 'Cancelado') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: `No se pueden agregar líneas a un pedido con estado ${pedido.estado}` });
    }

    for (const p of productos) {
      // Comportamiento consistente con endpoint público: guardar snapshot preferiendo datos de la fórmula cuando exista.
      const productoId = Number(p.producto_id);
      const cantidad = Number(p.cantidad);

      if (isNaN(productoId) || isNaN(cantidad) || cantidad <= 0) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'Producto o cantidad inválidos en líneas' });
      }

      let precioUnitario = null;
      let costoUnitario = null;
      let nombreProducto = null;
      let formulaIdToSave = null;
      let formulaNombreToSave = null;

      if (p.formula_id != null) {
        // Preferir datos desde la fórmula si existe. No asumimos que la columna `producto_id` exista en todas las instalaciones,
        // por eso solicitamos solo precio/costo/nombre (como hace el endpoint público) y no validamos propiedad aquí.
        const fRow = await sql`SELECT precio_venta, costo, nombre FROM formulas WHERE id = ${Number(p.formula_id)} LIMIT 1`;
        if (fRow && fRow[0]) {
          precioUnitario = fRow[0].precio_venta != null ? fRow[0].precio_venta : null;
          costoUnitario = fRow[0].costo != null ? fRow[0].costo : null;
          nombreProducto = fRow[0].nombre != null ? fRow[0].nombre : null;
          formulaIdToSave = Number(p.formula_id);
          formulaNombreToSave = fRow[0].nombre != null ? fRow[0].nombre : null;
        }
      }

      // Si faltan datos, rellenar desde la tabla productos
      if (precioUnitario == null || costoUnitario == null || nombreProducto == null) {
        const prodRow = await sql`SELECT precio_venta, costo, nombre FROM productos WHERE id = ${productoId} LIMIT 1`;
        if (!prodRow || !prodRow[0]) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: `Producto no encontrado: ${productoId}` });
        }
        const prod = prodRow[0];
        precioUnitario = precioUnitario == null ? prod.precio_venta : precioUnitario;
        costoUnitario = costoUnitario == null ? prod.costo : costoUnitario;
        nombreProducto = nombreProducto == null ? prod.nombre : nombreProducto;
      }

      await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto, formula_id, formula_nombre, orden_produccion_id, produccion_creada) VALUES (${pedidoId}, ${productoId}, ${cantidad}, ${costoUnitario || null}, ${precioUnitario || null}, ${nombreProducto || null}, ${formulaIdToSave || null}, ${formulaNombreToSave || null}, ${null}, ${false})`;
    }

    await sql`COMMIT`;

    // devolver pedido actualizado (reutilizar lógica de GET /:id)
    const pedidoRowsAfter = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId}`;
    const productosDetalle = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id, pv.formula_nombre,
             COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
             COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
             COALESCE(pv.costo_unitario, prod.costo) AS costo, pv.orden_produccion_id, COALESCE(pv.produccion_creada, FALSE) AS produccion_creada, prod.image_url
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.pedido_venta_id = ${pedidoId}
    `;
    let total = 0;
    const productosMapeados = (productosDetalle || []).map((item) => {
      const cantidad = Number(item.cantidad);
      const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
      const costo = item.costo != null ? parseFloat(item.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      total += subtotal;
      return {
        id: item.id,
        pedido_venta_id: item.pedido_venta_id,
        producto_id: item.producto_id,
        formula_id: item.formula_id || null,
        formula_nombre: item.formula_nombre || null,
        orden_produccion_id: item.orden_produccion_id || null,
        produccion_creada: !!item.produccion_creada,
        cantidad,
        producto_nombre: item.producto_nombre,
        precio_venta: isNaN(precio) ? null : precio,
        costo: costo,
        image_url: item.image_url,
        subtotal,
      };
    });
    const pedidoObj = { ...(pedidoRowsAfter && pedidoRowsAfter[0] ? pedidoRowsAfter[0] : {}), productos: productosMapeados, total };
    await attachAjustesToPedidos([pedidoObj]);
    return res.status(201).json(pedidoObj);
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) { }
    console.error('Error agregando items al pedido:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:id/ajustes', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });

  let ajustesSanitizados;
  try {
    const raw = req.body && Object.prototype.hasOwnProperty.call(req.body, 'ajustes')
      ? req.body.ajustes
      : req.body;
    ajustesSanitizados = normalizeAjustesInput(raw);
  } catch (err) {
    if (err && err.code === 'INVALID_AJUSTES') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error normalizando ajustes:', err);
    return res.status(500).json({ error: 'Error procesando ajustes' });
  }

  try {
    await ensurePedidoAjustesTable();
    await sql`BEGIN`;
    try {
      const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
      if (!pedidoRows || pedidoRows.length === 0) {
        await sql`ROLLBACK`;
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const pedido = pedidoRows[0];
      if (pedido.estado && String(pedido.estado).toLowerCase() === 'completado') {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'No se pueden modificar ajustes de un pedido completado' });
      }

      const lineas = await sql`
        SELECT cantidad, precio_venta
        FROM pedido_venta_productos
        WHERE pedido_venta_id = ${pedidoId}
      `;
      let baseTotal = 0;
      for (const linea of lineas || []) {
        const cantidad = Number(linea.cantidad);
        const precio = Number(linea.precio_venta);
        if (Number.isFinite(cantidad) && Number.isFinite(precio)) {
          baseTotal += cantidad * precio;
        }
      }
      baseTotal = roundCurrency(baseTotal);

      const preview = computeAjustesBreakdown(baseTotal, ajustesSanitizados);
      if (preview.total_descuentos > preview.total_base) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'Los descuentos superan el total del pedido' });
      }

      await sql`DELETE FROM pedido_venta_ajustes WHERE pedido_venta_id = ${pedidoId}`;
      for (const adj of ajustesSanitizados) {
        await sql`
          INSERT INTO pedido_venta_ajustes (pedido_venta_id, tipo, modo, valor, motivo)
          VALUES (${pedidoId}, ${adj.tipo}, ${adj.modo}, ${adj.valor}, ${adj.motivo})
        `;
      }

      await sql`COMMIT`;

      const resumen = [{ id: pedidoId, total: baseTotal, total_base: baseTotal }];
      await attachAjustesToPedidos(resumen);
      const enriched = resumen[0];

      return res.json({
        ok: true,
        pedido_id: pedidoId,
        ajustes: enriched.ajustes,
        total_base: enriched.total_base,
        total_descuentos: enriched.total_descuentos,
        total_recargos: enriched.total_recargos,
        total_final: enriched.total_final,
      });
    } catch (errTx) {
      try { await sql`ROLLBACK`; } catch (e) { }
      if (errTx && errTx.code === 'INVALID_AJUSTES') {
        return res.status(400).json({ error: errTx.message });
      }
      throw errTx;
    }
  } catch (err) {
    if (err && err.code === 'INVALID_AJUSTES') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error actualizando ajustes del pedido:', err);
    return res.status(500).json({ error: 'Error actualizando ajustes del pedido' });
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
  const body = req.body || {};
  const { estado } = body;
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
        const pago = body && body.pago ? body.pago : null;
        const pagoError = validarPagoObj(pago);
        if (pagoError) return res.status(400).json({ error: pagoError });
        const hasAjustes = Object.prototype.hasOwnProperty.call(body, 'ajustes');
        const options = {};
        if (pago) options.pago = pago;
        if (hasAjustes) options.ajustes = body.ajustes;
        const optionsProvided = Object.keys(options).length > 0;
        const result = optionsProvided
          ? await completarPedidoTransaccional(pedidoId, options)
          : await completarPedidoTransaccional(pedidoId);
        return res.json(result);
      } catch (err) {
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
        if (err.code === 'ALREADY_COMPLETED') return res.status(400).json({ error: err.message });
        if (err.code === 'INSUFFICIENT_RESERVED' || err.code === 'INSUFFICIENT_STOCK')
          return res.status(400).json({ error: err.message });
        if (err.code === 'NOT_PRODUCED') return res.status(400).json({ error: err.message });
        if (err.code === 'INVENTORY_CONFLICT') return res.status(409).json({ error: err.message });
        if (err.code === 'INVALID_AJUSTES') return res.status(400).json({ error: err.message });
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
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${linea.producto_id
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
    // Antes de marcar como Cancelado, verificar si hay órdenes de producción asociadas
    // y devolver inventario por las órdenes completadas (producto terminado + componentes)
    const ordenIdsRows = await sql`
      SELECT DISTINCT pv.orden_produccion_id AS orden_id
      FROM pedido_venta_productos pv
      WHERE pv.pedido_venta_id = ${pedidoId} AND pv.orden_produccion_id IS NOT NULL
    `;
    const produccionRevertida = [];
    for (const or of ordenIdsRows) {
      const oid = or.orden_id;
      if (!oid) continue;
      // Bloquear la orden para consistencia
      const ordenRows = await sql`SELECT * FROM ordenes_produccion WHERE id = ${oid} FOR UPDATE`;
      if (!ordenRows || ordenRows.length === 0) continue;
      const orden = ordenRows[0];
      // Solo revertir si la orden está completada (se produjo el material)
      if (orden.estado !== 'Completada') continue;
      const producedQty = Number(orden.cantidad) || 0;
      if (producedQty <= 0) continue;

      // Determinar almacén destino para devolver (preferir tipo 'interno', si no usar primer almacén)
      let almacenRow = await sql`SELECT id FROM almacenes WHERE tipo = 'interno' LIMIT 1`;
      let almacenId = almacenRow && almacenRow[0] ? almacenRow[0].id : null;
      if (!almacenId) {
        const anyA = await sql`SELECT id FROM almacenes LIMIT 1`;
        almacenId = anyA && anyA[0] ? anyA[0].id : null;
      }

      // Devolver producto terminado al inventario
      if (orden.producto_terminado_id && almacenId) {
        const invRows = await sql`SELECT * FROM inventario WHERE producto_id = ${orden.producto_terminado_id} AND almacen_id = ${almacenId} FOR UPDATE`;
        if (invRows && invRows.length > 0) {
          await sql`UPDATE inventario SET stock_fisico = stock_fisico + ${producedQty} WHERE id = ${invRows[0].id}`;
        } else {
          try {
            await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${orden.producto_terminado_id}, ${almacenId}, ${producedQty}, 0)`;
          } catch (e) { }
        }
        await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${orden.producto_terminado_id}, ${almacenId}, 'entrada', ${producedQty}, ${'Cancelación pedido ' + pedidoId + ' - devolución producción orden ' + oid})`;
      }

      // Devolver componentes usados según la fórmula asociada
      if (orden.formula_id) {
        const comps = await sql`SELECT materia_prima_id, cantidad FROM formula_componentes WHERE formula_id = ${orden.formula_id}`;
        for (const c of comps) {
          const compId = c.materia_prima_id;
          const perUnit = Number(c.cantidad) || 0;
          const totalToReturn = perUnit * producedQty;
          if (totalToReturn <= 0) continue;
          // Preferir almacén tipo 'interno' para componentes también
          let compAlmRow = await sql`SELECT id FROM almacenes WHERE tipo = 'interno' LIMIT 1`;
          let compAlmId = compAlmRow && compAlmRow[0] ? compAlmRow[0].id : almacenId;
          if (!compAlmId) continue;
          const invCompRows = await sql`SELECT * FROM inventario WHERE producto_id = ${compId} AND almacen_id = ${compAlmId} FOR UPDATE`;
          if (invCompRows && invCompRows.length > 0) {
            await sql`UPDATE inventario SET stock_fisico = stock_fisico + ${totalToReturn} WHERE id = ${invCompRows[0].id}`;
          } else {
            try {
              await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${compId}, ${compAlmId}, ${totalToReturn}, 0)`;
            } catch (e) { }
          }
          await sql`INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) VALUES (${compId}, ${compAlmId}, 'entrada', ${totalToReturn}, ${'Cancelación pedido ' + pedidoId + ' - devolución componentes orden ' + oid})`;
        }
      }

      produccionRevertida.push({ orden_id: oid, cantidad: producedQty });
    }

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
    } catch (e) { }
    console.error('Error cancelando pedido:', err);
    return res.status(500).json({ error: 'Error cancelando pedido', detail: err.message });
  }
});

// export router al final del archivo (se mueve más abajo)

// Crear orden de producción asociada a una línea de pedido
// POST /api/pedidos-venta/:pedidoId/lineas/:lineaId/ordenes-produccion
router.post('/:pedidoId/lineas/:lineaId/ordenes-produccion', async (req, res) => {
  const pedidoId = Number(req.params.pedidoId);
  const lineaId = Number(req.params.lineaId);
  if (isNaN(pedidoId) || isNaN(lineaId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await sql`BEGIN`;
    // Bloquear pedido y línea
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const lineaRows = await sql`SELECT * FROM pedido_venta_productos WHERE id = ${lineaId} AND pedido_venta_id = ${pedidoId} FOR UPDATE`;
    if (!lineaRows || lineaRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Línea de pedido no encontrada' });
    }
    const linea = lineaRows[0];
    if (!linea.formula_id) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'La línea no tiene formula_id asociada' });
    }

    // Crear orden de producción usando la fórmula y la cantidad de la línea
    const cantidad = Number(req.body.cantidad != null ? req.body.cantidad : linea.cantidad);
    if (isNaN(cantidad) || cantidad <= 0) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'Cantidad inválida para la orden' });
    }

    // Insertar orden con pedido_venta_id para permitir filtrado eficiente
    const ordenInserted = await sql`
      INSERT INTO ordenes_produccion (producto_terminado_id, cantidad, formula_id, estado, fecha, pedido_venta_id)
      VALUES (${linea.producto_id}, ${cantidad}, ${linea.formula_id}, ${'Pendiente'}, NOW(), ${pedidoId}) RETURNING *
    `;
    const orden = ordenInserted && ordenInserted[0] ? ordenInserted[0] : null;
    if (!orden) {
      await sql`ROLLBACK`;
      return res.status(500).json({ error: 'No se pudo crear la orden de producción' });
    }

    // Actualizar la línea del pedido para vincular la orden y marcar produccion_creada
    await sql`
      UPDATE pedido_venta_productos SET orden_produccion_id = ${orden.id}, produccion_creada = TRUE WHERE id = ${lineaId}
    `;

    await sql`COMMIT`;
    return res.status(201).json({ ok: true, orden });
  } catch (err) {
    try {
      await sql`ROLLBACK`;
    } catch (e) { }
    console.error('Error creando orden desde pedido:', err && err.message ? err.message : err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pedidos-venta/:pedidoId/lineas/:lineaId -> eliminar línea si no tiene orden de producción
router.delete('/:pedidoId/lineas/:lineaId', async (req, res) => {
  const pedidoId = Number(req.params.pedidoId);
  const lineaId = Number(req.params.lineaId);
  if (isNaN(pedidoId) || isNaN(lineaId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await sql`BEGIN`;
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.estado === 'Completado' || pedido.estado === 'Cancelado') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: `No se pueden eliminar líneas de un pedido con estado ${pedido.estado}` });
    }

    const lineaRows = await sql`SELECT * FROM pedido_venta_productos WHERE id = ${lineaId} AND pedido_venta_id = ${pedidoId} FOR UPDATE`;
    if (!lineaRows || lineaRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Línea no encontrada' });
    }
    const linea = lineaRows[0];

    // No permitir eliminación si ya se creó una orden de producción para la línea
    if (linea.orden_produccion_id != null || linea.produccion_creada) {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'No se puede eliminar la línea: ya existe una orden de producción asociada' });
    }

    // Eliminar la línea
    await sql`DELETE FROM pedido_venta_productos WHERE id = ${lineaId}`;
    await sql`COMMIT`;

    // Devolver pedido actualizado (reusar consulta de detalle)
    const pedidoRowsAfter = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId}`;
    const productosDetalle = await sql`
      SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id, pv.formula_nombre,
             COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
             COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
             COALESCE(pv.costo_unitario, prod.costo) AS costo, pv.orden_produccion_id, COALESCE(pv.produccion_creada, FALSE) AS produccion_creada, prod.image_url
      FROM pedido_venta_productos pv
      LEFT JOIN productos prod ON prod.id = pv.producto_id
      WHERE pv.pedido_venta_id = ${pedidoId}
    `;
    let total = 0;
    const productosMapeados = (productosDetalle || []).map((item) => {
      const cantidad = Number(item.cantidad);
      const precio = item.precio_venta != null ? parseFloat(item.precio_venta) : 0;
      const costo = item.costo != null ? parseFloat(item.costo) : null;
      const subtotal = cantidad * (isNaN(precio) ? 0 : precio);
      total += subtotal;
      return {
        id: item.id,
        pedido_venta_id: item.pedido_venta_id,
        producto_id: item.producto_id,
        formula_id: item.formula_id || null,
        formula_nombre: item.formula_nombre || null,
        orden_produccion_id: item.orden_produccion_id || null,
        produccion_creada: !!item.produccion_creada,
        cantidad,
        producto_nombre: item.producto_nombre,
        precio_venta: isNaN(precio) ? null : precio,
        costo: costo,
        image_url: item.image_url,
        subtotal,
      };
    });
    const pedidoObj = { ...(pedidoRowsAfter && pedidoRowsAfter[0] ? pedidoRowsAfter[0] : {}), productos: productosMapeados, total };
    return res.json(pedidoObj);
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) { }
    console.error('Error eliminando línea del pedido:', err);
    return res.status(500).json({ error: 'Error eliminando línea' });
  }
});

// POST /api/pedidos-venta/:id/completar-todo-atomico
// Endpoint atómico que completa TODAS las órdenes de producción pendientes de un pedido
// y luego finaliza el pedido (con pago opcional) en una sola transacción
// Body: { almacen_venta_id: number, pago?: {...} }
router.post('/:id/completar-todo-atomico', async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (isNaN(pedidoId)) return res.status(400).json({ error: 'ID inválido' });

  const body = req.body || {};
  const { almacen_venta_id, pago } = body;
  const ajustesProvided = Object.prototype.hasOwnProperty.call(body, 'ajustes');
  const ajustesPayload = ajustesProvided ? body.ajustes : undefined;
  if (!almacen_venta_id || isNaN(Number(almacen_venta_id))) {
    return res.status(400).json({ error: 'almacen_venta_id requerido' });
  }

  const pagoError = validarPagoObj(pago);
  if (pagoError) return res.status(400).json({ error: pagoError });

  try {
    await sql`BEGIN`;

    // 1. Verificar que el pedido existe y bloquearlo
    const pedidoRows = await sql`SELECT * FROM pedidos_venta WHERE id = ${pedidoId} FOR UPDATE`;
    if (!pedidoRows || pedidoRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const pedido = pedidoRows[0];
    if (pedido.estado === 'Completado') {
      await sql`ROLLBACK`;
      return res.status(400).json({ error: 'Pedido ya está completado' });
    }

    // 2. Obtener todas las órdenes de producción pendientes para este pedido
    const ordenesPendientes = await sql`
      SELECT * FROM ordenes_produccion 
      WHERE pedido_venta_id = ${pedidoId} AND estado = 'Pendiente'
      ORDER BY id ASC
      FOR UPDATE
    `;

    const ordenesCompletadas = [];
    const errorMessages = [];

    // 3. Completar cada orden de producción
    for (const orden of ordenesPendientes) {
      try {
        // Verificar almacén destino
        const dest = await sql`SELECT * FROM almacenes WHERE id = ${almacen_venta_id} FOR NO KEY UPDATE`;
        if (!dest || dest.length === 0) {
          throw new Error(`Almacén destino ${almacen_venta_id} no encontrado`);
        }
        if (dest[0].es_materia_prima === true) {
          throw new Error('El almacén destino no puede ser marcado como materia prima');
        }

        // Obtener componentes de la fórmula
        const componentes = await sql`SELECT * FROM formula_componentes WHERE formula_id = ${orden.formula_id}`;
        if (!componentes || componentes.length === 0) {
          throw new Error(`Fórmula ${orden.formula_id} sin componentes`);
        }

        const qty = Number(orden.cantidad);
        const inventoryUpdates = [];

        // Preparar movimientos de inventario
        for (const comp of componentes) {
          let required = Number(comp.cantidad) * qty;

          const mpInventarios = await sql`
            SELECT i.* FROM inventario i
            JOIN almacenes a ON a.id = i.almacen_id
            WHERE i.producto_id = ${comp.materia_prima_id} AND a.es_materia_prima = true
            ORDER BY (i.stock_fisico - i.stock_comprometido) DESC
            FOR UPDATE
          `;

          let totalAvailable = 0;
          for (const inv of mpInventarios) {
            totalAvailable += Number(inv.stock_fisico) - Number(inv.stock_comprometido);
          }

          if (totalAvailable < required) {
            throw new Error(`Materia prima ${comp.materia_prima_id} insuficiente (necesita ${required}, disponible ${totalAvailable})`);
          }

          for (const inv of mpInventarios) {
            if (required <= 0) break;
            const available = Number(inv.stock_fisico) - Number(inv.stock_comprometido);
            if (available <= 0) continue;
            const take = Math.min(available, required);

            inventoryUpdates.push({
              inv_id: inv.id,
              take: take,
              materia_prima_id: comp.materia_prima_id,
              almacen_id: inv.almacen_id
            });

            required -= take;
          }
        }

        // Ejecutar updates de inventario (dentro de la transacción ya abierta)
        // Aunque son queries individuales, al estar en una transacción son muy rápidas
        // y no sufren overhead de red
        if (inventoryUpdates.length > 0) {
          for (const update of inventoryUpdates) {
            const consumed = await sql`
              UPDATE inventario
              SET 
                stock_fisico = stock_fisico - ${update.take},
                stock_comprometido = GREATEST(0, stock_comprometido - ${update.take})
              WHERE id = ${update.inv_id} AND stock_fisico - ${update.take} >= 0
              RETURNING id
            `;

            if (!consumed || consumed.length === 0) {
              throw new Error(`Inventario insuficiente para materia prima ${update.materia_prima_id} en orden ${orden.id}`);
            }
          }

          // Insertar movimientos de inventario
          for (const update of inventoryUpdates) {
            await sql`
              INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo)
              VALUES (${update.materia_prima_id}, ${update.almacen_id}, 'salida', ${update.take}, ${'Producción orden ' + orden.id})
            `;
          }
        }

        // Incrementar inventario del producto terminado
        const prodId = orden.producto_terminado_id;
        const existing = await sql`
          SELECT * FROM inventario 
          WHERE producto_id = ${prodId} AND almacen_id = ${almacen_venta_id} 
          FOR UPDATE
        `;

        if (existing && existing.length > 0) {
          await sql`
            UPDATE inventario 
            SET stock_fisico = stock_fisico + ${qty} 
            WHERE id = ${existing[0].id}
          `;
        } else {
          await sql`
            INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) 
            VALUES (${prodId}, ${almacen_venta_id}, ${qty}, 0)
          `;
        }

        await sql`
          INSERT INTO inventario_movimientos (producto_id, almacen_id, tipo, cantidad, motivo) 
          VALUES (${prodId}, ${almacen_venta_id}, 'entrada', ${qty}, ${'Producción orden ' + orden.id})
        `;

        // Marcar orden como completada
        await sql`UPDATE ordenes_produccion SET estado = 'Completada' WHERE id = ${orden.id}`;

        ordenesCompletadas.push(orden.id);

      } catch (ordenErr) {
        errorMessages.push(`Orden ${orden.id}: ${ordenErr.message}`);
        // No lanzar error aquí, continuar con la siguiente orden
      }
    }

    // Si hubo errores en alguna orden, hacer rollback
    if (errorMessages.length > 0) {
      await sql`ROLLBACK`;
      return res.status(400).json({
        error: 'Error completando órdenes de producción',
        details: errorMessages
      });
    }

    // 4. Completar el pedido usando la función transaccional existente
    // Primero hacer COMMIT de las órdenes
    await sql`COMMIT`;

    // Luego completar el pedido (inicia su propia transacción)
    try {
      const options = {};
      if (pago) options.pago = pago;
      if (ajustesProvided) options.ajustes = ajustesPayload;
      const optionsProvided = Object.keys(options).length > 0;
      const result = optionsProvided
        ? await completarPedidoTransaccional(pedidoId, options)
        : await completarPedidoTransaccional(pedidoId);
      return res.json({
        success: true,
        pedido_id: pedidoId,
        ordenes_completadas: ordenesCompletadas,
        mensaje: `Pedido completado exitosamente. ${ordenesCompletadas.length} órdenes de producción completadas.`,
        result
      });
    } catch (completarErr) {
      // Si falla al completar el pedido, devolver error
      if (completarErr && completarErr.code === 'INVALID_AJUSTES') {
        return res.status(400).json({
          error: completarErr.message,
          ordenes_completadas: ordenesCompletadas
        });
      }
      return res.status(500).json({
        error: 'Órdenes completadas pero error al finalizar pedido',
        details: completarErr.message,
        ordenes_completadas: ordenesCompletadas
      });
    }

  } catch (err) {
    try {
      await sql`ROLLBACK`;
    } catch (e) { }
    console.error('Error en completar-todo-atomico:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
