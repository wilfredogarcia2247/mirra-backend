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

1) Listar pedidos

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
  headers: { 'Authorization': 'Bearer ' + token }
});
const body = await res.json();
console.log(body.data); // array de pedidos
```

Ejemplo axios:

```js
const { data } = await axios.get('/api/pedidos-venta', {
  params: { page: 1, per_page: 20 },
  headers: { Authorization: `Bearer ${token}` }
});
console.log(data.data);
```

Notas importantes:
- En la lista se incluye `tasa_cambio_monto` en el objeto pedido si fue enviada al crear el pedido (es referencial y no recalcula totales retroactivamente).
- Para mostrar el precio por línea en la vista de lista suele usarse el campo `total` del pedido; para ver el desglose por línea, consultar el endpoint de detalle.

2) Obtener detalle de un pedido

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
        "precio_venta": 9.5,    // usar este campo si no es null (snapshot)
        "nombre_producto": "Jabón Lavanda",
        "subtotal": 19.0
      }
    ],
    "total": 19.0
  }

Notas:
- Para cada línea, si existe `precio_venta` el frontend debe mostrarlo como el precio histórico; si está null, puede mostrarse `precio_unitario` (valor por compatibilidad). Esto garantiza que un cambio posterior en el producto no altere los pedidos ya creados.

3) Cancelar un pedido

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
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ motivo: 'Cliente solicitó cancelar' })
});
const resBody = await res.json();
if (res.ok) {
  // refrescar lista o detalle
}
```

Reglas típicas en backend (para tener en cuenta en el front):
- No se debe permitir cancelar un pedido que ya está `completado`.
- Al cancelar un pedido, el backend puede liberar reservas de inventario y crear movimientos de ajuste; el frontend debe refrescar el stock o recargar el pedido.

4) Completar un pedido

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
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ nota: 'Entregado por transporte X' })
});
const body = await res.json();
if (res.ok) {
  // mostrar confirmación y actualizar vista
}
```

Reglas típicas del backend relevantes para el front:
- Completar normalmente decrementa el inventario definitivo y cambia estado a `completado`.
- Si no hay stock suficiente, el backend puede rechazar la operación con 400; el frontend debe mostrar un mensaje y permitir reintento o crear una orden de reposición.

5) Crear un pedido (resumen)

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

6) Manejo de errores y estados

- 401 Unauthorized: redirigir a login o renovar token.
- 403 Forbidden: mostrar mensaje de permisos insuficientes.
- 404 Not Found: mostrar mensaje de recurso no encontrado.
- 400 Bad Request: validar y mostrar errores en formulario (por ejemplo cantidad > stock disponible).

7) Buenas prácticas para el frontend

- Siempre mostrar para cada línea el campo `precio_venta` si existe; solo caer a `precio_unitario` si no existe `precio_venta`.
- Mostrar claramente la `tasa_cambio_monto` usada en el pedido (cuando exista) en la vista de detalle y recibos.
- Después de acciones que mutan estado (cancelar/completar/crear), refrescar la lista y el detalle del pedido para evitar mostrar datos desincronizados.
- Al recibir errores del servidor, mostrar mensajes claros y acciones posibles (reintentar, contactar soporte, crear reposición).

8) Ejemplo simple de flujo en React (pseudo-código)

```js
// Obtener lista
useEffect(() => {
  fetch('/api/pedidos-venta', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.json())
    .then(d => setPedidos(d.data));
}, []);

// Cancelar pedido
async function cancelarPedido(id) {
  const res = await fetch(`/api/pedidos-venta/${id}/cancelar`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'Cliente canceló' }) });
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

1) Payload mínimo recomendado (la API acepta `lineas` o `productos`):

```json
{
  "nombre_cliente": "Leonardo Urdaneta",
  "telefono": "04246303491",
  "cedula": "v21230219",
  "tasa_cambio_monto": 300,
  "lineas": [
    { "producto_id": 49, "cantidad": 2 }
  ]
}
```

2) Ejemplo fetch (POST crear pedido público)

```js
const payload = {
  nombre_cliente: 'Leonardo Urdaneta',
  telefono: '04246303491',
  cedula: 'v21230219',
  tasa_cambio_monto: 300,
  lineas: [ { producto_id: 49, cantidad: 2 } ]
};

const res = await fetch('/api/pedidos-venta', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
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

3) Ejemplo axios (POST crear pedido público)

```js
const payload = {
  nombre_cliente: 'Leonardo Urdaneta',
  telefono: '04246303491',
  cedula: 'v21230219',
  tasa_cambio_monto: 300,
  productos: [ { producto_id: 49, cantidad: 2 } ]
};

try {
  const { data } = await axios.post('/api/pedidos-venta', payload);
  console.log('Pedido creado:', data);
} catch (err) {
  console.error('Error creando pedido público', err.response?.data || err.message);
}
```

4) Ejemplo de respuesta (detalle del pedido creado)

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

5) Nota para el front: fallback cuando `precio_venta` sea null

En algún dataset legacy puede ocurrir que `precio_venta` en la línea del pedido sea `null`. En ese caso el frontend puede mostrar un mensaje de advertencia o usar el `precio_unitario` si la respuesta lo incluye por compatibilidad. Lo ideal es ejecutar el backfill/migración en el backend para que `precio_venta` exista en todas las líneas.

---
