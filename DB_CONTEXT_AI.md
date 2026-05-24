# Contexto de Base de Datos (para IA)

Este archivo resume la estructura actual de la base de datos que compartiste.
La idea es que una IA pueda entender rapido:

- Que tablas existen
- Como se relacionan
- Que campos son clave
- Que reglas/indices importantes hay

Cuando compartas ejemplos de registros por tabla, se debe completar la seccion `Ejemplos de datos reales` para mejorar el entendimiento semantico.

## 1) Vision general del dominio

La base parece cubrir estas areas:

- Catalogo: `productos`, `categorias`, `ingredientes`
- Produccion/formulacion: `formulas`, `formula_componentes`, `ordenes_produccion`, `precio_productos`
- Inventario y almacenaje: `almacenes`, `inventario`
- Ventas: `pedidos_venta`, `pedido_venta_productos`, `pagos`
- Finanzas/configuracion comercial: `formas_pago`, `banco_formas_pago`, `tasas_cambio`
- Usuarios y permisos: `usuarios`, `usuario_modulos`

## 2) Tablas y campos

### `banco_formas_pago`
- PK: `id`
- Campos: `banco_id`, `forma_pago_id`, `detalles (jsonb)`, `creado_en`
- Uso: relacion entre banco y forma de pago, con metadata flexible en `detalles`.

### `almacenes`
- PK: `id`
- Campos: `nombre`, `tipo`, `ubicacion`, `responsable`, `es_materia_prima`
- Uso: ubicaciones fisicas/logicas de inventario.

### `categorias`
- PK: `id`
- Unique: `nombre`
- Campos: `nombre`, `descripcion`, `creado_en`

### `formas_pago`
- PK: `id`
- Campos: `nombre`

### `formulas`
- PK: `id`
- Campos: `producto_terminado_id`, `nombre`, `costo`, `precio_venta`
- Uso: receta/base de fabricacion para producto terminado.

### `formula_componentes`
- PK: `id`
- Index: `formula_id`
- Campos: `formula_id`, `materia_prima_id`, `cantidad`, `unidad`
- Uso: detalle de componentes por formula.

### `ingredientes`
- PK: `id (bigint)`
- Unique: `codigo`
- Campos: `codigo`, `nombre`, `unidad`, `costo`, `creado_en`
- Uso: materias primas/insumos.

### `inventario`
- PK: `id`
- Indexes:
  - `(producto_id, almacen_id)`
  - `(producto_id, almacen_id, stock_fisico, stock_comprometido)`
- Campos: `producto_id`, `almacen_id`, `stock_fisico`, `stock_comprometido`
- Uso: stock por producto y almacen.

### `ordenes_produccion`
- PK: `id`
- Index: `pedido_venta_id`
- Campos: `producto_terminado_id`, `cantidad`, `formula_id`, `estado`, `fecha`, `pedido_venta_id`
- Uso: produccion asociada potencialmente a una linea o pedido de venta.

### `pagos`
- PK: `id`
- Campos:
  - `pedido_venta_id`, `forma_pago_id`, `banco_id`
  - `monto`, `fecha`, `referencia`
  - `fecha_transaccion`, `tasa`, `tasa_simbolo`
- Uso: registro de pagos de pedidos.

### `productos`
- PK: `id`
- Campos:
  - `nombre`, `unidad`, `stock`, `costo`, `precio_venta`
  - `proveedor_id`, `image_url`, `categoria_id`, `marca_id`, `margen`
- Uso: catalogo principal de productos.

### `pedidos_venta`
- PK: `id`
- Campos:
  - `cliente_id`, `nombre_cliente`, `telefono`, `cedula`
  - `estado`, `fecha`
  - `origen_ip`, `user_agent`
  - `tasa_cambio_monto`
- Uso: encabezado de pedido de venta.

### `pedido_venta_productos`
- PK: `id`
- Index: `pedido_venta_id`
- Campos:
  - `pedido_venta_id`, `producto_id`, `cantidad`
  - `costo_unitario`, `precio_venta`, `nombre_producto`
  - `tamano_id`, `tamano_nombre`
  - `formula_id`, `formula_nombre`
  - `orden_produccion_id`, `produccion_creada`
- Uso: lineas/detalle por pedido.

