# Mirra Perfumería — mapa del proyecto

Resumen de cómo funciona el sistema hoy (backend, frontend y base de datos), para orientarse rápido.
Revisado el 2026-11-03 leyendo el código de la rama Ender4 y la base de pruebas.
Si algo no coincide con el código, manda el código.
Este mismo archivo está en los dos repositorios (mirra-backend y mirra-perfumeria-frontend).

## Cuidado
- **No correr `jest` completo** en el backend: las pruebas de integración escriben en la base de datos configurada (incluso tasas activas).
- El `.env` local del backend apunta a la base de **pruebas** (`DATABASE_URL`; la de producción está comentada), pero el almacenamiento S3/MinIO apunta a **producción**: subir fotos o correr scripts de imágenes en local escribe en producción.
- En `scripts/` hay utilidades que **borran datos** (`truncate_*`, `clear_*`, `reset_*`, `seed_*`).
- La base de pruebas no es igual a producción (costos, categorías, fotos).
- Categorías Hombre/Mujer: están hechas a mano en producción; no reasignarlas con scripts.

## Carpetas
```
(carpeta local)
  mirra-backend/              API Node + Express (repo propio, rama Ender4; prod = master, Render autoDeploy)
  mirra-perfumeria-frontend/  React + Vite + TS (repo propio, rama Ender4; prod = main)
```

