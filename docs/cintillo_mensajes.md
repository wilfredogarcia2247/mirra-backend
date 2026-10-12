# Mensajes del cintillo

La tabla `cintillo_mensajes` almacena el texto promocional, el orden y el estado activo de cada anuncio. Los emojis se escriben directamente dentro del texto; no requieren un campo separado.

## Aplicar la migración

Ejecuta `docs/migrations/cintillo_mensajes.sql` en la misma base PostgreSQL configurada para la API. Por ejemplo, desde la raíz de `mirra-backend`:

```bash
psql "$DATABASE_URL" -f docs/migrations/cintillo_mensajes.sql
```

No se insertan frases iniciales automáticamente. La migración conserva los emojis de una columna anterior insertándolos al inicio del texto y luego elimina esa columna. Después, crea o edita los mensajes desde el panel administrativo.

## Endpoints

- `GET /api/cintillo/activos`: devuelve los mensajes activos ordenados por `orden` e `id`; es público y de solo lectura.
- `GET /api/cintillo`: lista todos los mensajes y requiere JWT.
- `POST /api/cintillo`: crea un mensaje y requiere JWT.
- `PUT /api/cintillo/:id`: actualiza texto, emoji, orden y estado; requiere JWT.
- `DELETE /api/cintillo/:id`: elimina un mensaje y requiere JWT.

El panel está disponible en `/admin/cintillo` para usuarios con acceso al módulo de usuarios.
