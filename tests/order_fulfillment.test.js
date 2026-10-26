const { normalizeOrderFulfillment } = require('../services/orderFulfillment');

describe('order fulfillment details', () => {
  test('requires a valid selected branch for store pickup', () => {
    expect(normalizeOrderFulfillment({ tipo: 'tienda', sucursal_id: '3' }).value)
      .toEqual({ tipo: 'tienda', sucursal_id: 3 });
    expect(normalizeOrderFulfillment({ tipo: 'tienda', sucursal_id: 0 }).error)
      .toMatch(/sucursal/i);
  });

  test('requires a carrier and agency details for national shipping', () => {
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      transportista: 'MRW',
      agencia_codigo: '1234',
      agencia_direccion: 'Agencia Centro',
    }).value).toEqual({
      tipo: 'envio_nacional',
      transportista: 'MRW',
      agencia_codigo: '1234',
      agencia_direccion: 'Agencia Centro',
    });
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      transportista: 'ZOOM',
      agencia_codigo: '5678',
      agencia_direccion: 'Agencia Norte',
    }).value.transportista).toBe('ZOOM');
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      transportista: 'OTRA',
      transportista_otro: 'Domesa',
      agencia_direccion: 'Agencia Centro',
    }).value).toEqual({
      tipo: 'envio_nacional',
      transportista: 'OTRA',
      transportista_otro: 'Domesa',
      agencia_direccion: 'Agencia Centro',
    });
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      agencia_codigo: '1234',
      agencia_direccion: 'Agencia Centro',
    }).error).toMatch(/empresa de envío/i);
    expect(normalizeOrderFulfillment({ tipo: 'envio_nacional', transportista: 'FEDEX' }).error)
      .toMatch(/empresa de envío/i);
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      transportista: 'OTRA',
      agencia_direccion: 'Agencia Centro',
    }).error).toMatch(/nombre de la empresa/i);
    expect(normalizeOrderFulfillment({
      tipo: 'envio_nacional',
      transportista: 'OTRA',
      transportista_otro: 'Domesa',
      agencia_direccion: 'Agencia Centro',
    }).error).toBeUndefined();
    expect(normalizeOrderFulfillment({ tipo: 'envio_nacional', transportista: 'MRW' }).error)
      .toMatch(/código/i);
  });

  test('accepts a shared Google Maps link or valid current-location coordinates', () => {
    expect(normalizeOrderFulfillment({
      tipo: 'delivery',
      ubicacion_link: 'https://maps.app.goo.gl/example',
    }).value.ubicacion_link).toBe('https://maps.app.goo.gl/example');
    expect(normalizeOrderFulfillment({
      tipo: 'delivery',
      ubicacion_latitud: 10.5,
      ubicacion_longitud: -66.9,
    }).value).toEqual({
      tipo: 'delivery',
      ubicacion_latitud: 10.5,
      ubicacion_longitud: -66.9,
    });
    expect(normalizeOrderFulfillment({
      tipo: 'delivery',
      ubicacion_link: 'https://example.com/location',
    }).error).toMatch(/Google Maps/i);
    expect(normalizeOrderFulfillment({
      tipo: 'delivery',
      ubicacion_latitud: 91,
      ubicacion_longitud: 10,
    }).error).toMatch(/coordenadas/i);
  });
});
