const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const bcrypt = require('bcryptjs');
const { columnaPermiso, permisosDesdeColumnas, valoresPermisos } = require('../services/permisosColumnas');
const { MODULOS, MODULOS_KEYS, PERMISOS_VERSION, asegurarUsuarioModulos } = require('../services/usuarioModulos');

// Helper: verificar rol admin
function requireAdmin(req, res) {
  if (!req.user || req.user.rol !== 'admin') {
    res.status(403).json({ error: 'Acción permitida sólo para administradores' });
    return false;
  }
  return true;
}

// Helper: el admin o el propio usuario (para leer sus datos y sus módulos)
function requireAdminOrSelf(req, res, id) {
  if (!req.user || (req.user.rol !== 'admin' && Number(req.user.id) !== id)) {
    res.status(403).json({ error: 'No autorizado' });
    return false;
  }
  return true;
}

// GET /api/users -> listar usuarios (id, nombre, email, rol)
router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await sql`SELECT id, nombre, email, rol FROM usuarios ORDER BY id DESC`;
    return res.json(rows || []);
  } catch (err) {
    console.error('Error listando usuarios:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error listando usuarios' });
  }
});

// POST /api/users -> crear usuario (admin only)
router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password) return res.status(400).json({ error: 'nombre, email y password son requeridos' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'password mínimo 8 caracteres' });
  try {
    const exists = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`;
    if (exists && exists.length > 0) return res.status(400).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const inserted = await sql`INSERT INTO usuarios (nombre, email, password, rol) VALUES (${nombre}, ${email}, ${hash}, ${rol || 'user'}) RETURNING id, nombre, email, rol`;
    return res.status(201).json(inserted && inserted[0] ? inserted[0] : { ok: true });
  } catch (err) {
    console.error('Error creando usuario:', err);
    return res.status(500).json({ error: 'Error creando usuario' });
  }
});

// Lista de módulos disponibles, agrupados por categoría (para la pantalla de Usuarios).
// Va antes de '/:id' para que esa ruta no la tape.
router.get('/available-modulos', (req, res) => {
  return res.json({ available_modulos: MODULOS_KEYS, grupos: MODULOS });
});

// GET /api/users/:id -> obtener usuario
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (!requireAdminOrSelf(req, res, id)) return;
  try {
    const rows = await sql`SELECT id, nombre, email, rol FROM usuarios WHERE id = ${id} LIMIT 1`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error obteniendo usuario:', err);
    return res.status(500).json({ error: 'Error obteniendo usuario' });
  }
});

// PUT /api/users/:id -> actualizar usuario (admin o el mismo usuario)
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  // Permitir al admin o al propio usuario
  if (!(req.user && (req.user.rol === 'admin' || Number(req.user.id) === id))) return res.status(403).json({ error: 'No autorizado' });
  const { nombre, email, password, rol } = req.body || {};
  if (password && (typeof password !== 'string' || password.length < 8)) return res.status(400).json({ error: 'password mínimo 8 caracteres' });
  try {
    await sql`BEGIN`;
    const userRows = await sql`SELECT * FROM usuarios WHERE id = ${id} FOR UPDATE`;
    if (!userRows || userRows.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (nombre) {
      await sql`UPDATE usuarios SET nombre = ${nombre} WHERE id = ${id}`;
    }
    if (email) {
      // verificar unico
      const exists = await sql`SELECT id FROM usuarios WHERE email = ${email} AND id != ${id} LIMIT 1`;
      if (exists && exists.length > 0) {
        await sql`ROLLBACK`;
        return res.status(400).json({ error: 'Email ya en uso por otro usuario' });
      }
      await sql`UPDATE usuarios SET email = ${email} WHERE id = ${id}`;
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await sql`UPDATE usuarios SET password = ${hash} WHERE id = ${id}`;
    }
    if (rol && req.user.rol === 'admin') {
      await sql`UPDATE usuarios SET rol = ${rol} WHERE id = ${id}`;
    }
    const updated = await sql`SELECT id, nombre, email, rol FROM usuarios WHERE id = ${id}`;
    await sql`COMMIT`;
    return res.json(updated && updated[0] ? updated[0] : { ok: true });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) { }
    console.error('Error actualizando usuario:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error actualizando usuario' });
  }
});

// DELETE /api/users/:id -> eliminar usuario (admin only)
router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await sql`DELETE FROM usuarios WHERE id = ${id}`;
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    return res.status(500).json({ error: 'Error eliminando usuario' });
  }
});

// Respuesta al guardar: la fila y la lista de pantallas habilitadas
function respuestaPermisos(row) {
  const permisos = permisosDesdeColumnas(row, MODULOS_KEYS);
  return { ...(row || {}), permisos, modulos: Object.keys(permisos) };
}

// Normaliza el cuerpo recibido a { key: true } solo para keys válidas
function leerPermisos(body) {
  const src = (body && (body.modulos !== undefined ? body.modulos : body)) || {};
  const out = {};
  if (Array.isArray(src)) {
    for (const k of src) if (MODULOS_KEYS.includes(k)) out[k] = true;
  } else if (src && typeof src === 'object') {
    for (const k of MODULOS_KEYS) if (src[k]) out[k] = true;
  }
  return out;
}

async function guardarPermisos(usuarioId, permisos) {
  const columnas = MODULOS_KEYS.map((key) => `"${columnaPermiso(key)}"`);
  const columnasInsert = ['usuario_id', ...columnas, 'permisos_version', 'created_at', 'updated_at'];
  const valores = [usuarioId, ...valoresPermisos(permisos, MODULOS_KEYS), PERMISOS_VERSION];
  const placeholders = valores.map((_, index) => `$${index + 1}`);
  const actualizaciones = columnas
    .map((columna) => `${columna} = EXCLUDED.${columna}`)
    .concat('permisos_version = EXCLUDED.permisos_version', 'updated_at = NOW()');

  return sql.query(
    `INSERT INTO usuario_modulos (${columnasInsert.join(', ')})
     VALUES (${placeholders.join(', ')}, NOW(), NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET ${actualizaciones.join(', ')}
     RETURNING *`,
    valores,
  );
}


// GET /api/users/:id/modulos -> obtener módulos habilitados para un usuario
router.get('/:id/modulos', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (!requireAdminOrSelf(req, res, id)) return;

  try {
    await asegurarUsuarioModulos();
    const rows = await sql`SELECT * FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
    const permisos = permisosDesdeColumnas(rows && rows[0], MODULOS_KEYS);
    const modulosHabilitados = Object.keys(permisos);
    return res.json({ modulos: modulosHabilitados, available_modulos: MODULOS_KEYS, grupos: MODULOS });
  } catch (err) {
    console.error('Error leyendo usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error leyendo permisos' });
  }
});

// POST /api/users/:id/modulos -> upsert permisos
router.post('/:id/modulos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const permisos = leerPermisos(req.body);
  try {
    await asegurarUsuarioModulos();
    const saved = await guardarPermisos(id, permisos);
    return res.status(201).json(respuestaPermisos(saved && saved[0]));
  } catch (err) {
    console.error('Error guardando usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando permisos' });
  }
});

// PUT /api/users/:id/modulos -> reemplazo completo
router.put('/:id/modulos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const permisos = leerPermisos(req.body);
  try {
    await asegurarUsuarioModulos();
    const saved = await guardarPermisos(id, permisos);
    return res.json(respuestaPermisos(saved && saved[0]));
  } catch (err) {
    console.error('Error reemplazando usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando permisos' });
  }
});

// DELETE /api/users/:id/modulos -> eliminar permisos
router.delete('/:id/modulos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await sql`DELETE FROM usuario_modulos WHERE usuario_id = ${id}`;
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error eliminando permisos' });
  }
});

module.exports = router;


