function amountOrZero(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateCommissionableBase(orderTotal, surcharges) {
  const totalWithoutSurcharges = Math.max(0, amountOrZero(orderTotal) - amountOrZero(surcharges));
  return roundCurrency(totalWithoutSurcharges / 1.16);
}

function calculateCommission(base, percentage) {
  const commissionBase = Math.max(0, amountOrZero(base));
  const rate = Number(percentage);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 0;
  return roundCurrency(commissionBase * (rate / 100));
}

function isOrderPaid(status, totalUsd, payments, orderExchangeRate) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!['completado', 'pagado'].includes(normalizedStatus)) return false;
  const total = amountOrZero(totalUsd);
  if (total <= 0) return false;

  const paidUsd = (payments || []).reduce((sum, payment) => {
    const equivalence = Number(payment?.equivalencia ?? payment?.equivalente);
    if (Number.isFinite(equivalence)) return sum + equivalence;
    const amount = amountOrZero(payment?.monto ?? payment?.amount);
    const rate = amountOrZero(payment?.tasa ?? payment?.tasa_monto ?? payment?.tasa_cambio_monto ?? orderExchangeRate);
    return sum + (rate > 0 ? amount / rate : amount);
  }, 0);
  return paidUsd >= total - 0.05;
}

function maskPersonalNumber(value, visibleDigits = 2) {
  const text = String(value || '').trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!digits) return '*'.repeat(text.length);
  const maskedDigits = `${'*'.repeat(Math.max(0, digits.length - visibleDigits))}${digits.slice(-visibleDigits)}`;
  let digitIndex = 0;
  return text.replace(/\d/g, () => maskedDigits[digitIndex++]);
}

function summarizeCouponHistory(coupons, orders, now = new Date()) {
  const metrics = new Map();
  for (const order of orders || []) {
    const id = Number(order.cupon_id);
    if (!metrics.has(id)) metrics.set(id, { pedidos: 0, pedidos_cancelados: 0, base_comisionable: 0, comision_estimada: 0 });
    const summary = metrics.get(id);
    summary.pedidos += 1;
    if (order.cancelado) {
      summary.pedidos_cancelados += 1;
    } else {
      summary.base_comisionable += amountOrZero(order.base_comisionable);
      summary.comision_estimada += amountOrZero(order.comision_monto);
    }
  }

  const nowMs = now.getTime();
  return (coupons || []).map((coupon) => {
    const id = Number(coupon.id);
    const maxUses = coupon.uso_maximo == null ? null : Number(coupon.uso_maximo);
    const currentUses = Number(coupon.uso_actual || 0);
    const startDate = coupon.fecha_inicio ? new Date(coupon.fecha_inicio).getTime() : null;
    const endDate = coupon.fecha_fin ? new Date(coupon.fecha_fin).getTime() : null;
    let estado = 'activo';
    if (maxUses !== null && currentUses >= maxUses) estado = 'agotado';
    else if (!(coupon.activo === true || Number(coupon.activo) === 1)) estado = 'inactivo';
    else if (startDate !== null && startDate > nowMs) estado = 'programado';
    else if (endDate !== null && endDate < nowMs) estado = 'vencido';

    const summary = metrics.get(id) || { pedidos: 0, pedidos_cancelados: 0, base_comisionable: 0, comision_estimada: 0 };
    return {
      ...coupon,
      estado,
      codigo_activo: estado === 'activo',
      pedidos: summary.pedidos,
      pedidos_cancelados: summary.pedidos_cancelados,
      base_comisionable: roundCurrency(summary.base_comisionable),
      comision_estimada: roundCurrency(summary.comision_estimada),
    };
  });
}

module.exports = {
  calculateCommissionableBase,
  calculateCommission,
  isOrderPaid,
  maskPersonalNumber,
  summarizeCouponHistory,
};