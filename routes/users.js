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

// GET /api/users -> listar usuarios (id, nombre, email, rol)
router.get('/', async (req, res) => {
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

// GET /api/users/:id -> obtener usuario
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
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
    try { await sql`ROLLBACK`; } catch (e) {}
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

module.exports = router;

// --- Rutas para gestionar `usuario_modulos` ---
// Lista de módulos disponibles (metadato para el frontend)
router.get('/available-modulos', (req, res) => {
  const available = [
    'dashboard',
    'tasas_cambio',
    'bancos',
    'marcas',
    'categorias',
    'almacenes',
    'productos',
    'formulas',
    'pedidos',
  ];
  return res.json({ available_modulos: available });
});

// GET /api/users/:id/modulos -> obtener permisos (admin o propietario)
router.get('/:id/modulos', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  // permitir admin o el propio usuario
  if (!(req.user && (req.user.rol === 'admin' || Number(req.user.id) === id)))
    return res.status(403).json({ error: 'No autorizado' });
  try {
    const rows = await sql`SELECT * FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
    const available = [
      'dashboard',
      'tasas_cambio',
      'bancos',
      'marcas',
      'categorias',
      'almacenes',
      'productos',
      'formulas',
      'pedidos',
    ];
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado', available_modulos: available });
    return res.json({ modulos: rows[0], available_modulos: available });
  } catch (err) {
    console.error('Error leyendo usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error leyendo permisos' });
  }
});

// POST /api/users/:id/modulos -> upsert permisos (admin only)
router.post('/:id/modulos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const allowed = [
    'dashboard',
    'tasas_cambio',
    'bancos',
    'marcas',
    'categorias',
    'almacenes',
    'productos',
    'formulas',
    'pedidos',
  ];
  const body = req.body || {};
  // construir fila completa: si falta un flag, se asume false
  const row = { usuario_id: id };
  for (const k of allowed) row[k] = body[k] != null ? !!body[k] : false;

  try {
    // eliminar cualquier fila previa y reinsertar (upsert sencillo)
    await sql`BEGIN`;
    await sql`DELETE FROM usuario_modulos WHERE usuario_id = ${id}`;
    const inserted = await sql`
      INSERT INTO usuario_modulos (usuario_id, dashboard, tasas_cambio, bancos, marcas, categorias, almacenes, productos, formulas, pedidos, created_at, updated_at)
      VALUES (
        ${row.usuario_id}, ${row.dashboard}, ${row.tasas_cambio}, ${row.bancos}, ${row.marcas}, ${row.categorias}, ${row.almacenes}, ${row.productos}, ${row.formulas}, ${row.pedidos}, NOW(), NOW()
      ) RETURNING *
    `;
    await sql`COMMIT`;
    return res.status(201).json(inserted && inserted[0] ? inserted[0] : { ok: true });
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    console.error('Error guardando usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando permisos' });
  }
});

// PUT /api/users/:id/modulos -> reemplazo completo (admin only)
router.put('/:id/modulos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const allowed = [
    'dashboard',
    'tasas_cambio',
    'bancos',
    'marcas',
    'categorias',
    'almacenes',
    'productos',
    'formulas',
    'pedidos',
  ];
  const body = req.body || {};
  // require at least one field
  const hasAny = allowed.some((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (!hasAny) return res.status(400).json({ error: 'Nada para actualizar' });
  const row = { usuario_id: id };
  for (const k of allowed) row[k] = body[k] != null ? !!body[k] : false;
  try {
    await sql`BEGIN`;
    const exists = await sql`SELECT id FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
    if (exists && exists.length > 0) {
      await sql`
        UPDATE usuario_modulos SET
          dashboard = ${row.dashboard}, tasas_cambio = ${row.tasas_cambio}, bancos = ${row.bancos}, marcas = ${row.marcas}, categorias = ${row.categorias}, almacenes = ${row.almacenes}, productos = ${row.productos}, formulas = ${row.formulas}, pedidos = ${row.pedidos}, updated_at = NOW()
        WHERE usuario_id = ${id}
      `;
      const updated = await sql`SELECT * FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
      await sql`COMMIT`;
      return res.json(updated && updated[0] ? updated[0] : { ok: true });
    } else {
      const inserted = await sql`
        INSERT INTO usuario_modulos (usuario_id, dashboard, tasas_cambio, bancos, marcas, categorias, almacenes, productos, formulas, pedidos, created_at, updated_at)
        VALUES (${row.usuario_id}, ${row.dashboard}, ${row.tasas_cambio}, ${row.bancos}, ${row.marcas}, ${row.categorias}, ${row.almacenes}, ${row.productos}, ${row.formulas}, ${row.pedidos}, NOW(), NOW()) RETURNING *
      `;
      await sql`COMMIT`;
      return res.status(201).json(inserted && inserted[0] ? inserted[0] : { ok: true });
    }
  } catch (err) {
    try { await sql`ROLLBACK`; } catch (e) {}
    console.error('Error reemplazando usuario_modulos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando permisos' });
  }
});

// DELETE /api/users/:id/modulos -> eliminar permisos (admin only)
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


