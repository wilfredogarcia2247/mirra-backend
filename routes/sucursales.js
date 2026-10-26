const express = require('express');
const router = express.Router();
const { sql, ensureSucursalesTable } = require('../services/sucursales');

function requireAdmin(req, res) {
  if (req.user?.rol !== 'admin') {
    res.status(403).json({ error: 'Acceso solo para administradores' });
    return false;
  }
  return true;
}

function validateBranch(body) {
  const nombre = String(body.nombre || '').trim();
  const direccion = String(body.direccion || '').trim();
  if (!nombre) return { error: 'El nombre de la sucursal es requerido' };
  if (!direccion) return { error: 'La dirección de la sucursal es requerida' };
  if (nombre.length > 160 || direccion.length > 500) {
    return { error: 'El nombre o la dirección exceden el máximo permitido' };
  }
  return { value: { nombre, direccion } };
}

router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    await ensureSucursalesTable();
    const rows = await sql`
      SELECT id, nombre, direccion, activa, creado_en, actualizado_en
      FROM sucursales
      ORDER BY activa DESC, nombre ASC, id ASC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando sucursales:', error.message || error);
    return res.status(500).json({ error: 'No se pudieron cargar las sucursales' });
  }
});

router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = validateBranch(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    await ensureSucursalesTable();
    const rows = await sql`
      INSERT INTO sucursales (nombre, direccion)
      VALUES (${result.value.nombre}, ${result.value.direccion})
      RETURNING id, nombre, direccion, activa, creado_en, actualizado_en
    `;
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creando sucursal:', error.message || error);
    return res.status(500).json({ error: 'No se pudo crear la sucursal' });
  }
});

router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de sucursal inválido' });
  const result = validateBranch(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  if (typeof req.body.activa !== 'boolean') {
    return res.status(400).json({ error: 'El estado activo de la sucursal es inválido' });
  }
  try {
    await ensureSucursalesTable();
    const rows = await sql`
      UPDATE sucursales
      SET nombre = ${result.value.nombre},
          direccion = ${result.value.direccion},
          activa = ${req.body.activa},
          actualizado_en = NOW()
      WHERE id = ${id}
      RETURNING id, nombre, direccion, activa, creado_en, actualizado_en
    `;
    if (!rows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });
    return res.json(rows[0]);
  } catch (error) {
    console.error('Error actualizando sucursal:', error.message || error);
    return res.status(500).json({ error: 'No se pudo actualizar la sucursal' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de sucursal inválido' });
  try {
    await ensureSucursalesTable();
    const rows = await sql`DELETE FROM sucursales WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando sucursal:', error.message || error);
    return res.status(500).json({ error: 'No se pudo eliminar la sucursal' });
  }
});

module.exports = router;
