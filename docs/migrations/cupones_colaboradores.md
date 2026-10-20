# Cupones y colaboradores

La migración crea las tablas PostgreSQL `colaboradores`, `cupones` y `cupon_usos`, más los índices para búsquedas y relaciones.

Antes de ejecutarla, confirma que `DATABASE_URL` apunta al entorno de base de datos deseado. Desde `mirra-backend`:

```bash
npm run migrate:cupones
```

El script es idempotente: puede ejecutarse de nuevo si las tablas ya existen. La ruta administrativa requiere autenticación y está disponible en `/api/cupones`.

## Endpoints

Administración (requiere autenticación, `/api/cupones`):

- `GET /api/cupones` — listar cupones, colaborador y usos registrados.
- `POST /api/cupones` — crear cupón.
- `PUT /api/cupones/:id` — actualizar cupón.
- `PATCH /api/cupones/:id/estado` — activar/desactivar sin borrar su historial.
- `GET /api/cupones/:id/usos` — historial del cupón.
- `GET /api/cupones/colaboradores` — listar colaboradores.
- `POST /api/cupones/colaboradores` — crear colaborador.
- `PUT /api/cupones/colaboradores/:id` — actualizar colaborador.
- `PATCH /api/cupones/colaboradores/:id/estado` — activar/desactivar colaborador.

Público (sin autenticación):

- `POST /api/cupones/validar` — valida un código y devuelve el porcentaje de descuento.
- `POST /api/pedidos-venta` — acepta `cupon_codigo` en el cuerpo y aplica el descuento.

## Integración con el checkout público

El carrito del sitio público (`src/pages/Hero.tsx`) valida el código con `POST /api/cupones/validar`
muestra el descuento en el total y envía `cupon_codigo` al crear el pedido.

El backend nunca confía en el monto enviado por el cliente: recalcula el total de las líneas
guardadas, aplica el porcentaje del cupón y registra el canje en `cupon_usos`, incrementando
`cupones.uso_actual` de forma condicional para no sobrepasar `uso_maximo`.

Si el cupón es inválido, está vencido o ya agotó sus usos, el pedido se rechaza con `400` y
`cupon_invalido: true`; el cliente libera el cupón y avisa al comprador.

El pedido guarda `cupon_id`, `cupon_codigo` y `descuento_cupon`, y el total devuelto ya es neto
(`total_base` es el monto sin descuento).
