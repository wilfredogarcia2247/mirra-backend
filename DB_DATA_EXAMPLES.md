# Ejemplos de datos reales por tabla

Este archivo consolida ejemplos de registros reales para entender mejor como se usan las tablas en la app.

## almacenes

```json
[
  {
    "id": 4,
    "nombre": "Almacén de Venta",
    "tipo": "venta",
    "ubicacion": null,
    "responsable": null,
    "es_materia_prima": false
  },
  {
    "id": 2,
    "nombre": "Almacen Materia prima",
    "tipo": "interno",
    "ubicacion": "",
    "responsable": "",
    "es_materia_prima": true
  }
]
```

## banco_formas_pago

```json
[
  {
    "id": 33,
    "banco_id": 26,
    "forma_pago_id": 116,
    "detalles": {
      "banco": "BINANCE",
      "documento": "108668194",
      "numero_cuenta": "enderabreu7@gmail.com"
    },
    "creado_en": "2025-11-23 13:36:51.468849"
  },
  {
    "id": 38,
    "banco_id": 27,
    "forma_pago_id": 117,
    "detalles": {
      "banco": "CUENTAS POR COBRAR",
      "documento": "25297768",
      "numero_telefono": "04143617716"
    },
    "creado_en": "2025-11-25 16:29:51.747357"
  },
  {
    "id": 40,
    "banco_id": 22,
    "forma_pago_id": 117,
    "detalles": {
      "banco": "PROVINCIAL",
      "documento": "25297768",
      "numero_telefono": "04143617716"
    },
    "creado_en": "2025-12-24 00:45:08.408313"
  }
]
```

## bancos

```json
[
  { "id": 26, "nombre": "BINANCE", "moneda": "USD" },
  { "id": 27, "nombre": "CUENTAS POR COBRAR", "moneda": "BS" },
  { "id": 22, "nombre": "PROVINCIAL", "moneda": "BS" },
  { "id": 31, "nombre": "Banco Test Valid", "moneda": null }
]
```

## categorias

```json
[
  { "id": 2, "nombre": "Hombre", "descripcion": null, "creado_en": "2026-01-26 12:18:40.291773" },
  { "id": 3, "nombre": "Mujer", "descripcion": null, "creado_en": "2026-01-26 12:18:44.797029" },
  { "id": 4, "nombre": "Unisex", "descripcion": null, "creado_en": "2026-01-26 12:18:50.70552" }
]
```

## formas_pago

```json
[
  { "id": 113, "nombre": "Tarjeta" },
  { "id": 115, "nombre": "Efectivo" },
  { "id": 116, "nombre": "Transferencia" },
  { "id": 117, "nombre": "Pago movil" }
]
```

## formula_componentes

```json
[
  { "id": 1271, "formula_id": 206, "materia_prima_id": 249, "cantidad": "33", "unidad": "g" },
  { "id": 1272, "formula_id": 206, "materia_prima_id": 335, "cantidad": "0.65", "unidad": "g" },
  { "id": 1273, "formula_id": 206, "materia_prima_id": 334, "cantidad": "50", "unidad": "ml" }
]
```

## formulas

```json
[
  {
    "id": 398,
    "producto_terminado_id": 372,
    "nombre": "45. CH 212 NYC MEN Presentación 60ml",
    "costo": "0",
    "precio_venta": "9.8"
  },
  {
    "id": 405,
    "producto_terminado_id": 379,
    "nombre": "82. CRISTIAN DIOR SAUVAGE HM Presentación 60ml",
    "costo": "0",
    "precio_venta": "9.8"
  }
]
```

## inventario

```txt
# Formato inferido: id\tproducto_id\talmacen_id\tstock_fisico\tstock_comprometido
588	593	4	20.00	0
439	268	2	0.00	0
357	181	2	486.95	0
473	305	2	284.15	0
421	247	2	268.15	0
```

## movimientos_inventario

```json
[
  {
    "id": 1255,
    "producto_id": 263,
    "almacen_id": 2,
    "tipo": "salida",
    "cantidad": "10",
    "motivo": "Producción orden 323",
    "referencia": null,
    "creado_en": "2025-12-19 01:32:19.5174"
  },
  {
    "id": 10,
    "producto_id": 77,
    "almacen_id": 4,
    "tipo": "entrada",
    "cantidad": "1",
    "motivo": "Producción orden 128",
    "referencia": null,
    "creado_en": "2025-12-10 23:53:37.91044"
  }
]
```

## marcas

```json
[
  { "id": 2, "nombre": "Paris Hilton", "descripcion": null, "creado_en": "2026-01-26 15:47:29.168935" },
  { "id": 3, "nombre": "Carolina Herrera", "descripcion": null, "creado_en": "2026-01-26 15:48:19.388074" },
  { "id": 11, "nombre": "Yves Saint Laurent", "descripcion": null, "creado_en": "2026-01-26 16:00:26.249052" }
]
```

## ordenes_produccion

```json
[
  { "id": 128, "producto_terminado_id": 77, "cantidad": 1, "formula_id": 344, "estado": "Completada", "fecha": "2025-12-10 23:52:52.97854", "pedido_venta_id": null },
  { "id": 127, "producto_terminado_id": 458, "cantidad": 1, "formula_id": 740, "estado": "Completada", "fecha": "2025-12-10 22:57:11.831239", "pedido_venta_id": null }
]
```

