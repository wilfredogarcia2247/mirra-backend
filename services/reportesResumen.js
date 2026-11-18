const PERMISOS_REPORTES_RESUMEN = new Map([
  ['ventas-periodo', 'rep_ventas_periodo'],
  ['productos-favoritos', 'rep_productos_favoritos'],
  ['pedidos-estado', 'rep_pedidos_estado'],
  ['compras', 'rep_compras'],
  ['ticket-promedio', 'rep_ticket_promedio'],
]);
const { ESTADOS_COMPLETADOS } = require('./clientesFrecuentes');

function datosParaReporte(pedidos, reporte) {
  if (!PERMISOS_REPORTES_RESUMEN.has(reporte)) {
    throw new Error('Reporte de resumen inválido');
  }
  return pedidos.flatMap((pedido) => {
    const base = { estado: pedido.estado, regalia: pedido.regalia };
    if (reporte === 'pedidos-estado') return [base];
    if (!ESTADOS_COMPLETADOS.includes(String(pedido.estado || '').toLowerCase())) return [];

    if (reporte === 'ventas-periodo') base.fecha = pedido.fecha;
    if (pedido.regalia) {
      base.total = pedido.total;
      base.productos = [{ cantidad: pedido.productos.reduce((sum, item) => sum + item.cantidad, 0) }];
      return [base];
    }
    if (reporte === 'ventas-periodo' || reporte === 'ticket-promedio') {
      base.productos = [{ subtotal: pedido.productos.reduce((sum, item) => sum + item.subtotal, 0) }];
      return [base];
    }
    return pedido.productos.map((item) => {
      const producto = {
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        nombre_producto: item.nombre_producto,
        formula_nombre: item.formula_nombre,
      };
      if (reporte === 'productos-favoritos') producto.precio_venta = item.precio_venta;
      return { ...base, productos: [producto] };
    });
  });
}

module.exports = { PERMISOS_REPORTES_RESUMEN, datosParaReporte };
