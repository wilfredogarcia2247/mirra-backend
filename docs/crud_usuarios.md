# Documentación: CRUD de Usuarios

Este documento describe los endpoints disponibles para gestionar usuarios en la API, cómo usarlos desde el frontend, ejemplos curl y recomendaciones de seguridad.

Base URL: `http://<HOST>:<PORT>/api` (ej. `http://localhost:3000/api`)

Autenticación: todas las rutas requieren `Authorization: Bearer <TOKEN>` excepto `POST /api/auth/register` y `POST /api/auth/login` (ya provistas en `routes/auth.js`). Para el CRUD de usuarios, se requiere token y permisos (ver sección Permisos).

Permisos
- `GET /api/users` y `GET /api/users/:id`: cualquier usuario autenticado puede listar/consultar.
- `POST /api/users`: sólo administradores (`rol === 'admin'`).
- `PUT /api/users/:id`: el propio usuario (propietario) o admin. Sólo admin puede modificar `rol`.
- `DELETE /api/users/:id`: sólo admin.

Esquema mínimo de la tabla `usuarios` (referencia)
- `id`, `nombre`, `email`, `password` (hash), `rol` (ej. `admin` o `user`).

Rutas y ejemplos

1) Listar usuarios

- GET `/api/users`
- Respuesta (200): array de objetos `{ id, nombre, email, rol }`.

Ejemplo:
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users
```

2) Crear usuario (admin)

- POST `/api/users`
- Body (JSON):
  - `nombre` (string, requerido)
  - `email` (string, requerido)
  - `password` (string, requerido, mínimo 8 caracteres)
  - `rol` (string, opcional; por defecto `user`)
- Respuesta (201): `{ id, nombre, email, rol }`
- Errores comunes:
  - 400: datos faltantes o `email` ya registrado
  - 403: no autorizado (no admin)

Ejemplo:
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","email":"ana@ejemplo.com","password":"secret123","rol":"user"}'
```

3) Obtener un usuario

- GET `/api/users/:id`
- Respuesta (200): `{ id, nombre, email, rol }` o 404 si no existe.

Ejemplo:
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users/42
```

4) Actualizar usuario (propietario o admin)

- PUT `/api/users/:id`
- Body (JSON): campos que se desean actualizar. Posibles campos: `nombre`, `email`, `password`, `rol` (solo admin puede cambiar `rol`).
- Validaciones:
  - Si `password` se envía, debe tener mínimo 8 caracteres; se guarda hasheada (bcrypt).
  - Si `email` se actualiza, el backend valida unicidad.
- Respuesta (200): usuario actualizado `{ id, nombre, email, rol }`.
- Errores comunes:
  - 400: datos inválidos (p.ej. password corto)
  - 403: no autorizado
  - 404: usuario no encontrado

Ejemplo:
```bash
# Como el propio usuario o como admin
curl -X PUT http://localhost:3000/api/users/42 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Nuevo Nombre","password":"nuevaClave123"}'
```

5) Eliminar usuario (admin)

- DELETE `/api/users/:id`
- Respuesta (200): `{ ok: true }`.
- Errores:
  - 403: no autorizado
  - 404: no encontrado

Ejemplo:
```bash
curl -X DELETE http://localhost:3000/api/users/42 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Comportamiento interno y consideraciones técnicas
- El endpoint usa `bcryptjs` con salt rounds = 10 para hashear contraseñas antes de almacenar.
- Se valida unicidad de `email` en creación y actualización.
- Las consultas usan plantillas taggeadas del cliente SQL (`@neondatabase/serverless`) para prevenir inyección.
- `PUT` se ejecuta en transacción (`BEGIN` / `COMMIT`) y bloquea la fila (`FOR UPDATE`) para evitar condiciones de carrera.

Mensajes de error estándares (implementados en servidor)
- 400: Datos inválidos (payload inválido, password corto, email duplicado)
- 401: Token requerido / inválido (controlado por `authMiddleware` global)
- 403: Forbidden (no autorizado según rol)
- 404: No encontrado
- 500: Error interno del servidor

Recomendaciones para frontend
- No mantener contraseñas en texto plano en el cliente; solicitar y enviar solo cuando corresponda.
- En formularios de creación/edición de usuario validar email (regex básica) y longitud mínima del password.
- Mostrar errores del backend al usuario (p.ej. `email ya registrado`) de forma amigable.
- Para cambios de rol, ocultar el control a usuarios no admin y validar en el backend (ya implementado).

Comandos útiles para testing local

1) Arrancar server (si usas nodemon):
```bash
npm run dev
```

2) Crear usuario admin (si no existe) vía `auth/register` (este endpoint permite pasar `rol` en body):
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ejemplo.com","password":"admin1234","nombre":"Admin","rol":"admin"}'
```

3) Login y obtener token:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@ejemplo.com","password":"admin1234"}' | jq -r .token)
echo $TOKEN
```

Pruebas sugeridas (sanity):
- Crear usuario nuevo con `POST /api/users` usando token admin.
- Hacer `PUT /api/users/:id` como el usuario mismo para cambiar password y nombre.
- Intentar cambiar `rol` como usuario normal (debe fallar 403).
- Eliminar usuario como admin.

¿Quieres que además genere una colección Postman / Insomnia con estos endpoints y ejemplos? Puedo crearla y subirla a `docs/`.
