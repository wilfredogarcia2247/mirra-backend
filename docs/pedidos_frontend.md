# Documentación Frontend - Pedidos

Este documento describe los endpoints y flujos relevantes para que el frontend gestione pedidos de venta, líneas, creación de órdenes de producción desde líneas y las acciones relacionadas (completar, cancelar, pagos). Incluye ejemplos curl, payloads y recomendaciones de UI.

**Base URL**: `http://<HOST>:<PORT>/api` (ej. `http://localhost:3000/api`)

**Autenticación**: todos los endpoints protegidos requieren cabecera `Authorization: Bearer <TOKEN>` donde `<TOKEN>` es JWT obtenido con `POST /api/auth/login`.

**Obtener token (login)**

Request:

POST `/api/auth/login`

Payload JSON:

{
  "email": "user@example.com",
  "password": "secret"
}

Ejemplo (con `jq` para extraer token):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@ejemplo.com","password":"clave"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users
```

Endpoints principales

- **Listar pedidos**: `GET /api/pedidos-venta`
  - Devuelve todos los pedidos con sus líneas en `productos`.
  - Nota: por diseño no devuelve los `componentes` de las fórmulas en la respuesta; cada línea incluye `formula_id`, `formula_nombre`, `orden_produccion_id`, `produccion_creada` y `produccion_completada`.

- **Detalle de un pedido**: `GET /api/pedidos-venta/:id`
  - Devuelve el pedido con `productos` y totales.

- **Crear pedido**: `POST /api/pedidos-venta`
  - Payload mínimo:
    - `cliente_id` (int)
    - `productos`: array de líneas: `{ producto_id, cantidad, [formula_id] }`
  - Ejemplo:

```json
{
  "cliente_id": 12,
  "productos": [
    {"producto_id": 5, "cantidad": 10, "formula_id": 3},
    {"producto_id": 8, "cantidad": 2}
  ],
  "estado": "Pendiente"
}
```

- **Agregar líneas a un pedido existente**: `POST /api/pedidos-venta/:id/items`
  - Acepta `productos` como array, o un único objeto `producto`, o un array plano.
  - Las líneas se guardan con snapshot de `precio_venta`, `costo_unitario`, `nombre_producto`. Si hay `formula_id`, se prioriza la información desde la fórmula.

- **Crear orden de producción desde una línea**: `POST /api/pedidos-venta/:pedidoId/lineas/:lineaId/ordenes-produccion`
  - Uso: cuando una línea tiene `formula_id` y se desea producir la cantidad de la línea (o una cantidad distinta pasada en body).
  - Request body opcional: `{ "cantidad": 5 }` (si se omite, se usa `linea.cantidad`).
  - Respuesta: `{ ok: true, orden: { ... } }` con la orden creada y la línea actualizada (`orden_produccion_id`, `produccion_creada: true`).

Ejemplo curl:

```bash
curl -X POST http://localhost:3000/api/pedidos-venta/123/lineas/456/ordenes-produccion \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cantidad":10}'
```

- **Eliminar línea (condicionado)**: `DELETE /api/pedidos-venta/:pedidoId/lineas/:lineaId`
  - Solo permite eliminar si la línea NO tiene orden de producción vinculada (`orden_produccion_id` es null y `produccion_creada` es false).
  - Si la línea está vinculada o la orden fue creada, devuelve `400` con mensaje explicando que no se puede eliminar.

- **Cambiar estado del pedido**: `PUT /api/pedidos-venta/:id/status`
  - Body: `{ "estado": "Enviado" }` (valores permitidos: `Pendiente`, `Enviado`, `Completado`, `Cancelado`).
  - Si se pasa `Completado` el backend ejecuta la lógica transaccional que consume inventario y registra pagos si se envía `pago` en el body.

- **Completar pedido / registrar pago y salida de inventario**: `POST /api/pedidos-venta/:id/completar` o `POST /api/pedidos-venta/:id/finalizar`
  - Body opcional: `{ "pago": { "forma_pago_id": 1, "monto": 100.0, "banco_id": 2, "referencia": "abc" } }`
  - Respuesta incluye `movimientos` realizados y `pago` insertado.

- **Registrar pago adicional (sin cambiar estado)**: `POST /api/pedidos-venta/:id/pagos`
  - Body: `{ "pago": { ... } }` o directamente el objeto pago.
  - Devuelve el pago insertado.

- **Listar pagos de un pedido**: `GET /api/pedidos-venta/:id/pagos`

- **Cancelar pedido**: `POST /api/pedidos-venta/:id/cancelar`
  - Libera reservas (`stock_comprometido`) y recalcula compromisos.
  - Además, si existe(s) orden(es) de producción asociadas y estas están en estado `Completada`, el endpoint devuelve al inventario: el producto terminado (cantidad producida) y los componentes según la fórmula. Estos movimientos se registran en `inventario_movimientos`.
  - La respuesta incluye detalles de `liberaciones`, `warnings`, `recalculations` y `produccionRevertida` cuando aplique.

Comportamiento y campos importantes en las líneas (frontend)

- `formula_id`: si está presente, indica que la línea depende de una fórmula (producto producido). El frontend puede usar esto para mostrar un botón `Crear Orden de Producción`.
- `orden_produccion_id`: ID de la orden creada (si existe)
- `produccion_creada`: booleano; true si ya se creó la orden desde la línea
- `produccion_completada`: booleano calculado (si la suma de producciones completadas >= cantidad de la línea)

Ejemplos de flujo (frontend)

1) Listar pedidos y mostrar líneas

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/pedidos-venta
```

