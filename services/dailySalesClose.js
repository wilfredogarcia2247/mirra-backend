function roundCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function getPresentation(name) {
  const match = String(name || '').match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (!match) return 'Sin presentación';
  const milliliters = Number(match[1].replace(',', '.'));
  return Number.isFinite(milliliters) ? `${milliliters}ml` : 'Sin presentación';
}

function buildDailySalesClose(rows, adjustmentsByOrder, date) {
  const ordersById = new Map();
  const presentations = new Map();

  for (const row of rows || []) {
    const id = Number(row.pedido_id);
    if (!ordersById.has(id)) {
      ordersById.set(id, {
        id,
        fecha: row.fecha,
        cliente: row.nombre_cliente || 'Cliente sin nombre',
        tasa: Number(row.tasa_cambio_monto) > 0 ? Number(row.tasa_cambio_monto) : null,
        descuentoCupon: roundCurrency(row.descuento_cupon),
        descuentoMayor: roundCurrency(row.descuento_mayor),
        descuentoMayorPorcentaje: Number(row.descuento_mayor_porcentaje) > 0 ? Number(row.descuento_mayor_porcentaje) : null,
        cuponCodigo: row.cupon_codigo || null,
        subtotal: 0,
        ajustes: [],
      });
    }

    const quantity = Number(row.cantidad || 0);
    const price = Number(row.precio_venta || 0);
    const order = ordersById.get(id);
    order.subtotal += quantity * price;

    if (row.producto_id != null) {
      const presentation = getPresentation(row.presentacion_nombre);
      presentations.set(presentation, (presentations.get(presentation) || 0) + quantity);
    }
  }

  const orders = Array.from(ordersById.values()).map((order) => {
    order.subtotal = roundCurrency(order.subtotal);
    order.ajustes = (adjustmentsByOrder.get(order.id) || []).map((adjustment) => {
      const amount = adjustment.modo === 'porcentaje'
        ? roundCurrency(order.subtotal * (Number(adjustment.valor) / 100))
        : roundCurrency(adjustment.valor);
      return {
        id: adjustment.id,
        tipo: adjustment.tipo,
        modo: adjustment.modo,
        valor: Number(adjustment.valor),
        motivo: adjustment.motivo,
        monto_usd: amount,
        monto_bs: order.tasa == null ? null : roundCurrency(amount * order.tasa),
      };
    });

    const descuentosAjustes = roundCurrency(order.ajustes
      .filter((adjustment) => adjustment.tipo === 'descuento')
      .reduce((sum, adjustment) => sum + adjustment.monto_usd, 0));
    const recargos = roundCurrency(order.ajustes
      .filter((adjustment) => adjustment.tipo === 'recargo')
      .reduce((sum, adjustment) => sum + adjustment.monto_usd, 0));
    const descuentos = roundCurrency(descuentosAjustes + order.descuentoCupon + order.descuentoMayor);
    const total = Math.max(0, roundCurrency(order.subtotal - descuentos + recargos));

    return {
      id: order.id,
      fecha: order.fecha,
      cliente: order.cliente,
      cupon_codigo: order.cuponCodigo,
      tasa_cambio: order.tasa,
      subtotal_usd: order.subtotal,
      descuento_cupon_usd: order.descuentoCupon,
      descuento_mayor_usd: order.descuentoMayor,
      descuento_mayor_porcentaje: order.descuentoMayorPorcentaje,
      descuentos_ajustes_usd: descuentosAjustes,
      descuentos_usd: descuentos,
      recargos_usd: recargos,
      total_usd: total,
      subtotal_bs: order.tasa == null ? null : roundCurrency(order.subtotal * order.tasa),
      descuento_cupon_bs: order.tasa == null ? null : roundCurrency(order.descuentoCupon * order.tasa),
      descuento_mayor_bs: order.tasa == null ? null : roundCurrency(order.descuentoMayor * order.tasa),
      descuentos_ajustes_bs: order.tasa == null ? null : roundCurrency(descuentosAjustes * order.tasa),
      descuentos_bs: order.tasa == null ? null : roundCurrency(descuentos * order.tasa),
      recargos_bs: order.tasa == null ? null : roundCurrency(recargos * order.tasa),
      total_bs: order.tasa == null ? null : roundCurrency(total * order.tasa),
      ajustes: order.ajustes,
    };
  }).sort((a, b) => Number(a.id) - Number(b.id));

  const hasMissingRates = orders.some((order) => order.tasa_cambio == null);
  const sumOrders = (key) => roundCurrency(orders.reduce((sum, order) => sum + order[key], 0));
  const sumBolivares = (key) => hasMissingRates
    ? null
    : roundCurrency(orders.reduce((sum, order) => sum + order[key], 0));

  return {
    fecha: date,
    cantidad_pedidos: orders.length,
    pedidos_sin_tasa: orders.filter((order) => order.tasa_cambio == null).length,
    resumen: {
      subtotal_usd: sumOrders('subtotal_usd'),
      descuento_cupon_usd: sumOrders('descuento_cupon_usd'),
      descuento_mayor_usd: sumOrders('descuento_mayor_usd'),
      descuentos_ajustes_usd: sumOrders('descuentos_ajustes_usd'),
      descuentos_usd: sumOrders('descuentos_usd'),
      recargos_usd: sumOrders('recargos_usd'),
      total_usd: sumOrders('total_usd'),
      subtotal_bs: sumBolivares('subtotal_bs'),
      descuento_cupon_bs: sumBolivares('descuento_cupon_bs'),
      descuento_mayor_bs: sumBolivares('descuento_mayor_bs'),
      descuentos_ajustes_bs: sumBolivares('descuentos_ajustes_bs'),
      descuentos_bs: sumBolivares('descuentos_bs'),
      recargos_bs: sumBolivares('recargos_bs'),
      total_bs: sumBolivares('total_bs'),
    },
    presentaciones: Array.from(presentations, ([presentacion, unidades]) => ({
      presentacion,
      unidades: roundCurrency(unidades),
    })).sort((a, b) => {
      if (a.presentacion === 'Sin presentación') return 1;
      if (b.presentacion === 'Sin presentación') return -1;
      return Number.parseFloat(a.presentacion) - Number.parseFloat(b.presentacion);
    }),
    pedidos: orders,
  };
}

module.exports = { buildDailySalesClose, getPresentation, roundCurrency };
