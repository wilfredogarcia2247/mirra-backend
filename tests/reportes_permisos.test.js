const mockSql = jest.fn();
mockSql.query = jest.fn();
jest.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));
jest.mock('../services/usuarioModulos', () => ({ asegurarUsuarioModulos: jest.fn(async () => {}) }));
jest.mock('../services/descuentoMayor', () => ({
  asegurarEsquemaDescuentoMayor: jest.fn(async () => {}),
  recalcularDescuentoMayor: jest.fn(),
  cambiarDescuentoMayorPedido: jest.fn(),
}));
jest.mock('../services/dailySalesClose', () => ({ buildDailySalesClose: jest.fn(() => ({})) }));
jest.mock('../services/deliveryReport', () => ({ buildDeliveryReport: jest.fn(() => ({})) }));

const express = require('express');
const request = require('supertest');
const { PERMISOS_REPORTES_RESUMEN } = require('../services/reportesResumen');
const router = require('../routes/pedidosVenta');

const app = express();
app.use((req, res, next) => {
  req.user = { id: 1, rol: req.get('x-rol') || 'user' };
  next();
}, router);

let permisos;
const filas = [
  {
    id: 10, estado: 'Completado', fecha: '2026-11-01', producto_id: 8,
    nombre_producto: 'Perfume', formula_nombre: '30 ml', cantidad: 2,
    precio_venta: 10, descuento_cupon: 2, descuento_mayor: 0, tiene_pago: true,
  },
  {
    id: 11, estado: 'Completado', fecha: '2026-11-02', producto_id: 9,
    nombre_producto: 'Regalo', formula_nombre: '10 ml', cantidad: 1,
    precio_venta: 5, descuento_cupon: 0, descuento_mayor: 0, tiene_pago: false,
  },
];

beforeEach(() => {
  permisos = {};
  mockSql.mockReset();
  mockSql.mockImplementation(async (strings) => {
    const consulta = strings.join('?');
    if (consulta.includes('SELECT * FROM usuario_modulos')) return [permisos];
    if (consulta.includes('FROM pedidos_venta pv') && consulta.includes('pvp.formula_nombre')) return filas;
    return [];
  });
});

describe('permisos de reportes', () => {
  test.each([
    ['/cierre-diario?fecha=2026-11-01', 'rep_cierre_diario'],
    ['/reportes-entregas', 'rep_entregas'],
  ])('%s exige su permiso y permite al administrador', async (url, permiso) => {
    expect((await request(app).get(url)).status).toBe(403);
    permisos[`perm_${permiso}`] = true;
    expect((await request(app).get(url)).status).toBe(200);
    permisos = {};
    expect((await request(app).get(url).set('x-rol', 'admin')).status).toBe(200);
  });

  test.each(Array.from(PERMISOS_REPORTES_RESUMEN))('%s exige su propio permiso', async (reporte, permiso) => {
    const url = `/reportes-resumen?reporte=${reporte}`;
    permisos.perm_rep_entregas = true;
    expect((await request(app).get(url)).status).toBe(403);
    permisos[`perm_${permiso}`] = true;
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).not.toHaveProperty('nombre_cliente');
    expect(response.body[0]).not.toHaveProperty('telefono');
    expect(response.body[0]).not.toHaveProperty('id');
  });

  test('rechaza reportes ausentes o desconocidos incluso para admin', async () => {
    expect((await request(app).get('/reportes-resumen').set('x-rol', 'admin')).status).toBe(400);
    expect((await request(app).get('/reportes-resumen?reporte=__proto__')).status).toBe(400);
  });

  test('cada reporte recibe solo los campos que necesita, con descuentos y regalías', async () => {
    const estado = await request(app).get('/reportes-resumen?reporte=pedidos-estado').set('x-rol', 'admin');
    expect(estado.body).toEqual([
      { estado: 'Completado', regalia: false },
      { estado: 'Completado', regalia: true },
    ]);

    const ventas = await request(app).get('/reportes-resumen?reporte=ventas-periodo').set('x-rol', 'admin');
    expect(ventas.body[0]).toEqual({
      estado: 'Completado', regalia: false, fecha: '2026-11-01',
      productos: [{ subtotal: 18 }],
    });
    expect(ventas.body[1].total).toBe(5);

    const compras = await request(app).get('/reportes-resumen?reporte=compras').set('x-rol', 'admin');
    expect(compras.body[0].productos[0]).toEqual({
      producto_id: 8, nombre_producto: 'Perfume', formula_nombre: '30 ml', cantidad: 2,
    });
    expect(compras.body[1].total).toBe(5);

    const favoritos = await request(app).get('/reportes-resumen?reporte=productos-favoritos').set('x-rol', 'admin');
    expect(favoritos.body[0].productos[0].precio_venta).toBe(10);
    expect(favoritos.body[0].productos[0]).not.toHaveProperty('subtotal');

    const ticket = await request(app).get('/reportes-resumen?reporte=ticket-promedio').set('x-rol', 'admin');
    expect(ticket.body[0].productos).toEqual([{ subtotal: 18 }]);
    expect(ticket.body[0]).not.toHaveProperty('fecha');
  });

  test('los reportes de productos no revelan qué perfumes se compraron juntos', async () => {
    const { datosParaReporte } = require('../services/reportesResumen');
    const resultado = datosParaReporte([{
      estado: 'Completado', regalia: false, productos: [
        { producto_id: 1, nombre_producto: 'A', formula_nombre: '10 ml', cantidad: 1, precio_venta: 4 },
        { producto_id: 2, nombre_producto: 'B', formula_nombre: '30 ml', cantidad: 2, precio_venta: 8 },
      ],
    }], 'productos-favoritos');
    expect(resultado).toHaveLength(2);
    expect(resultado.every((pedido) => pedido.productos.length === 1)).toBe(true);
  });

  test('conserva el total descontado de pedidos con varios productos sin revelar sus líneas', async () => {
    mockSql.mockImplementation(async (strings) => {
      const consulta = strings.join('?');
      if (consulta.includes('FROM pedidos_venta pv') && consulta.includes('pvp.formula_nombre')) {
        return [
          filas[0],
          { ...filas[0], producto_id: 12, nombre_producto: 'Otro', cantidad: 1, precio_venta: 5 },
        ];
      }
      return [];
    });
    const response = await request(app).get('/reportes-resumen?reporte=ventas-periodo').set('x-rol', 'admin');
    expect(response.status).toBe(200);
    expect(response.body[0].productos).toEqual([{ subtotal: 23 }]);
  });
});