Recomendación: en la UI, mostrar por línea:
- Nombre del producto (`producto_nombre`)
- Cantidad
- `formula_id` / `formula_nombre` (si existe)
- `orden_produccion_id` y `produccion_creada`
- `produccion_completada` (si true, mostrar que la producción ya está lista)

2) Crear orden desde línea (botón en la fila)

- Mostrar botón `Crear Orden` cuando `formula_id` esté presente y `produccion_creada` sea false.
- Al hacer click: llamar `POST /api/pedidos-venta/:pedidoId/lineas/:lineaId/ordenes-produccion` y pasar `cantidad` opcional.
- Tras respuesta 201, refrescar la vista del pedido para mostrar `orden_produccion_id` y `produccion_creada: true`.

3) Eliminar línea

- Solo habilitar `Eliminar` si `orden_produccion_id` es null y `produccion_creada` es false.
- Llamar `DELETE /api/pedidos-venta/:pedidoId/lineas/:lineaId` y, si responde 200, actualizar la lista local.

4) Cancelar pedido

- Avisar al usuario con modal: "Cancelar pedido liberará reservas y, si existe producción completada asociada, devolverá inventario (producto terminado y componentes).".
- Llamar `POST /api/pedidos-venta/:id/cancelar` y mostrar el resumen que regresa (`liberaciones`, `warnings`, `produccionRevertida`).

Validaciones recomendadas en el frontend

- Validar que `cantidad` sea entero > 0 antes de enviar.
- No permitir crear orden si `formula_id` no está presente; mostrar tooltip explicando por qué.
- Manejar errores HTTP y mostrar mensajes claros:
  - 400: datos inválidos (mostrar mensaje desde response.error)
  - 401: re-login necesario
  - 409: conflicto de inventario (mostrar opción para refrescar stock)

Ejemplos concretos curl

- Añadir líneas a pedido:

```bash
curl -X POST http://localhost:3000/api/pedidos-venta/123/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productos":[{"producto_id":5,"cantidad":2,"formula_id":3}]}'
```

- Crear orden desde línea:

```bash
curl -X POST http://localhost:3000/api/pedidos-venta/123/lineas/456/ordenes-produccion \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cantidad":10}'
```

- Eliminar línea:

```bash
curl -X DELETE http://localhost:3000/api/pedidos-venta/123/lineas/456 \
  -H "Authorization: Bearer $TOKEN"
```

- Completar pedido con pago:

```bash
curl -X POST http://localhost:3000/api/pedidos-venta/123/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pago": {"forma_pago_id": 1, "monto": 150.0, "banco_id": 2, "referencia": "Pago123"}}'
```

Notas operativas para el equipo frontend

