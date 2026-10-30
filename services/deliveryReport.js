// Reporte de métodos de entrega y de dónde nos compran (estado / ciudad).
// Recibe una fila por pedido: { tipo_entrega, datos_entrega, total } y devuelve los totales agrupados.

const METODOS = {
  tienda: 'Retiro en tienda',
  envio_nacional: 'Envío nacional',
  delivery: 'Delivery',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Agrupa contando pedidos y sumando montos, ordenado de mayor a menor cantidad de pedidos
function agrupar(filas, clave) {
  const mapa = new Map();
  for (const fila of filas) {
    const k = clave(fila);
    if (!k) continue;
    const actual = mapa.get(k.id) || { ...k, pedidos: 0, monto: 0 };
    actual.pedidos += 1;
    actual.monto += Number(fila.total) || 0;
    mapa.set(k.id, actual);
  }
  return Array.from(mapa.values())
    .map(({ id, ...resto }) => ({ ...resto, monto: round2(resto.monto) }))
    .sort((a, b) => b.pedidos - a.pedidos || b.monto - a.monto);
}

function datosDe(fila) {
  const d = fila?.datos_entrega;
  if (d && typeof d === 'object') return d;
  if (typeof d === 'string') {
    try { return JSON.parse(d) || {}; } catch { return {}; }
  }
  return {};
}

function buildDeliveryReport(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const totalPedidos = lista.length;
  const totalMonto = lista.reduce((s, f) => s + (Number(f.total) || 0), 0);

  const metodos = agrupar(lista, (f) => {
    const tipo = String(f.tipo_entrega || '').trim();
    return tipo
      ? { id: tipo, tipo, metodo: METODOS[tipo] || tipo }
      : { id: 'sin_dato', tipo: 'sin_dato', metodo: 'Sin dato (pedidos antiguos)' };
  }).map((m) => ({
    ...m,
    porcentaje: totalPedidos ? round2((m.pedidos / totalPedidos) * 100) : 0,
  }));

  const nacionales = lista.filter((f) => f.tipo_entrega === 'envio_nacional');
  const conDestino = nacionales.filter((f) => String(datosDe(f).estado || '').trim());

  const empresas = agrupar(nacionales, (f) => {
    const d = datosDe(f);
    const nombre = d.transportista === 'OTRA' ? (d.transportista_otro || 'Otra') : (d.transportista || 'Sin dato');
    return { id: String(nombre).toUpperCase(), empresa: nombre };
  });

  const sucursales = agrupar(lista.filter((f) => f.tipo_entrega === 'tienda'), (f) => {
    const nombre = datosDe(f).sucursal_nombre || 'Sin dato';
    return { id: nombre, sucursal: nombre };
  });

  const estados = agrupar(conDestino, (f) => {
    const estado = String(datosDe(f).estado).trim();
    return { id: estado.toLowerCase(), estado };
  });

  const ciudades = agrupar(conDestino, (f) => {
    const d = datosDe(f);
    const estado = String(d.estado).trim();
    const ciudad = String(d.ciudad || '').trim() || 'Sin ciudad';
    return { id: `${ciudad.toLowerCase()}|${estado.toLowerCase()}`, ciudad, estado };
  });

  return {
    total_pedidos: totalPedidos,
    total_monto: round2(totalMonto),
    metodos,
    empresas_envio: empresas,
    sucursales,
    estados,
    ciudades,
    envios_nacionales: nacionales.length,
    envios_sin_destino: nacionales.length - conDestino.length,
  };
}

module.exports = { buildDeliveryReport, METODOS };
