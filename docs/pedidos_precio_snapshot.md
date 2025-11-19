Campo: `pedido_venta_productos.precio_venta`

Descripción

- `precio_venta` es el snapshot (precio unitario de venta) del producto al momento en que se creó la línea del pedido.
- Objetivo: evitar que cambios posteriores en `productos.precio_venta` modifiquen el precio mostrado en pedidos ya realizados.

Comportamiento implementado

- Al crear un pedido (rutas protegida y pública) se guarda el precio actual del producto en `pedido_venta_productos.precio_venta`.
- Al consultar pedidos, la API mostrará `COALESCE(pv.precio_venta, prod.precio_venta)` para compatibilidad con datos anteriores.

Backfill

- Se añadió el script `scripts/backfill_precio_pedidos.js` que rellena las filas donde `precio_venta` es NULL.
- Lógica: `precio_venta = productos.precio_venta` cuando `precio_venta IS NULL`.

Cómo ejecutar el backfill (local / servidor con env configurado)

1. Asegúrate de tener la variable `DATABASE_URL` configurada (.env)
2. Ejecuta:

```bash
node scripts/backfill_precio_pedidos.js
```

Salida esperada

- Mensaje indicando cuántas filas estaban con `precio_venta` antes y después, y cuántas fueron afectadas.

Notas

- El script es idempotente: solo actualiza filas con `precio_venta IS NULL`.
- Recomendación: hacer backup o ejecutar en un entorno de staging antes de aplicar en producción si quieres auditar cambios.
