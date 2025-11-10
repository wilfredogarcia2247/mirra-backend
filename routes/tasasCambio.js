const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Listar todas las tasas de cambio
router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM tasas_cambio ORDER BY id DESC`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error listando tasas de cambio' });
  }
});

// Obtener una tasa por id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM tasas_cambio WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error obteniendo tasa' });
  }
});

// Crear una tasa
router.post('/', async (req, res) => {
  const { monto, simbolo, descripcion } = req.body;
  if (monto == null || isNaN(Number(monto)) || Number(monto) <= 0) return res.status(400).json({ error: 'Monto inválido' });
  if (!simbolo || typeof simbolo !== 'string' || simbolo.trim() === '') return res.status(400).json({ error: 'Símbolo requerido' });
  try {
    const created = await sql`
      INSERT INTO tasas_cambio (monto, simbolo, descripcion, creado_en)
      VALUES (${Number(monto)}, ${simbolo.trim()}, ${descripcion || null}, NOW()) RETURNING *
    `;
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error creando tasa' });
  }
});

// Actualizar una tasa
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { monto, simbolo, descripcion } = req.body;
  if (monto != null && (isNaN(Number(monto)) || Number(monto) <= 0)) return res.status(400).json({ error: 'Monto inválido' });
  if (simbolo != null && (typeof simbolo !== 'string' || simbolo.trim() === '')) return res.status(400).json({ error: 'Símbolo inválido' });
  try {
    const updated = await sql`
      UPDATE tasas_cambio
      SET monto = COALESCE(${monto}::numeric, monto), simbolo = COALESCE(${simbolo}, simbolo), descripcion = COALESCE(${descripcion}, descripcion), actualizado_en = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!updated || updated.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error actualizando tasa' });
  }
});

// Eliminar una tasa
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const deleted = await sql`DELETE FROM tasas_cambio WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json({ success: true, deleted: deleted[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error eliminando tasa' });
  }
});

module.exports = router;
