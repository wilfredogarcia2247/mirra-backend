const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { sendTextMessage, formatOrderNotificationMessage } = require('../services/waha');
const { resolveClienteFromBody } = require('./clientes');
const { getAgotadoProductIds } = require('../services/productosAgotados');
const {
  normalizeCodigo,
  validarCupon,
  calcularDescuento,
  registrarUsoCupon,
} = require('../services/cupones');
const {
  calculateCommission,
  calculateCommissionableBase,
} = require('../services/influencerCommissions');
const { normalizeOrderFulfillment } = require('../services/orderFulfillment');
const { ensureSucursalesTable, sql: branchSql } = require('../services/sucursales');

function formatOrderWhatsappNotificationPayload(pedido) {
  return {
    id: pedido.id,
    nombre_cliente: pedido.nombre_cliente,
    telefono: pedido.telefono,
    total: pedido.total,
    tasa_cambio_monto: pedido.tasa_cambio_monto,
    cupon_codigo: pedido.cupon_codigo,
    descuento_cupon: pedido.descuento_cupon,
    items: Array.isArray(pedido.productos)
      ? pedido.productos.map((p) => ({
        name: p.producto_nombre,
        quantity: Number(p.cantidad || 0),
        unitPrice: p.precio_venta,
        subtotal: p.subtotal,
      }))
      : [],
  };
}

async function notifyOrderCreatedByWhatsapp(pedido) {
  try {
    const order = formatOrderWhatsappNotificationPayload(pedido);
    const to = order.telefono;
    if (!to) return;
    const message = formatOrderNotificationMessage(order);
    await sendTextMessage({
      to,
      text: message,
      meta: { type: 'order-notification', orderId: pedido?.id || null },
    });
  } catch (error) {
    console.warn('[whatsapp] Error enviando alerta de nuevo pedido:', error.message);
  }
}