### `precio_productos`
- PK: `id (bigint)`
- Unique: `sku`
- Unique compuesto: `(producto_id, formula_id)`
- Campos:
  - `producto_id`, `formula_id`, `sku`
  - `costo_formula`, `costo_total_fabricacion`
  - `margen_aplicado`, `precio_venta_base`
  - `factor_formula`, `precio_venta_final`
  - `actualizado_en`
- Uso: tabla derivada de pricing por producto + formula.

### `tasas_cambio`
- PK: `id`
- Campos: `monto`, `simbolo`, `descripcion`, `creado_en`, `actualizado_en`, `activo`
- Regla importante: indice unico sobre `activo`.
- Nota: con un indice unico sobre boolean, solo puede existir un `true` y (segun implementacion/valores nulos) normalmente un unico `false` no nulo.

### `usuarios`
- PK: `id`
- Unique: `email`
- Campos: `nombre`, `email`, `password`, `rol`

### `usuario_modulos`
- PK: `id`
- Unique: `usuario_id`
- Campos de permisos booleanos:
  - `dashboard`, `tasas_cambio`, `bancos`, `marcas`, `categorias`, `almacenes`, `productos`, `formulas`, `pedidos`, `usuarios`
  - `created_at`, `updated_at`
- Uso: permisos por modulo para cada usuario.

## 3) Relaciones inferidas (sin FK declaradas en el SQL compartido)

Estas relaciones se infieren por nombres de columnas:

- `productos.categoria_id -> categorias.id`
- `inventario.producto_id -> productos.id`
- `inventario.almacen_id -> almacenes.id`
- `formulas.producto_terminado_id -> productos.id`
- `formula_componentes.formula_id -> formulas.id`
- `formula_componentes.materia_prima_id -> ingredientes.id` (o tabla equivalente de materia prima)
- `pedido_venta_productos.pedido_venta_id -> pedidos_venta.id`
- `pedido_venta_productos.producto_id -> productos.id`
- `pedido_venta_productos.formula_id -> formulas.id`
- `pedido_venta_productos.orden_produccion_id -> ordenes_produccion.id`
- `ordenes_produccion.pedido_venta_id -> pedidos_venta.id`
- `ordenes_produccion.formula_id -> formulas.id`
- `pagos.pedido_venta_id -> pedidos_venta.id`
- `pagos.forma_pago_id -> formas_pago.id`
- `banco_formas_pago.forma_pago_id -> formas_pago.id`
- `precio_productos.producto_id -> productos.id`
- `precio_productos.formula_id -> formulas.id`
- `usuario_modulos.usuario_id -> usuarios.id`

## 4) Reglas tecnicas y observaciones

- La mayoria de PK son `integer` con secuencia; `ingredientes` y `precio_productos` usan `bigint`.
- Hay campos historicos/desnormalizados en detalle de pedido (`nombre_producto`, `tamano_nombre`, `formula_nombre`), util para snapshot comercial.
- En el SQL recibido hay bloques duplicados para `almacenes` e `inventario`; se asume que fue un copiado repetido y no un requerimiento funcional.
- No se observaron `FOREIGN KEY` explicitas en el fragmento enviado.

## 5) Glosario semantico rapido

- `stock_fisico`: existencia real.
- `stock_comprometido`: existencia reservada para pedidos/procesos.
- `precio_venta_final`: precio final calculado con margen y factor.
- `tasa` / `tasa_cambio_monto`: conversion monetaria aplicada en pagos o pedidos.

## 6) Ejemplos de datos reales (pendiente)

Completar cuando envies registros por tabla. Recomendado incluir 3-10 filas por tabla en formato JSON o tabla.

Plantilla sugerida por tabla:

```json
{
  "tabla": "nombre_tabla",
  "muestras": [
    {
      "columna_1": "valor",
      "columna_2": 123
    }
  ],
  "notas": "Reglas o particularidades observadas en los datos reales"
}
```

## 7) Checklist para enriquecer este contexto

Cuando compartas datos, agregar:

- Estados reales usados en `pedidos_venta.estado` y `ordenes_produccion.estado`
- Formatos reales de `pagos.referencia` y `banco_formas_pago.detalles`
- Convenciones de `sku` en `precio_productos`
- Unidades reales de `ingredientes.unidad` y `formula_componentes.unidad`
- Casos edge (nulos, montos en 0, pedidos sin pago, pagos parciales)
