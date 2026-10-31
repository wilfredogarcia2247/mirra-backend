// Pruebas del descuento al mayor (sin base de datos)
const {
  CONFIG_POR_DEFECTO,
  mlDe,
  normalizarConfig,
  calcularDescuentoMayor,
  elegirDescuento,
} = require('../services/descuentoMayor');

const perfume = (ml, cantidad, precio) => ({ nombre: `LATTAFA ASAD Presentación ${ml}ml`, cantidad, precio });

describe('mlDe', () => {
  test('lee los mililitros con o sin espacio', () => {
    expect(mlDe('AFNAN 9PM Presentación 100 ml')).toBe(100);
    expect(mlDe('ARMAF Presentacion 30ml')).toBe(30);
    expect(mlDe('Producto sin tamaño')).toBeNull();
  });
});

describe('calcularDescuentoMayor', () => {
  test('con 3 perfumes no hay descuento y faltan 1 para el 10 %', () => {
    const r = calcularDescuentoMayor([perfume(50, 3, 10)], CONFIG_POR_DEFECTO);
    expect(r).toMatchObject({ unidades: 3, porcentaje: 0, descuento: 0 });
    expect(r.siguiente).toEqual({ desde: 4, porcentaje: 10, faltan: 1 });
  });

  test('desde 4 perfumes da 10 % solo sobre los perfumes grandes (los de 7 ml no cuentan)', () => {
    const r = calcularDescuentoMayor([perfume(50, 2, 10), perfume(100, 2, 16.6), perfume(7, 5, 2)], CONFIG_POR_DEFECTO);
    expect(r.unidades).toBe(4);
    expect(r.base).toBe(53.2);
    expect(r.porcentaje).toBe(10);
    expect(r.descuento).toBe(5.32);
    expect(r.siguiente).toEqual({ desde: 24, porcentaje: 15, faltan: 20 });
  });

  test('23 perfumes siguen en 10 % y 24 pasan a 15 %', () => {
    expect(calcularDescuentoMayor([perfume(30, 23, 5.4)], CONFIG_POR_DEFECTO).porcentaje).toBe(10);
    const r = calcularDescuentoMayor([perfume(30, 24, 5.4)], CONFIG_POR_DEFECTO);
    expect(r.porcentaje).toBe(15);
    expect(r.descuento).toBe(19.44);
    expect(r.siguiente).toBeNull();
  });

  test('60 ml cuenta con la configuración por defecto; un tamaño fuera de la lista no', () => {
    expect(calcularDescuentoMayor([perfume(60, 4, 9.7)], CONFIG_POR_DEFECTO).porcentaje).toBe(10);
    const sin60 = { ...CONFIG_POR_DEFECTO, tamanos_ml: [30, 50, 100] };
    expect(calcularDescuentoMayor([perfume(60, 4, 9.7)], sin60).unidades).toBe(0);
  });

  test('apagado no descuenta', () => {
    const r = calcularDescuentoMayor([perfume(50, 10, 10)], { ...CONFIG_POR_DEFECTO, activo: false });
    expect(r).toMatchObject({ unidades: 10, porcentaje: 0, descuento: 0, siguiente: null });
  });
});

describe('elegirDescuento', () => {
  test('se aplica solo el mayor; en empate gana el cupón', () => {
    expect(elegirDescuento(5, 8)).toBe('mayor');
    expect(elegirDescuento(8, 5)).toBe('cupon');
    expect(elegirDescuento(5, 5)).toBe('cupon');
    expect(elegirDescuento(0, 0)).toBeNull();
    expect(elegirDescuento(0, 3)).toBe('mayor');
  });
});

describe('descuentoParaPedido (pedido ya hecho)', () => {
  const { descuentoParaPedido } = require('../services/descuentoMayor');
  const reglasDelPedido = { activo: true, niveles: [{ desde: 4, porcentaje: 10 }, { desde: 24, porcentaje: 15 }], tamanos_ml: [30, 50, 100] };
  const reglasNuevas = { activo: true, niveles: [{ desde: 4, porcentaje: 12 }, { desde: 24, porcentaje: 18 }], tamanos_ml: [30, 50, 100] };

  test('usa las reglas guardadas en el pedido aunque las del panel cambien', () => {
    const pedido = { descuento_mayor_porcentaje: 10, descuento_mayor_reglas: reglasDelPedido };
    expect(descuentoParaPedido(pedido, [perfume(50, 5, 10)], reglasNuevas).porcentaje).toBe(10);
  });

  test('si el pedido llega a 24 perfumes pasa al 15 % que tenía al hacerse, no al nuevo', () => {
    const pedido = { descuento_mayor_porcentaje: 10, descuento_mayor_reglas: reglasDelPedido };
    expect(descuentoParaPedido(pedido, [perfume(50, 24, 10)], reglasNuevas).porcentaje).toBe(15);
  });

  test('apagar el descuento en el panel no se lo quita a un pedido ya hecho', () => {
    const pedido = { descuento_mayor_porcentaje: 10, descuento_mayor_reglas: reglasDelPedido };
    const r = descuentoParaPedido(pedido, [perfume(50, 5, 10)], { ...reglasNuevas, activo: false });
    expect(r).toMatchObject({ porcentaje: 10, descuento: 5 });
  });
});

describe('normalizarConfig', () => {
  test('ordena niveles y tamaños', () => {
    const r = normalizarConfig({ activo: true, niveles: [{ desde: 24, porcentaje: 15 }, { desde: 4, porcentaje: 10 }], tamanos_ml: [100, 30, 50, 30] });
    expect(r.config).toEqual({ activo: true, niveles: [{ desde: 4, porcentaje: 10 }, { desde: 24, porcentaje: 15 }], tamanos_ml: [30, 50, 100] });
  });

  test('rechaza datos inválidos', () => {
    expect(normalizarConfig({ activo: true, niveles: [], tamanos_ml: [30] }).error).toBeTruthy();
    expect(normalizarConfig({ activo: true, niveles: [{ desde: 4, porcentaje: 95 }], tamanos_ml: [30] }).error).toBeTruthy();
    expect(normalizarConfig({ activo: true, niveles: [{ desde: 4, porcentaje: 15 }, { desde: 24, porcentaje: 10 }], tamanos_ml: [30] }).error).toBeTruthy();
    expect(normalizarConfig({ activo: true, niveles: [{ desde: 4, porcentaje: 10 }], tamanos_ml: [] }).error).toBeTruthy();
    expect(normalizarConfig({ niveles: [{ desde: 4, porcentaje: 10 }], tamanos_ml: [30] }).error).toBeTruthy();
    // 7 ml nunca puede entrar en el descuento al mayor
    expect(normalizarConfig({ activo: true, niveles: [{ desde: 4, porcentaje: 10 }], tamanos_ml: [7, 30] }).error).toBeTruthy();
  });
});
