 # Documentación - Usuarios y Asignación de Módulos

Este documento describe cómo crear usuarios y asignarles permisos por módulo mediante la tabla `usuario_modulos`. Incluye endpoints propuestos (algunos ya existentes), payloads, ejemplos curl y recomendaciones de seguridad para el frontend.

Base URL: `http://<HOST>:<PORT>/api` (ej. `http://localhost:3000/api`)

Autenticación: todos los endpoints requieren `Authorization: Bearer <TOKEN>`.

Resumen del esquema de la tabla `usuario_modulos`

La tabla creada por `scripts/create_usuario_modulos_table.js` tiene (entre otras) las columnas booleanas:

- `id` (serial)
- `usuario_id` (FK a `usuarios(id)`)
- `dashboard`, `tasas_cambio`, `bancos`, `marcas`, `categorias`, `almacenes`, `productos`, `formulas`, `pedidos` (boolean)
- `created_at`, `updated_at`

Nota: la FK es tentativa (puede ser NULL si el usuario no existe al momento). El script intenta crear/alterar la tabla si no existe.

Rutas/Endpoints (propuestos y existentes)

1) Listar usuarios (existente)

- GET `/api/users`
  - Respuesta: array de usuarios con campos `{ id, nombre, email, rol }`.

2) Crear usuario (recomendado)

- POST `/api/users`
  - Body (JSON):
    - `nombre` (string, requerido)
    - `email` (string, requerido, único)
    - `password` (string, requerido)
    - `rol` (string, opcional, ej. `admin`/`user`)
  - Validaciones: email único, password mínimo 8 caracteres (recomendado), rol permitido.
  - Respuesta 201: `{ id, nombre, email, rol }` (no devolver password)

3) Obtener usuario

- GET `/api/users/:id`
  - Respuesta: `{ id, nombre, email, rol }` o 404 si no existe.

4) Actualizar usuario

- PUT `/api/users/:id`
  - Body: campos editables `{ nombre?, email?, password?, rol? }`.
  - Validación y efectos: si se actualiza `password`, aplica hashing en backend.
  - Respuesta: usuario actualizado.

5) Eliminar usuario

- DELETE `/api/users/:id`
  - Acción sensible: sólo admin puede eliminar.
  - Respuesta: 200 `{ ok: true }`.

6) Listar/consultar permisos de módulos (usuario_modulos)

- GET `/api/users/:id/modulos`
  - Devuelve la fila de `usuario_modulos` para el usuario: `{ id, usuario_id, dashboard, tasas_cambio, bancos, marcas, categorias, almacenes, productos, formulas, pedidos, created_at, updated_at }` o 404 si no existe.

- GET `/api/usuario-modulos` (opcional)
  - Devuelve todas las filas de `usuario_modulos` (solo admin).

7) Crear/actualizar permisos (upsert)

- POST `/api/users/:id/modulos`
  - Body (JSON): cualquiera de las banderas booleanas, por ejemplo:

```json
{
  "dashboard": true,
  "productos": true,
  "pedidos": false
}
```

  - Comportamiento: insertar si no existe fila para `usuario_id`, o actualizar la fila existente.
  - Respuesta: la fila insertada/actualizada.

- PUT `/api/users/:id/modulos` (alternativa)
  - Similar a POST pero semánticamente actualización completa.

8) Eliminar permisos

- DELETE `/api/users/:id/modulos`
  - Elimina la fila de `usuario_modulos` para ese `usuario_id`.

Ejemplos curl

Obtener token y listar usuarios

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@ejemplo.com","password":"clave"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users
```

Crear usuario (backend debe implementar hashing y validaciones)

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"María", "email":"maria@ejemplo.com", "password":"superpass", "rol":"user"}'
```

Asignar módulos al usuario (upsert)

```bash
curl -X POST http://localhost:3000/api/users/42/modulos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dashboard": true, "productos": true, "pedidos": true}'
```

Consultar permisos de un usuario

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users/42/modulos
```

Eliminar permisos

```bash
curl -X DELETE http://localhost:3000/api/users/42/modulos \
  -H "Authorization: Bearer $TOKEN"
```

Recomendaciones de seguridad y UI

- Control de acceso: sólo usuarios con rol `admin` deberían poder crear/editar/eliminar usuarios y asignar módulos.
- Validación: en el frontend validar formato de email y longitud mínima de password antes de enviarlo.
- No exponer hashes de contraseña en respuestas.
- Mostrar en la UI una lista de módulos con toggles (on/off). Al guardar, enviar solo las banderas cambiadas para minimizar payload.
- Al iniciar sesión, cachear el token en memoria (no en localStorage si existe riesgo XSS). Refrescar token por expiración.

Nota sobre implementación backend existente

- La ruta `GET /api/users` ya existe en `routes/users.js` y devuelve `{ id, nombre, email, rol }`.
- Actualmente no hay rutas públicas para crear usuarios ni para gestionar `usuario_modulos`. Puedo implementar las rutas CRUD para `usuario_modulos` y las rutas de gestión de usuarios si lo deseas.

SQL de ejemplo para insertar/actualizar `usuario_modulos` manualmente

```sql
-- Insertar
INSERT INTO usuario_modulos (usuario_id, dashboard, tasas_cambio, bancos, marcas, categorias, almacenes, productos, formulas, pedidos)
VALUES (42, true, false, false, false, false, true, true, false, true);

-- Actualizar
UPDATE usuario_modulos SET dashboard = true, productos = true WHERE usuario_id = 42;
```

¿Quieres que implemente las rutas backend para:

- Crear/editar/eliminar usuarios (`POST/PUT/DELETE /api/users`), y/o
- CRUD para `usuario_modulos` (`GET/POST/PUT/DELETE /api/users/:id/modulos`)?

Puedo implementar esto y añadir tests o ejemplos Postman según prefieras.
