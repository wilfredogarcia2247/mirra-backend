const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const bcrypt = require('bcryptjs');

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

// --- Permisos por pantalla (usuario_modulos) ---
// Fuente única: cada grupo (categoría) con sus pantallas. Para agregar un permiso
// nuevo en el futuro, basta con añadirlo aquí y usar su `key` en el frontend.
const MODULOS = [
  { grupo: 'General', items: [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'reportes', label: 'Reportes' },
  ] },
  { grupo: 'Catálogo', items: [
    { key: 'marcas', label: 'Marcas' },
    { key: 'categorias', label: 'Categorías' },
    { key: 'productos', label: 'Productos' },
    { key: 'formulas', label: 'Fórmulas' },
  ] },
  { grupo: 'Operaciones', items: [
    { key: 'pedidos', label: 'Pedidos' },
    { key: 'almacenes', label: 'Almacenes' },
    { key: 'produccion', label: 'Producción' },
  ] },
  { grupo: 'Finanzas', items: [
    { key: 'tasas_cambio', label: 'Tasas de cambio' },
    { key: 'bancos', label: 'Bancos' },
    { key: 'pagos', label: 'Pagos' },
  ] },
  { grupo: 'Marketing', items: [
    { key: 'destacados', label: 'Destacados' },
    { key: 'cupones', label: 'Cupones' },
    { key: 'descuento_mayor', label: 'Descuento al mayor' },
    { key: 'avisos', label: 'Clientes esperando' },
  ] },
  { grupo: 'Sistema', items: [
    { key: 'usuarios', label: 'Usuarios' },
    { key: 'cintillo', label: 'Cintillo' },
    { key: 'sucursales', label: 'Sucursales' },
  ] },
];
const MODULOS_KEYS = MODULOS.flatMap((g) => g.items.map((i) => i.key));
// Columnas booleanas del diseño viejo (para migrar una sola vez a la columna `permisos`)
const MODULOS_VIEJOS = ['dashboard', 'tasas_cambio', 'bancos', 'marcas', 'categorias', 'almacenes', 'productos', 'formulas', 'pedidos', 'usuarios'];
// Qué pantallas nuevas abría antes cada permiso viejo (se reparten una sola vez)
const PERMISOS_DERIVADOS = {
  dashboard: ['reportes'],
  almacenes: ['produccion'],
  usuarios: ['destacados', 'cupones', 'descuento_mayor', 'avisos', 'cintillo', 'sucursales'],
};

let _aseguradoModulos = false;
async function asegurarUsuarioModulos() {
  if (_aseguradoModulos) return;
  await sql`CREATE TABLE IF NOT EXISTS usuario_modulos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER UNIQUE,
    permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`ALTER TABLE usuario_modulos ADD COLUMN IF NOT EXISTS permisos jsonb NOT NULL DEFAULT '{}'::jsonb`;
  // Migrar una sola vez: pasar las columnas booleanas viejas al JSON `permisos`
  try {
    const rows = await sql`SELECT * FROM usuario_modulos WHERE permisos = '{}'::jsonb OR permisos IS NULL`;
    for (const r of rows) {
      const p = {};
      for (const k of MODULOS_VIEJOS) if (r[k] === true) p[k] = true;
      if (Object.keys(p).length > 0) {
        await sql`UPDATE usuario_modulos SET permisos = ${JSON.stringify(p)}::jsonb WHERE usuario_id = ${r.usuario_id}`;
      }
    }
  } catch (e) {
    // Si no existen las columnas viejas, no hay nada que migrar
  }
  // Repartir una sola vez las pantallas nuevas según los permisos que ya tenía cada uno,
  // para que nadie pierda lo que usaba (antes Reportes iba con Dashboard, Producción con
  // Almacenes, y Marketing/Cintillo/Sucursales con Usuarios). permisos_version = 2: ya hecho.
  await sql`ALTER TABLE usuario_modulos ADD COLUMN IF NOT EXISTS permisos_version INTEGER NOT NULL DEFAULT 1`;
  const pendientes = await sql`SELECT usuario_id, permisos FROM usuario_modulos WHERE permisos_version < 2`;
  for (const r of pendientes) {
    const p = { ...(r.permisos || {}) };
    for (const [viejo, nuevos] of Object.entries(PERMISOS_DERIVADOS)) {
      if (p[viejo] === true) for (const k of nuevos) p[k] = true;
    }
    await sql`UPDATE usuario_modulos SET permisos = ${JSON.stringify(p)}::jsonb, permisos_version = 2
              WHERE usuario_id = ${r.usuario_id}`;
  }
  _aseguradoModulos = true;
}

// Respuesta al guardar: la fila y la lista de pantallas habilitadas
function respuestaPermisos(row) {
  const permisos = (row && row.permisos) || {};
  return { ...(row || {}), modulos: MODULOS_KEYS.filter((k) => permisos[k] === true) };
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


// GET /api/users/:id/modulos -> obtener módulos habilitados para un usuario
router.get('/:id/modulos', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (!requireAdminOrSelf(req, res, id)) return;

  try {
    await asegurarUsuarioModulos();
    const rows = await sql`SELECT permisos FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
    const permisos = (rows && rows[0] && rows[0].permisos) || {};
    const modulosHabilitados = MODULOS_KEYS.filter((k) => permisos[k] === true);
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
    // eliminar cualquier fila previa y reinsertar (upsert sencillo)
    await sql`DELETE FROM usuario_modulos WHERE usuario_id = ${id}`;
    const inserted = await sql`
      INSERT INTO usuario_modulos (usuario_id, permisos, permisos_version, created_at, updated_at)
      VALUES (${id}, ${JSON.stringify(permisos)}::jsonb, 2, NOW(), NOW()) RETURNING *
    `;
    return res.status(201).json(respuestaPermisos(inserted && inserted[0]));
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
    await sql`DELETE FROM usuario_modulos WHERE usuario_id = ${id}`;
    const inserted = await sql`
      INSERT INTO usuario_modulos (usuario_id, permisos, permisos_version, created_at, updated_at)
      VALUES (${id}, ${JSON.stringify(permisos)}::jsonb, 2, NOW(), NOW()) RETURNING *
    `;
    return res.json(respuestaPermisos(inserted && inserted[0]));
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


