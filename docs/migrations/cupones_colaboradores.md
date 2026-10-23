# Cupones y colaboradores

La migración crea las tablas PostgreSQL `colaboradores`, `cupones` y `cupon_usos`, más los índices para búsquedas y relaciones. También agrega la comisión configurable por influencer, snapshots de pedidos pagados y el libro de liquidaciones del influencer.

Ejecuta la migración solo después de configurar `DATABASE_URL` a una base local. No la ejecutes con el `.env` que apunta a Neon remoto. Desde `mirra-backend`:

```bash
node scripts/create_cupones_tables.js
```

El script es idempotente: puede ejecutarse de nuevo si las tablas ya existen. La ruta administrativa requiere autenticación y está disponible en `/api/cupones`.

## Endpoints

Administración (requiere autenticación, `/api/cupones`):

- `GET /api/cupones` — listar cupones, colaboradores y usos.
- `POST /api/cupones` — crear cupón.
- `PUT /api/cupones/:id` — actualizar cupón.
- `PATCH /api/cupones/:id/estado` — activar o desactivar cupón.
- `GET /api/cupones/:id/usos` — historial del cupón.
- `GET /api/cupones/colaboradores` — listar colaboradores y saldos.
- `GET /api/cupones/colaboradores/:id/comisiones-pagos` — consultar cierres, saldo y comprobantes.
- `POST /api/cupones/colaboradores/:id/comisiones-pagos` — cerrar saldo hasta una fecha y registrar referencia/comprobante.
- `POST /api/cupones/colaboradores` — crear colaborador.
- `PUT /api/cupones/colaboradores/:id` — actualizar colaborador.
- `PATCH /api/cupones/colaboradores/:id/estado` — activar o desactivar colaborador.
- `GET /api/cupones/influencer/dashboard` — métricas del influencer autenticado.

La tasa inicial para influencers nuevos es 10% y el administrador puede modificarla entre 0% y 100%. Un pedido aparece en el panel solo cuando está cerrado como `Completado` y los pagos registrados cubren el total en USD, con tolerancia de $0.05. Pedidos pendientes, enviados, completados sin pago o parcialmente pagados no generan comisión visible.

Al confirmar el pago completo se congelan total, recargo, IVA, base imponible, tasa de cambio, porcentaje y comisión. La base se calcula como `(total final - recargos) / 1.16`; la comisión es `base imponible * porcentaje / 100`. Los pedidos cancelados/anulados no generan comisión. Cédula y teléfono se devuelven enmascarados al panel del influencer.

El admin registra los cierres en `/api/cupones/colaboradores/:id/comisiones-pagos`, indicando `fecha_corte` como `YYYY-MM-DD`, referencia, observaciones y URL de una imagen comprobante. La interfaz muestra la fecha como `DD/MM/AAAA`. El backend calcula el saldo generado hasta el final de esa fecha, resta liquidaciones anteriores y crea un pago por el saldo; rechaza fechas de corte duplicadas o períodos sin saldo. Admin e influencer pueden abrir el comprobante desde el historial de pagos.

Cada perfil influencer debe vincularse a un usuario cuyo rol sea `influencer`. El endpoint de métricas deriva la identidad del token y no acepta el ID de otro usuario. Las cuentas influencer solo pueden consultar este endpoint.

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