- El backend prioriza datos de `formulas` cuando `formula_id` está presente: el `precio_venta`, `costo` o `nombre` de la fórmula pueden sobrescribir el snapshot de producto.
- Si el frontend necesita los `componentes` (materias primas) para mostrar un desglose previo a crear la orden, no existe un endpoint público explícito que devuelva componentes desde la línea — sin embargo la API interna (`getComponentesForLine`) resuelve componentes si se expone. Si lo requieren, puedo añadir un endpoint público `GET /api/pedidos-venta/:pedidoId/lineas/:lineaId/componentes` que devuelva la lista de `formula_componentes` (con cantidades ya calculadas) para la línea.

¿Quieres que además cree ejemplos listos para copiar/pegar en Postman (colección) y un endpoint público para obtener los componentes de una línea? Si sí, lo implemento enseguida.
# Documentación API - Pedidos (Frontend)

Este documento describe los endpoints y ejemplos que el frontend necesita para listar pedidos de venta, ver un pedido, y las acciones de cancelar o completar un pedido.

Nota: todas las rutas están protegidas salvo que se indique lo contrario. Se asume que el frontend incluye un header `Authorization: Bearer <token>` en las peticiones protegidas.

## Esquemas principales

- Pedido (resumen en lista):

  - id: integer
  - codigo: string
  - estado: string (ej: "pendiente", "confirmado", "completado", "cancelado")
  - cliente_id: integer
  - total: number (monto total calculado en la moneda base)
  - moneda: string (ej: "USD", "ARS")
  - tasa_cambio_monto: number | null — snapshot de la tasa de cambio usada al crear el pedido (referencial)
  - fecha_creacion: string (ISO 8601)

- Pedido (detalle): además de los campos anteriores
  - lineas: array de objetos con:
    - producto_id: integer
    - cantidad: integer
    - precio_unitario: number (precio por unidad usado para cálculo; preferir `precio_venta` cuando esté disponible)
    - precio_venta: number | null — snapshot del precio de venta del producto en el momento de creación del pedido (usar siempre que exista)
    - nombre_producto: string | null — nombre del producto al momento del pedido
    - subtotal: number

## Endpoints

Base: /api

1. Listar pedidos

- Método: GET
- Ruta: /api/pedidos-venta
- Query params habituales:

  - page: integer (opcional)
  - per_page: integer (opcional)
  - estado: string (opcional) — filtrar por estado
  - cliente_id: integer (opcional)

- Headers:

  - Authorization: Bearer <token>

- Respuesta (200):
  {
  "data": [ { <pedido-resumen> }, ... ],
  "meta": { "page": 1, "per_page": 20, "total": 123 }
  }

- Ejemplo fetch:

```js
// Listar pedidos (con autenticación)
const res = await fetch('/api/pedidos-venta?page=1&per_page=20', {
  headers: { Authorization: 'Bearer ' + token },
});
const body = await res.json();
console.log(body.data); // array de pedidos
```

Ejemplo axios:

```js
const { data } = await axios.get('/api/pedidos-venta', {
  params: { page: 1, per_page: 20 },
  headers: { Authorization: `Bearer ${token}` },
});
console.log(data.data);
```

Notas importantes:

- En la lista se incluye `tasa_cambio_monto` en el objeto pedido si fue enviada al crear el pedido (es referencial y no recalcula totales retroactivamente).
- Para mostrar el precio por línea en la vista de lista suele usarse el campo `total` del pedido; para ver el desglose por línea, consultar el endpoint de detalle.

2. Obtener detalle de un pedido

- Método: GET
- Ruta: /api/pedidos-venta/:id
- Headers: Authorization: Bearer <token>

- Respuesta (200):
  {
  "id": 123,
  "codigo": "PV-0001",
  "estado": "pendiente",
  "cliente_id": 45,
  "tasa_cambio_monto": 350.5,
  "moneda": "USD",
  "lineas": [
  {
  "producto_id": 10,
  "cantidad": 2,
  "precio_unitario": 10.0,
  "precio_venta": 9.5, // usar este campo si no es null (snapshot)
  "nombre_producto": "Jabón Lavanda",
  "subtotal": 19.0
  }
  ],
  "total": 19.0
  }

Notas:

