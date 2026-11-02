// Corrección del método de entrega de un pedido desde el panel (personal).
// Es más flexible que el checkout de la tienda: solo valida formato y largo, porque sirve para corregir errores.
// No toca montos: el cobro de delivery o envío es un recargo aparte.

const TIPOS = new Set(['tienda', 'envio_nacional', 'delivery']);
const TRANSPORTISTAS = new Set(['MRW', 'ZOOM', 'OTRA']);

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);

// Devuelve { value } con los datos limpios, o { error } con un mensaje para el personal.
// Para "tienda" devuelve sucursal_id; el nombre y la dirección los completa la ruta desde la tabla de sucursales.
function normalizarEntregaAdmin(input) {
  if (!input || typeof input !== 'object') return { error: 'Faltan los datos de entrega' };
  const tipo = String(input.tipo || '').trim().toLowerCase();
  if (!TIPOS.has(tipo)) return { error: 'Elige retiro en tienda, envío nacional o delivery' };

  if (tipo === 'tienda') {
    const sucursalId = Number(input.sucursal_id);
    if (!Number.isInteger(sucursalId) || sucursalId < 1) return { error: 'Elige la sucursal' };
    return { value: { tipo, sucursal_id: sucursalId } };
  }

  if (tipo === 'envio_nacional') {
    const estado = texto(input.estado, 100);
    const ciudad = texto(input.ciudad, 100);
    const transportista = String(input.transportista || '').trim().toUpperCase();
    const otro = texto(input.transportista_otro, 100);
    const codigo = texto(input.agencia_codigo, 100);
    const direccion = texto(input.agencia_direccion, 500);
    if (!estado) return { error: 'Indica el estado de destino' };
    if (!ciudad) return { error: 'Indica la ciudad de destino' };
    if (estado.length > 100 || ciudad.length > 100) return { error: 'El estado o la ciudad son demasiado largos' };
    if (!TRANSPORTISTAS.has(transportista)) return { error: 'Elige MRW, ZOOM u otra empresa de envío' };
    if (transportista === 'OTRA' && !otro) return { error: 'Indica el nombre de la empresa de envío' };
    if (otro.length > 100 || codigo.length > 100) return { error: 'El nombre de la empresa o el código de agencia son demasiado largos' };
    if (direccion.length > 500) return { error: 'La dirección de la agencia es demasiado larga' };
    return {
      value: {
        tipo,
        estado,
        ciudad,
        transportista,
        ...(transportista === 'OTRA' ? { transportista_otro: otro } : {}),
        ...(codigo ? { agencia_codigo: codigo } : {}),
        ...(direccion ? { agencia_direccion: direccion } : {}),
      },
    };
  }

  // Delivery: enlace de ubicación opcional (el personal puede no tenerlo)
  const enlace = String(input.ubicacion_link || '').trim();
  if (enlace) {
    if (enlace.length > 2048) return { error: 'El enlace de ubicación es demasiado largo' };
    let url;
    try { url = new URL(enlace); } catch { return { error: 'El enlace de ubicación no es válido' }; }
    if (url.protocol !== 'https:') return { error: 'El enlace de ubicación debe empezar con https://' };
  }
  return { value: { tipo, ...(enlace ? { ubicacion_link: enlace } : {}) } };
}

module.exports = { normalizarEntregaAdmin };
