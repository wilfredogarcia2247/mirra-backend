const FULFILLMENT_TYPES = new Set(['tienda', 'envio_nacional', 'delivery']);

function normalizeOrderFulfillment(input) {
  if (!input || typeof input !== 'object') {
    return { error: 'Selecciona cómo deseas recibir tu pedido' };
  }

  const type = String(input.tipo || '').trim().toLowerCase();
  if (!FULFILLMENT_TYPES.has(type)) {
    return { error: 'Modalidad de entrega inválida' };
  }

  if (type === 'tienda') {
    const branchId = Number(input.sucursal_id);
    if (!Number.isInteger(branchId) || branchId < 1) {
      return { error: 'Selecciona una sucursal activa' };
    }
    return { value: { tipo: type, sucursal_id: branchId } };
  }

  if (type === 'envio_nacional') {
    const carrier = String(input.transportista || '').trim().toUpperCase();
    const otherCarrier = String(input.transportista_otro || '').trim();
    const agencyCode = String(input.agencia_codigo ?? input.agencia_mrw_codigo ?? '').trim();
    const agencyAddress = String(input.agencia_direccion ?? input.agencia_mrw_direccion ?? '').trim();
    if (!['MRW', 'ZOOM', 'OTRA'].includes(carrier)) return { error: 'Selecciona MRW, ZOOM u otra empresa de envío' };
    if (carrier === 'OTRA' && !otherCarrier) return { error: 'Indica el nombre de la empresa de envío' };
    if (otherCarrier.length > 100) return { error: 'El nombre de la empresa de envío es demasiado largo' };
    if (carrier !== 'OTRA' && !agencyCode) return { error: 'Indica el código de la agencia' };
    if (!agencyAddress) return { error: 'Indica la dirección de la agencia' };
    if (agencyCode.length > 100 || agencyAddress.length > 500) {
      return { error: 'El código o la dirección de la agencia son demasiado largos' };
    }
    return {
      value: {
        tipo: type,
        transportista: carrier,
        ...(carrier === 'OTRA' ? { transportista_otro: otherCarrier } : {}),
        ...(agencyCode ? { agencia_codigo: agencyCode } : {}),
        agencia_direccion: agencyAddress,
      },
    };
  }

  const locationLink = String(input.ubicacion_link || '').trim();
  const latitude = input.ubicacion_latitud == null || input.ubicacion_latitud === ''
    ? null
    : Number(input.ubicacion_latitud);
  const longitude = input.ubicacion_longitud == null || input.ubicacion_longitud === ''
    ? null
    : Number(input.ubicacion_longitud);
  const hasCoordinates = latitude !== null || longitude !== null;

  if (locationLink) {
    if (locationLink.length > 2048) return { error: 'El enlace de ubicación es demasiado largo' };
    let url;
    try {
      url = new URL(locationLink);
    } catch (error) {
      return { error: 'El enlace de ubicación no es válido' };
    }
    const hostname = url.hostname.toLowerCase();
    const isGoogleMapsUrl = url.protocol === 'https:' && (
      hostname === 'maps.app.goo.gl'
      || hostname === 'goo.gl'
      || (hostname === 'google.com' || hostname === 'www.google.com' || hostname === 'maps.google.com')
        && url.pathname.toLowerCase().includes('/maps')
    );
    if (!isGoogleMapsUrl) return { error: 'Usa un enlace compartido de Google Maps' };
  }

  if (hasCoordinates && (
    latitude === null || longitude === null
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  )) {
    return { error: 'Las coordenadas de ubicación no son válidas' };
  }
  if (!locationLink && !hasCoordinates) {
    return { error: 'Comparte tu ubicación actual o pega un enlace de Google Maps' };
  }

  return {
    value: {
      tipo: type,
      ...(locationLink ? { ubicacion_link: locationLink } : {}),
      ...(hasCoordinates ? { ubicacion_latitud: latitude, ubicacion_longitud: longitude } : {}),
    },
  };
}

module.exports = { normalizeOrderFulfillment };
