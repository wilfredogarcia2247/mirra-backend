# Documentación API - Bancos (Frontend)

Este documento describe los endpoints CRUD para `bancos` que el frontend puede consumir.

Base: /api/bancos

Autenticación
- Todas las rutas están protegidas por middleware de autenticación (JWT). El frontend debe enviar header:
  Authorization: Bearer <token>

Esquema banco
- id: integer
- nombre: string

Endpoints

1) Listar bancos
- Método: GET
- Ruta: /api/bancos
- Headers: Authorization
- Respuesta (200): array de objetos banco, ej:
  [ { "id": 1, "nombre": "Banco Uno" }, ... ]

Ejemplo fetch:
```js
const res = await fetch('/api/bancos', { headers: { Authorization: `Bearer ${token}` } });
const bancos = await res.json();
```

2) Crear banco
- Método: POST
- Ruta: /api/bancos
- Headers: Authorization, Content-Type: application/json
- Body: { "nombre": "Banco Nuevo" }
- Respuesta (201): objeto banco creado

Ejemplo fetch:
```js
const res = await fetch('/api/bancos', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ nombre: 'Banco Nuevo' })
});
const banco = await res.json();
```

Validaciones y errores:
- 400: nombre requerido o invalid
- 401: no autorizado
- 500: error servidor

3) Obtener banco por id
- Método: GET
- Ruta: /api/bancos/:id
- Headers: Authorization
- Respuesta (200): objeto banco
- 404 si no existe

Ejemplo fetch:
```js
const res = await fetch(`/api/bancos/${id}`, { headers: { Authorization: `Bearer ${token}` } });
if (res.status === 404) { /* manejar no encontrado */ }
const banco = await res.json();
```

4) Actualizar banco
- Método: PUT
- Ruta: /api/bancos/:id
- Headers: Authorization, Content-Type: application/json
- Body: { "nombre": "Banco Modificado" }
- Respuesta (200): objeto banco actualizado

Ejemplo fetch:
```js
const res = await fetch(`/api/bancos/${id}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ nombre: 'Banco Modificado' })
});
const updated = await res.json();
```

5) Eliminar banco
- Método: DELETE
- Ruta: /api/bancos/:id
- Headers: Authorization
- Comportamiento: Si el banco está asociado a `cliente_bancos`, la API devuelve 400 y no permite borrarlo. Esto evita eliminar bancos en uso.
- Respuesta (200): { success: true, banco: { ... } }

Ejemplo fetch:
```js
const res = await fetch(`/api/bancos/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
const body = await res.json();
if (!res.ok) { console.error(body); }
```

Buenas prácticas para el frontend
- Validar formulario antes de enviar (nombre no vacío).
- Manejar códigos 400/401/404 para dar feedback claro al usuario.
- Cuando se elimina un banco, refrescar la lista de bancos y también la lista de `cliente_bancos` si corresponde.

Notas de implementación
- El backend valida `nombre` como string no vacío.
- El backend impide eliminar bancos que tengan entradas en `cliente_bancos`.

Formas de pago y campo `detalles`

- Cada banco puede tener varias entradas en `banco_formas_pago`. Cada entrada contiene `detalles` (JSON) con la información necesaria para usar esa forma de pago.
- Convenciones recomendadas para `detalles` (no son obligatorias en DB, pero sirven como contrato entre frontend/backend):
  - Pago Movil:
    - `numero_telefono` (string): número de teléfono del receptor (ej. "04241234567").
    - `documento` (string): cédula o RIF del receptor (ej. "V-12345678", "J-12345678-9").
    - `operador` (opcional): operador del pago móvil (ej. "MOV").
    - `observaciones` (opcional).
  - Transferencia:
    - `numero_cuenta` (string): número de cuenta o CLABE/IBAN según país (ej. "00012345678").
    - `documento` (string): cédula o RIF del titular.
    - `tipo_cuenta` (opcional): ej. "corriente" o "ahorro".
    - `observaciones` (opcional).

Ejemplo: Banco de Venezuela (semilla)

POST /api/bancos (body)

{
  "nombre": "Banco de Venezuela",
  "formas_pago": [
    { "forma_pago_id": 2, "detalles": { "numero_cuenta": "00012345678", "documento": "V-12345678" } },
    { "forma_pago_id": 4, "detalles": { "numero_telefono": "04241234567", "documento": "V-12345678", "operador": "MOV" } }
  ]
}

GET /api/bancos/:id (respuesta esperada)

{
  "id": 10,
  "nombre": "Banco de Venezuela",
  "formas_pago": [
    { "id": 2, "nombre": "Transferencia", "detalles": { "numero_cuenta": "00012345678", "documento": "V-12345678" } },
    { "id": 4, "nombre": "Pago Movil", "detalles": { "numero_telefono": "04241234567", "documento": "V-12345678", "operador": "MOV" } }
  ]
}

Fecha: 11-11-2025
