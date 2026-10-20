const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const TIPOS_COLABORADOR = new Set(['trabajador', 'influencer', 'colaborador']);

function parseOptionalId(value) {
  if (value === '' || value == null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

function validateColaborador(body) {
  if (!String(body.nombre || '').trim()) return 'El nombre del colaborador es requerido';
  if (!TIPOS_COLABORADOR.has(body.tipo)) return 'Tipo de colaborador inválido';
  return null;
}

function validateCupon(body) {
  const codigo = String(body.codigo || '').trim();
  const descuento = Number(body.descuento_porcentaje);
  if (!codigo) return 'El código del cupón es requerido';
  if (!Number.isFinite(descuento) || descuento <= 0 || descuento > 100) {
    return 'El descuento debe ser mayor que 0 y menor o igual a 100';
  }
  const colaboradorId = parseOptionalId(body.colaborador_id);
  if (Number.isNaN(colaboradorId)) return 'Colaborador inválido';
  const usoMaximo = body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo);
  if (usoMaximo !== null && (!Number.isInteger(usoMaximo) || usoMaximo < 1)) {
    return 'El uso máximo debe ser un entero positivo o ilimitado';
  }
  if (body.fecha_inicio && Number.isNaN(Date.parse(body.fecha_inicio))) return 'Fecha de inicio inválida';
  if (body.fecha_fin && Number.isNaN(Date.parse(body.fecha_fin))) return 'Fecha de fin inválida';
  if (body.fecha_inicio && body.fecha_fin && Date.parse(body.fecha_fin) < Date.parse(body.fecha_inicio)) {
    return 'La fecha fin no puede ser anterior a la fecha inicio';
  }
  return null;
}

router.get('/colaboradores', async (req, res) => {
  try {
    const rows = await sql`
      SELECT c.*, u.nombre AS usuario_nombre
      FROM colaboradores c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.activo DESC, c.nombre ASC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando colaboradores:', error.message || error);
    return res.status(500).json({ error: 'Error listando colaboradores' });
  }
});

router.post('/colaboradores', async (req, res) => {
  const error = validateColaborador(req.body || {});
  if (error) return res.status(400).json({ error });
  const body = req.body || {};
  const usuarioId = parseOptionalId(body.usuario_id);
  if (Number.isNaN(usuarioId)) return res.status(400).json({ error: 'Usuario inválido' });
  try {
    const rows = await sql`
      INSERT INTO colaboradores (nombre, telefono, email, instagram, tiktok, youtube, tipo, usuario_id, observaciones, activo)
      VALUES (${String(body.nombre).trim()}, ${body.telefono || null}, ${body.email || null}, ${body.instagram || null}, ${body.tiktok || null}, ${body.youtube || null}, ${body.tipo}, ${usuarioId}, ${body.observaciones || null}, ${body.activo !== false ? 1 : 0})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error creando colaborador' });
  }
});

router.put('/colaboradores/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  const error = validateColaborador(req.body || {});
  if (error) return res.status(400).json({ error });
  const body = req.body || {};
  const usuarioId = parseOptionalId(body.usuario_id);
  if (Number.isNaN(usuarioId)) return res.status(400).json({ error: 'Usuario inválido' });
  try {
    const rows = await sql`
      UPDATE colaboradores SET nombre = ${String(body.nombre).trim()}, telefono = ${body.telefono || null}, email = ${body.email || null}, instagram = ${body.instagram || null}, tiktok = ${body.tiktok || null}, youtube = ${body.youtube || null}, tipo = ${body.tipo}, usuario_id = ${usuarioId}, observaciones = ${body.observaciones || null}, activo = ${body.activo !== false ? 1 : 0}, actualizado_en = NOW()
      WHERE id = ${id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Colaborador no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando colaborador' });
  }
});

router.patch('/colaboradores/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`UPDATE colaboradores SET activo = ${req.body?.activo === true ? 1 : 0}, actualizado_en = NOW() WHERE id = ${id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Colaborador no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando estado del colaborador:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando colaborador' });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await sql`
      SELECT c.*,
             COALESCE(cu.usos, 0)::int AS usos_registrados,
             COALESCE(cu.descuento_total, 0)::numeric AS descuento_total,
             col.nombre AS colaborador_nombre
      FROM cupones c
      LEFT JOIN colaboradores col ON col.id = c.colaborador_id
      LEFT JOIN (
        SELECT cupon_id,
               COUNT(*)::int AS usos,
               COALESCE(SUM(descuento_aplicado), 0)::numeric AS descuento_total
        FROM cupon_usos GROUP BY cupon_id
      ) cu ON cu.cupon_id = c.id
      ORDER BY c.creado_en DESC, c.id DESC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando cupones:', error.message || error);
    return res.status(500).json({ error: 'Error listando cupones' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const error = validateCupon(body);
  if (error) return res.status(400).json({ error });
  try {
    const rows = await sql`
      INSERT INTO cupones (codigo, descuento_porcentaje, colaborador_id, descripcion, fecha_inicio, fecha_fin, uso_maximo, activo, es_global)
      VALUES (${String(body.codigo).trim().toUpperCase()}, ${Number(body.descuento_porcentaje)}, ${parseOptionalId(body.colaborador_id)}, ${body.descripcion || null}, COALESCE(${body.fecha_inicio || null}::timestamptz, NOW()), ${body.fecha_fin || null}, ${body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo)}, ${body.activo !== false ? 1 : 0}, ${body.es_global === true ? 1 : 0})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('cupones_codigo_key')) return res.status(409).json({ error: 'Ya existe un cupón con ese código' });
    console.error('Error creando cupón:', err.message || err);
    return res.status(500).json({ error: 'Error creando cupón' });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  const body = req.body || {};
  const error = validateCupon(body);
  if (error) return res.status(400).json({ error });
  try {
    const rows = await sql`
      UPDATE cupones SET codigo = ${String(body.codigo).trim().toUpperCase()}, descuento_porcentaje = ${Number(body.descuento_porcentaje)}, colaborador_id = ${parseOptionalId(body.colaborador_id)}, descripcion = ${body.descripcion || null}, fecha_inicio = COALESCE(${body.fecha_inicio || null}::timestamptz, NOW()), fecha_fin = ${body.fecha_fin || null}, uso_maximo = ${body.uso_maximo === '' || body.uso_maximo == null ? null : Number(body.uso_maximo)}, activo = ${body.activo !== false ? 1 : 0}, es_global = ${body.es_global === true ? 1 : 0}, actualizado_en = NOW()
      WHERE id = ${id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Cupón no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('cupones_codigo_key')) return res.status(409).json({ error: 'Ya existe un cupón con ese código' });
    console.error('Error actualizando cupón:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando cupón' });
  }
});

router.patch('/:id/estado', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`UPDATE cupones SET activo = ${req.body?.activo === true ? 1 : 0}, actualizado_en = NOW() WHERE id = ${id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Cupón no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando estado del cupón:', err.message || err);
    return res.status(500).json({ error: 'Error actualizando cupón' });
  }
});

router.get('/:id/usos', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`
      SELECT cu.*, pv.nombre_cliente, pv.fecha AS pedido_fecha
      FROM cupon_usos cu
      LEFT JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
      WHERE cu.cupon_id = ${id}
      ORDER BY cu.usado_en DESC
    `;
    return res.json(rows || []);
  } catch (err) {
    console.error('Error consultando usos de cupón:', err.message || err);
    return res.status(500).json({ error: 'Error consultando usos del cupón' });
  }
});

module.exports = router;