// Validación de los costos por presentación (no usa la base de datos)
const { normalizarCostos } = require('../services/costosPresentacion');

describe('normalizarCostos', () => {
  test('acepta costos por tamaño y especiales; vacío = quitar', () => {
    const r = normalizarCostos({
      tamanos: [{ ml: 30, costo: '2,5' }, { ml: 60, costo: '' }],
      especiales: [{ ml: 100, producto_id: 56, costo: 7.456 }],
    });
    expect(r.error).toBeUndefined();
    expect(r.filas).toEqual([
      { ml: 30, producto_id: 0, costo: 2.5 },
      { ml: 60, producto_id: 0, costo: null },
      { ml: 100, producto_id: 56, costo: 7.46 },
    ]);
    expect(r.reemplazarEspeciales).toBe(true);
  });

  test('rechaza costos negativos, tamaños o perfumes inválidos', () => {
    expect(normalizarCostos({ tamanos: [{ ml: 30, costo: -1 }] }).error).toBeTruthy();
    expect(normalizarCostos({ tamanos: [{ ml: 0, costo: 2 }] }).error).toBeTruthy();
    expect(normalizarCostos({ especiales: [{ ml: 30, producto_id: 0, costo: 2 }] }).error).toBeTruthy();
    expect(normalizarCostos({ tamanos: 'x' }).error).toBeTruthy();
  });
});