- Para cada línea, si existe `precio_venta` el frontend debe mostrarlo como el precio histórico; si está null, puede mostrarse `precio_unitario` (valor por compatibilidad). Esto garantiza que un cambio posterior en el producto no altere los pedidos ya creados.

3. Cancelar un pedido

- Método: PATCH
- Ruta: /api/pedidos-venta/:id/cancelar
- Headers: Authorization: Bearer <token>
- Body: opcional { "motivo": "razón para auditar" }

- Respuesta (200):
  { "ok": true, "pedido": { <pedido-actualizado> } }

- Posibles códigos de error:
  - 400: petición inválida (ej: pedido ya completado o ya cancelado)
  - 401: no autorizado
  - 404: pedido no encontrado

Ejemplo fetch:

```js
const res = await fetch(`/api/pedidos-venta/${id}/cancelar`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ motivo: 'Cliente solicitó cancelar' }),
});
const resBody = await res.json();
if (res.ok) {
  // refrescar lista o detalle
}
```

Reglas típicas en backend (para tener en cuenta en el front):

- No se debe permitir cancelar un pedido que ya está `completado`.
- Al cancelar un pedido, el backend puede liberar reservas de inventario y crear movimientos de ajuste; el frontend debe refrescar el stock o recargar el pedido.

4. Completar un pedido

- Método: PATCH
- Ruta: /api/pedidos-venta/:id/completar
- Headers: Authorization: Bearer <token>
- Body: opcional { "nota": "Entrega realizada por ..." }

- Respuesta (200):
  { "ok": true, "pedido": { <pedido-actualizado> } }

- Posibles códigos de error:
  - 400: pedido en estado inválido para completar (ej: ya cancelado)
  - 401: no autorizado
  - 404: pedido no encontrado

Ejemplo fetch:

```js
const res = await fetch(`/api/pedidos-venta/${id}/completar`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ nota: 'Entregado por transporte X' }),
});
const body = await res.json();
if (res.ok) {
  // mostrar confirmación y actualizar vista
}
```

Reglas típicas del backend relevantes para el front:

- Completar normalmente decrementa el inventario definitivo y cambia estado a `completado`.
- Si no hay stock suficiente, el backend puede rechazar la operación con 400; el frontend debe mostrar un mensaje y permitir reintento o crear una orden de reposición.

5. Crear un pedido (resumen)

- Método: POST
- Ruta: /api/pedidos-venta
- Headers: Authorization: Bearer <token>
- Body (ejemplo):
  {
  "cliente_id": 45,
  "moneda": "USD",
  "tasa_cambio_monto": 350.5, // opcional — snapshot referencial
  "lineas": [ { "producto_id": 10, "cantidad": 2 }, ... ]
  }

- Respuesta (201): { "ok": true, "pedido": { <pedido-creado> } }

Notas:

- `tasa_cambio_monto` es opcional pero si se envía se guarda como snapshot en `pedidos_venta.tasa_cambio_monto`.
- En cada línea el backend guarda `precio_venta` y `nombre_producto` al crear el pedido. El frontend no debe asumir que el precio mostrado en la tarjeta del producto será el mismo después de la creación del pedido.

6. Manejo de errores y estados

- 401 Unauthorized: redirigir a login o renovar token.
- 403 Forbidden: mostrar mensaje de permisos insuficientes.
- 404 Not Found: mostrar mensaje de recurso no encontrado.
- 400 Bad Request: validar y mostrar errores en formulario (por ejemplo cantidad > stock disponible).

7. Buenas prácticas para el frontend

- Siempre mostrar para cada línea el campo `precio_venta` si existe; solo caer a `precio_unitario` si no existe `precio_venta`.
- Mostrar claramente la `tasa_cambio_monto` usada en el pedido (cuando exista) en la vista de detalle y recibos.
- Después de acciones que mutan estado (cancelar/completar/crear), refrescar la lista y el detalle del pedido para evitar mostrar datos desincronizados.
- Al recibir errores del servidor, mostrar mensajes claros y acciones posibles (reintentar, contactar soporte, crear reposición).

8. Ejemplo simple de flujo en React (pseudo-código)