## Cómo correrlo en local
- Backend: `npm start` en mirra-backend → puerto 3000.
- Frontend: `npm run dev` en mirra-perfumeria-frontend (usa `VITE_API_URL` del `.env`, por ejemplo http://localhost:3000/api).
- Las fotos no cargan en local (apuntan a un Cloudinary desactivado). Es normal.

## Backend (mirra-backend)
- `server.js` → `app.js`: CORS, logger, `authMiddleware` (JWT con `JWT_SECRET`, sin respaldo), montaje de rutas.
- Base: Postgres en **Neon**, con `neon(DATABASE_URL)` y plantillas `` sql`...` ``. **No hay ORM ni migraciones**: cada parte crea sus tablas y columnas sola con funciones `asegurar*` / `ensure*` (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`). Seguir ese patrón para tablas nuevas.
  - Ojo: el código usa `` sql`BEGIN` ``/`COMMIT`, pero con el driver HTTP de Neon cada consulta va por separado. No contar con que sea una transacción real.
- `routes/` = endpoints, `services/` = lógica reutilizable, `scripts/` = utilidades sueltas (muchas viejas o peligrosas: `truncate_*`, `clear_*`, `reset_*`, `seed_*`; **no correrlas**), `tests/` = jest + supertest.
- `models/` está casi en desuso. `DB_CONTEXT_AI.md` y `docs/` son viejos e incompletos; usar la sección "Base de datos" de abajo.
- Rutas **públicas** (sin token), montadas antes que las protegidas:
  `/api/auth` (login; `/register` solo con NODE_ENV=test), `/api/clientes/lookup` y `/lookup-or-create`, `POST /api/pedidos-venta` (pedidosVentaPublic.js), `/api/cupones` (público), `/api/sucursales` (público), `/api/productos/catalogo`, `/api/tasas-cambio/activa`, `/api/cintillo/activos`, `/api/descuento-mayor/activo`, `POST /api/avisos-llegada`, `/api/mrw`, `/p/:slug` (enlace para compartir), `/api-docs`.
- Todo lo demás pide token. El rol `influencer` solo puede ver `GET /api/cupones/influencer/dashboard`. Roles en `usuarios.rol`: `admin`, `user`, `influencer`. Permisos por pantalla en `usuario_modulos` (solo un admin los cambia).
- Archivo principal: `routes/pedidosVenta.js` (~2900 líneas): lista, detalle, completar, pagos, ajustes, entrega, cancelar, producción por línea y **todos los reportes** (`/stats`, `/cierre-diario`, `/reportes-*`, `/reporte-comparativo`, `/rentabilidad`, `/clientes-*`).

### Flujo de un pedido
1. El cliente arma el carrito en la tienda → `POST /api/pedidos-venta` (público). Se guarda `pedidos_venta` + una línea por perfume en `pedido_venta_productos` con **precio_venta y costo_unitario copiados de la fórmula en ese momento** (quedan fijos). Se reserva stock (`inventario.stock_comprometido`). Luego se abre WhatsApp con el pedido.
2. Estado `Pendiente`. Para perfumes con fórmula hay que **producir**: `ordenes_produccion` (Pendiente → Completada) usando las materias primas de `formula_componentes`.
3. **Completar** (`POST /:id/completar` o `/finalizar` → `completarPedidoTransaccional`): exige lo producido, descuenta el stock reservado (`inventario` + `inventario_movimientos` 'salida'), marca `estado='Completado'` y `completado_en`, y registra el pago si viene (`pagos`). **Se puede completar sin pago.**
4. `Cancelado` (`POST /:id/cancelar`) libera la reserva y revierte el cupón.
- Total del pedido = Σ(cantidad × precio_venta) − cupón − descuento al mayor − ajustes de descuento + recargos (`pedido_venta_ajustes`). El delivery no cuenta como venta.
- Reportes y cierre diario cuentan los pedidos **completados** según su estado y fecha (`completado_en`, o `fecha` si falta). El cierre diario (`services/dailySalesClose.js`) suma precios de las líneas, **no los pagos**: una regalía completada sin pago cuenta como venta.

### Costos (situación al 2026-11-03)
- Hay costo en `formulas.costo` (por presentación), `productos.costo` (materia prima), `ingredientes.costo` y `pedido_venta_productos.costo_unitario` (copia al vender).
- En pruebas **todo vale 0**: 672 fórmulas, 227 materias primas e `ingredientes` vacía. Solo 59 de 375 líneas vendidas tienen costo guardado.
- La pantalla de fórmulas (`Formulas.tsx`) **recalcula costo y precio con los costos de los ingredientes** al cambiar componentes. Con ingredientes en 0, los deja en 0.
- Existe además la tabla `costos_presentacion` (costo por tamaño, solo en Ender4, no está en producción). Se está evaluando reemplazarla por guardar el costo en `formulas.costo`, igual que el precio masivo de la pantalla Fórmulas (`PATCH /api/formulas/by-like`).

## Base de datos (pruebas, 2026-11-03; filas aproximadas)
- **productos** (538): perfumes terminados **y** materias primas en la misma tabla (no hay columna tipo). Es terminado si tiene fórmulas (`formulas.producto_terminado_id`), materia prima si aparece en `formula_componentes.materia_prima_id`. Otros campos: `visible_en_catalogo`, `destacado`, `image_url`, `ficha` (jsonb, ficha del perfume), `categoria_id` (viejo).
- **producto_categorias** (producto ↔ categoría, varias), **categorias**, **marcas** (vacía).
- **formulas** (672): una fila por **presentación** de un perfume (`nombre` tipo "LATTAFA ASAD Presentación 100 ml"), con `costo`, `precio_venta` y `activo`. El tamaño en ml **se lee del nombre** con la expresión `([0-9]+(?:[.,][0-9]+)?)\s*ml`; no hay columna de tamaño.
- **formula_componentes** (~2000): `formula_id`, `materia_prima_id` (→ productos), `cantidad`, `unidad` (g/ml). Esencia, fijador, alcohol.
- **almacenes**: "Almacén de Venta" (`tipo='venta'`) y "Almacen Materia prima" (`tipo='interno'`, `es_materia_prima`). **inventario**: `stock_fisico`, `stock_comprometido` por producto y almacén. **inventario_movimientos**: entrada/salida con motivo.
- **ordenes_produccion**: `producto_terminado_id`, `formula_id`, `cantidad`, `estado` (Pendiente/Completada), `pedido_venta_id`.
- **pedidos_venta** (231): cliente (`cliente_id`, `nombre_cliente`, `cedula`, `telefono`), `estado` (Pendiente/Completado/Cancelado), `fecha`, `completado_en`, `tasa_cambio_monto` (Bs por $ al pedir), cupón (`cupon_id`, `cupon_codigo`, `descuento_cupon`), descuento al mayor (`descuento_mayor*`), `tipo_entrega` + `datos_entrega` (jsonb: estado, ciudad, dirección...).
- **pedido_venta_productos** (375): `producto_id`, `formula_id`/`formula_nombre`, `cantidad`, `precio_venta`, `costo_unitario`, `nombre_producto`, `orden_produccion_id`. Unas 60 líneas viejas no tienen `formula_id`.
- **pedido_venta_ajustes**: descuento/recargo, monto fijo o %, con motivo.
- **pagos**: `pedido_venta_id`, `forma_pago_id`, `banco_id`, `monto`, `referencia`, `tasa`. **formas_pago**, **bancos**, **banco_formas_pago** (datos de pago en jsonb).
- **tasas_cambio**: una con `activo=true`. Al cambiarla se actualizan los pedidos pendientes sin pago (`services/pendingOrderRateSync.js`).
- **clientes** (cédula con prefijo V/E; ver arreglo de búsqueda por cédula), **colaboradores** (influencers, `porcentaje_comision`), **cupones**, **cupon_usos** (comisiones), **influencer_comision_pagos**.
- Otras: **usuarios**, **usuario_modulos**, **sucursales**, **cintillo_mensajes**, **avisos_llegada** ("Avísame cuando llegue"), **descuento_mayor_config**, **costos_presentacion**, **precio_productos** e **ingredientes** (vacías / sin uso).
- Fotos: MinIO (`s3.mirraperfumeria.com`), `products/<nombre>`; copias livianas WebP en `products/cinta/` (`services/miniaturas.js`).

## Frontend (mirra-perfumeria-frontend)
- React 18 + Vite 5 + TypeScript + Tailwind + componentes shadcn/ui (`src/components/ui`), React Router 6 y React Query.
- `src/App.tsx`: rutas. **Tienda pública**: `/` y `/categoria/:slug` (`pages/Hero.tsx`), `/about`, `/rastreo`, `/p/:slug`. **Panel** (con sesión y permiso por módulo, `ModuleProtectedRoute`): `/dashboard`, `/productos`, `/formulas`, `/produccion`, `/pedidos`, `/reportes/:tipo`, `/tasas-cambio`, `/costos-presentacion`, `/usuarios`, `/bancos`, `/pagos`, `/admin/marketing/*` (destacados, cupones, descuento-mayor, avisos), `/admin/cintillo`, `/admin/sucursales`, `/influencer`. Rutas `*-preview` solo en desarrollo.
- `src/integrations/api.ts`: **todas** las llamadas al backend (`apiFetch` con token `jwt_token` de localStorage; con 401 en el panel manda a /login, en la tienda no).
- Archivos grandes: `pages/Pedidos.tsx` (panel de pedidos: completar, pagos, copiar pedido), `pages/Reportes.tsx` (menú de reportes + `components/*Report.tsx`), `components/CheckoutModal.tsx` (checkout de la tienda → WhatsApp), `pages/Hero.tsx` (tienda), `pages/Formulas.tsx`.
- `src/lib/`: reglas compartidas con el backend (descuento al mayor, mínimo 7 ml, formato WhatsApp del pedido, catálogo, ficha del perfume).
- `src/integrations/supabase` y las variables `VITE_WAHA_*` / `VITE_CLOUDINARY_*` son restos viejos.
- Producción: push a `main` → GitHub Action compila y publica `dist` en la rama `prod-dist`.