function validarPedido(body) {
  // Para pedidos públicos `cliente_id` es opcional (puede venir null/0).
  if (body.cliente_id != null && body.cliente_id !== '' && isNaN(Number(body.cliente_id)))
    return 'ID de cliente inválido';
  if (body.entrega != null) {
    if (!String(body.nombre_cliente || '').trim()) return 'nombre_cliente requerido';
    if (!String(body.telefono || '').trim()) return 'telefono requerido';
    if (!String(body.cedula || '').trim()) return 'cedula requerida';
    if (!/^\d{11,}$/.test(String(body.telefono).trim())) {
      return 'teléfono debe contener al menos 11 dígitos numéricos';
    }
  }
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
  // El cupón es opcional; si viene debe ser un código no vacío
  if (body.cupon_codigo != null && body.cupon_codigo !== '' && !normalizeCodigo(body.cupon_codigo))
    return 'cupon_codigo inválido';
  if (body.entrega != null) {
    const fulfillment = normalizeOrderFulfillment(body.entrega);
    if (fulfillment.error) return fulfillment.error;
  }
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
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS nombre_producto TEXT;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS formula_id INT;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS formula_nombre TEXT;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS orden_produccion_id INT;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedido_venta_productos ADD COLUMN IF NOT EXISTS produccion_creada BOOLEAN DEFAULT FALSE;`;
    } catch (e) { }
    // Columnas de cupón en pedidos_venta (por si la migración no se ejecutó en este entorno)
    try {
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS cupon_id INTEGER;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS cupon_codigo TEXT;`;
    } catch (e) { }
    try {
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_cupon NUMERIC(12, 2) NOT NULL DEFAULT 0;`;
    } catch (e) { }
    await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS tipo_entrega TEXT;`;
    await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS datos_entrega JSONB NOT NULL DEFAULT '{}'::jsonb;`;
    // Note: no legacy tamano columns required here.
    const { cliente_id, estado, nombre_cliente, telefono, cedula, tasa_cambio_monto } = req.body;
    // Compatibilidad: aceptar `productos` o `lineas`
    const productos = Array.isArray(req.body.productos)
      ? req.body.productos
      : Array.isArray(req.body.lineas)
        ? req.body.lineas
        : [];
    const fulfillmentInput = req.body.entrega == null ? null : normalizeOrderFulfillment(req.body.entrega).value;
    let fulfillmentDetails = fulfillmentInput;
    if (fulfillmentInput?.tipo === 'tienda') {
      await ensureSucursalesTable();
      const branchRows = await branchSql`
        SELECT id, nombre, direccion
        FROM sucursales
        WHERE id = ${fulfillmentInput.sucursal_id} AND activa = TRUE
        LIMIT 1
      `;
      if (!branchRows.length) {
        return res.status(400).json({ error: 'La sucursal elegida ya no está disponible' });
      }
      fulfillmentDetails = {
        ...fulfillmentInput,
        sucursal_nombre: branchRows[0].nombre,
        sucursal_direccion: branchRows[0].direccion,
      };
    }

    // Validar el cupón en el servidor: el cliente nunca decide el monto del descuento
    const cuponCodigo = normalizeCodigo(req.body.cupon_codigo);
    let cuponAplicado = null;
    if (cuponCodigo) {
      const resultadoCupon = await validarCupon(cuponCodigo);
      if (!resultadoCupon.ok) {
        // 400: el cupón viene en el cuerpo de la petición y no se pudo aplicar
        return res.status(400).json({ error: resultadoCupon.error, cupon_invalido: true });
      }
      cuponAplicado = resultadoCupon.cupon;
    }

    // No se aceptan productos agotados (sin esencia suficiente), aunque estén en el carrito
    const agotados = await getAgotadoProductIds(productos.map((p) => p.producto_id));
    if (agotados.size > 0) {
      const nombres = await sql`SELECT nombre FROM productos WHERE id = ANY(${Array.from(agotados)})`;
      return res.status(400).json({
        error: `Producto agotado por el momento: ${(nombres || []).map((n) => n.nombre).join(', ')}. Quítalo del carrito para continuar.`,
        productos_agotados: Array.from(agotados),
      });
    }

    const resolvedCliente = await resolveClienteFromBody(req.body);
    const clienteIdValue =
      resolvedCliente && resolvedCliente.cliente_id != null ? Number(resolvedCliente.cliente_id) : null;
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
        INSERT INTO pedidos_venta (cliente_id, nombre_cliente, telefono, cedula, estado, fecha, origen_ip, user_agent, tasa_cambio_monto, tipo_entrega, datos_entrega)
        VALUES (
          ${clienteIdValue},
          ${resolvedCliente?.nombre_cliente || nombre_cliente || null},
          ${resolvedCliente?.telefono || telefono || null},
          ${resolvedCliente?.cedula || cedula || null},
          ${forcedEstado},
          CURRENT_TIMESTAMP AT TIME ZONE 'America/Caracas',
          ${origenIp || null},
          ${userAgent || null},
          ${tasaMontoVal},
          ${fulfillmentDetails?.tipo || null},
          ${JSON.stringify(fulfillmentDetails || {})}::jsonb
        ) RETURNING *
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
        await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto, formula_id, formula_nombre, orden_produccion_id, produccion_creada) VALUES (${pedido[0].id}, ${p.producto_id}, ${p.cantidad}, ${costoUnitario}, ${precioUnitario}, ${nombreProducto}, ${formulaIdToSave}, ${formulaNombreToSave}, ${null}, ${false})`;
      }

      // Calcular el total bruto de las líneas ya guardadas (mismo criterio que el detalle final)
      const totalRow = await sql`
        SELECT COALESCE(SUM(pv.cantidad * COALESCE(pv.precio_venta, prod.precio_venta, 0)), 0) AS total
        FROM pedido_venta_productos pv
        LEFT JOIN productos prod ON prod.id = pv.producto_id
        WHERE pv.pedido_venta_id = ${pedido[0].id}
      `;
      const totalBase = totalRow && totalRow[0] ? Number(totalRow[0].total) || 0 : 0;

      // Aplicar el cupón: descuento calculado en el servidor y registrado en el canje
      let descuentoCupon = 0;
      if (cuponAplicado) {
        descuentoCupon = calcularDescuento(totalBase, cuponAplicado.descuento_porcentaje);
        const esInfluencer = cuponAplicado.colaborador_tipo === 'influencer';
        const baseComisionable = esInfluencer
          ? calculateCommissionableBase(Math.max(0, totalBase - descuentoCupon), 0)
          : 0;
        const porcentajeComision = esInfluencer ? cuponAplicado.porcentaje_comision : 0;
        const comisionMonto = calculateCommission(baseComisionable, porcentajeComision);
        const uso = await registrarUsoCupon(
          cuponAplicado,
          pedido[0].id,
          descuentoCupon,
          clienteIdValue,
          {
            base_comisionable: baseComisionable,
            porcentaje_comision: porcentajeComision,
            comision_monto: comisionMonto,
          }
        );
        if (!uso.ok) {
          await sql`ROLLBACK`;
          return res.status(400).json({ error: uso.error, cupon_invalido: true });
        }
        await sql`
          UPDATE pedidos_venta
          SET cupon_id = ${cuponAplicado.id},
              cupon_codigo = ${cuponAplicado.codigo},
              descuento_cupon = ${descuentoCupon}
          WHERE id = ${pedido[0].id}
        `;
      }
      await sql`COMMIT`;

      const productosDetalle = await sql`
        SELECT pv.id, pv.pedido_venta_id, pv.producto_id, pv.cantidad, pv.formula_id, pv.formula_nombre,
               COALESCE(pv.nombre_producto, prod.nombre) AS producto_nombre,
               COALESCE(pv.precio_venta, prod.precio_venta) AS precio_venta,
               COALESCE(pv.costo_unitario, prod.costo) AS costo,
               pv.orden_produccion_id,
               COALESCE(pv.produccion_creada, FALSE) AS produccion_creada,
               prod.image_url,
               (COALESCE(op.produced_total,0) >= pv.cantidad) AS produccion_completada
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
      // El total devuelto es el neto: ya incluye el descuento del cupón aplicado
      const totalFinal = Math.max(0, Number((total - descuentoCupon).toFixed(2)));
      // No incluir componentes en la respuesta pública: el front usará `formula_id` para crear la orden de producción
      const pedidoObj = {
        ...pedido[0],
        productos: productosMapeados,
        total: totalFinal,
        total_base: Number(total.toFixed(2)),
        descuento_cupon: Number(descuentoCupon.toFixed(2)),
        cupon_id: cuponAplicado ? cuponAplicado.id : (pedido[0].cupon_id ?? null),
        cupon_codigo: cuponAplicado ? cuponAplicado.codigo : (pedido[0].cupon_codigo ?? null),
        cupon_descuento_porcentaje: cuponAplicado ? cuponAplicado.descuento_porcentaje : null,
        // Compatibilidad cliente: antiguamente se devolvía `produccionesCreadas`.
        // Aquí no creamos producciones al momento de crear el pedido, así que devolvemos arreglo vacío.
        produccionesCreadas: [],
        producciones: [],
      };

      notifyOrderCreatedByWhatsapp(pedidoObj);
      res.status(201).json(pedidoObj);
    } catch (errTx) {
      try {
        await sql`ROLLBACK`;
      } catch (e) { }
      throw errTx;
    }
  } catch (err) {
    console.error('Error creating public pedido:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