```js
// Obtener lista
useEffect(() => {
  fetch('/api/pedidos-venta', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((d) => setPedidos(d.data));
}, []);

// Cancelar pedido
async function cancelarPedido(id) {
  const res = await fetch(`/api/pedidos-venta/${id}/cancelar`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Cliente canceló' }),
  });
  if (res.ok) {
    // actualizar UI
  } else {
    const err = await res.json();
    // mostrar error
  }
}
```

---

Si necesitás, puedo:

- Ajustar las rutas exactas si tu API usa un path distinto (ej: `/api/pedidosVenta` en vez de `/api/pedidos-venta`).
- Generar fragmentos listos para integrar en tu store/Redux/React Query.
- Añadir un pequeño mock JSON con ejemplos reales para usar en el frontend mientras se desarrolla.

Fecha: 10-11-2025

## Campos que NO enviar al crear un pedido (público)

Cuando el frontend envía una petición para crear un pedido público, el backend calcula y guarda snapshots de precios y subtotales basándose en la data confiable del servidor (`productos`, `inventario`, etc.). Por seguridad e integridad, NO enviar campos que el servidor calcula internamente, por ejemplo:

- `precio_unitario` (el servidor ignora los precios enviados desde el cliente)
- `precio_venta` (el servidor genera y guarda su propio `precio_venta` como snapshot)
- `subtotal` (el servidor recalcula subtotales por línea)
- `precio_convertido`, `subtotal_convertido` (las conversiones se calculan en el servidor según `tasa_cambio_monto` y reglas internas)
- `producto_nombre`/`nombre_producto` (se guarda desde la DB en el servidor como snapshot)

Si el frontend envía estos campos, el servidor los ignorará o sobrescribirá con los valores calculados internamente. Si necesitás que el servidor acepte precios enviados por el cliente (p. ej. por integración con otro sistema), hay que implementarlo explícitamente en backend con validaciones adicionales (no recomendado sin controles).

## Ejemplo listo para dar al frontend

1. Payload mínimo recomendado (la API acepta `lineas` o `productos`):

```json
{
  "nombre_cliente": "Leonardo Urdaneta",
  "telefono": "04246303491",
  "cedula": "v21230219",
  "tasa_cambio_monto": 300,
  "lineas": [{ "producto_id": 49, "cantidad": 2 }]
}
```

2. Ejemplo fetch (POST crear pedido público)

```js
const payload = {
  nombre_cliente: 'Leonardo Urdaneta',
  telefono: '04246303491',
  cedula: 'v21230219',
  tasa_cambio_monto: 300,
  lineas: [{ producto_id: 49, cantidad: 2 }],
};

const res = await fetch('/api/pedidos-venta', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const data = await res.json();
if (!res.ok) {
  // manejar error: data.error contiene mensaje legible
  console.error('Error creando pedido público', data);
} else {
  // data contiene el pedido creado con snapshots: data.productos[].precio_venta en líneas
  console.log('Pedido creado:', data);
}
```

3. Ejemplo axios (POST crear pedido público)

```js
const payload = {
  nombre_cliente: 'Leonardo Urdaneta',
  telefono: '04246303491',
  cedula: 'v21230219',
  tasa_cambio_monto: 300,
  productos: [{ producto_id: 49, cantidad: 2 }],
};

try {
  const { data } = await axios.post('/api/pedidos-venta', payload);
  console.log('Pedido creado:', data);
} catch (err) {
  console.error('Error creando pedido público', err.response?.data || err.message);
}
```

4. Ejemplo de respuesta (detalle del pedido creado)

```json
{
  "id": 987,
  "codigo": "PV-0123",
  "estado": "Pendiente",
  "tasa_cambio_monto": 300,
  "productos": [
    {
      "producto_id": 49,
      "cantidad": 2,
      "producto_nombre": "Jabón Lavanda",
      "precio_venta": 15.0,
      "costo": 8.0,
      "subtotal": 30.0
    }
  ],
  "total": 30.0
}
```

5. Nota para el front: fallback cuando `precio_venta` sea null

En algún dataset legacy puede ocurrir que `precio_venta` en la línea del pedido sea `null`. En ese caso el frontend puede mostrar un mensaje de advertencia o usar el `precio_unitario` si la respuesta lo incluye por compatibilidad. Lo ideal es ejecutar el backfill/migración en el backend para que `precio_venta` exista en todas las líneas.

---