## pagos

```json
[
  {
    "id": 11,
    "pedido_venta_id": 366,
    "forma_pago_id": 117,
    "banco_id": 22,
    "monto": "3286.84",
    "fecha": "2025-12-18 18:36:53.100975",
    "referencia": "126486789",
    "fecha_transaccion": "2025-12-18 18:30:12",
    "tasa": "338.85",
    "tasa_simbolo": "BS"
  },
  {
    "id": 20,
    "pedido_venta_id": 619,
    "forma_pago_id": 113,
    "banco_id": 22,
    "monto": "2295",
    "fecha": "2025-12-26 16:03:03.577782",
    "referencia": "404078",
    "fecha_transaccion": "2025-12-26 16:02:28",
    "tasa": "382.5",
    "tasa_simbolo": "BS"
  }
]
```

## pedido_venta_productos

```json
[
  {
    "id": 35,
    "pedido_venta_id": 25,
    "producto_id": 42,
    "cantidad": 1,
    "costo_unitario": "0",
    "precio_venta": "6",
    "nombre_producto": "177. PACO RABANNE OLYMPEA DM Presentación 30ml",
    "formula_id": 537,
    "formula_nombre": "177. PACO RABANNE OLYMPEA DM Presentación 30ml",
    "orden_produccion_id": 663,
    "produccion_creada": true
  },
  {
    "id": 48,
    "pedido_venta_id": 29,
    "producto_id": 47,
    "cantidad": 1,
    "costo_unitario": "0",
    "precio_venta": "16.6",
    "nombre_producto": "17. ARI BY ARIANA GRANDE DM Presentación 100ml",
    "formula_id": 110,
    "formula_nombre": "17. ARI BY ARIANA GRANDE DM Presentación 100ml",
    "orden_produccion_id": 706,
    "produccion_creada": true
  }
]
```

## pedidos_venta

```json
[
  {
    "id": 1263,
    "cliente_id": null,
    "nombre_cliente": "Mary mora tienda",
    "telefono": "04246871858",
    "cedula": "31199576",
    "estado": "Completado",
    "fecha": "2026-02-21 22:57:52.97361",
    "tasa_cambio_monto": "500"
  },
  {
    "id": 23,
    "cliente_id": null,
    "nombre_cliente": "Ender abreu",
    "telefono": "04143617716",
    "cedula": "25288888",
    "estado": "Cancelado",
    "fecha": "2025-11-23 14:51:32.794019",
    "tasa_cambio_monto": "243.11"
  }
]
```

## productos

```json
[
  {
    "id": 50,
    "nombre": "189. PARIS HILTON HEIRESS DM",
    "unidad": "unidad",
    "stock": 21,
    "costo": "0",
    "precio_venta": "0",
    "categoria_id": 3,
    "marca_id": 2
  },
  {
    "id": 47,
    "nombre": "17. ARI BY ARIANA GRANDE DM",
    "unidad": "unidad",
    "stock": 4,
    "costo": "0",
    "precio_venta": "0",
    "categoria_id": 3,
    "marca_id": 10
  }
]
```

## tasas_cambio

```json
[
  { "id": 12, "monto": "1", "simbolo": "USD", "descripcion": null, "activo": false },
  { "id": 13, "monto": "640", "simbolo": "VES", "descripcion": "Tasa de prueba", "activo": false },
  { "id": 11, "monto": "640", "simbolo": "BS", "descripcion": "Bolivares", "activo": true }
]
```

## usuario_modulos

```json
[
  {
    "id": 9,
    "usuario_id": 48,
    "dashboard": true,
    "tasas_cambio": true,
    "bancos": true,
    "marcas": true,
    "categorias": true,
    "almacenes": true,
    "productos": true,
    "formulas": true,
    "pedidos": true,
    "usuarios": true
  },
  {
    "id": 17,
    "usuario_id": 49,
    "dashboard": true,
    "tasas_cambio": true,
    "bancos": false,
    "marcas": true,
    "categorias": false,
    "almacenes": false,
    "productos": true,
    "formulas": true,
    "pedidos": true,
    "usuarios": false
  }
]
```

## usuarios

```json
[
  {
    "id": 3,
    "nombre": "Leonardo",
    "email": "urdaneta.leonardo92@gmail.com",
    "rol": "admin"
  },
  {
    "id": 49,
    "nombre": "Tienda",
    "email": "usuario@gmail.com",
    "rol": "user"
  },
  {
    "id": 54,
    "nombre": "PagoTester",
    "email": "pago.tester@example.com",
    "rol": "admin"
  }
]
```

## Notas rapidas

- Se observan montos y cantidades almacenadas como texto en varias tablas (`monto`, `cantidad`, `costo`, `precio_venta`).
- Hay nulos y cadenas vacias conviviendo para campos similares (`ubicacion`, `responsable`, `moneda`, `descripcion`).
- Los estados reales ya vistos incluyen al menos `Completado`, `Cancelado` y `Completada`.
- `banco_formas_pago.detalles` cambia por forma de pago (ej. `numero_cuenta` para transferencia y `numero_telefono` para pago movil).
