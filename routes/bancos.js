const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validarBanco(body) {
  if (!body.nombre || typeof body.nombre !== 'string') return 'Nombre requerido';
  return null;
}

router.get('/', async (req, res) => {
  try {
    const result = await sql`SELECT * FROM bancos`;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const error = validarBanco(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre } = req.body;
    const result = await sql`INSERT INTO bancos (nombre) VALUES (${nombre}) RETURNING *`;
    res.status(201).json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const rows = await sql`SELECT * FROM bancos WHERE id = ${id}`;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Banco no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const error = validarBanco(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { nombre } = req.body;
    const updated = await sql`UPDATE bancos SET nombre = ${nombre} WHERE id = ${id} RETURNING *`;
    if (!updated || updated.length === 0) return res.status(404).json({ error: 'Banco no encontrado' });
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Verificar uso en cliente_bancos
    const refs = await sql`SELECT COUNT(*)::int AS c FROM cliente_bancos WHERE banco_id = ${id}`;
    const count = (refs && refs[0] && Number(refs[0].c)) || 0;
    if (count > 0) return res.status(400).json({ error: 'No se puede eliminar: banco asociado a clientes' });
    const deleted = await sql`DELETE FROM bancos WHERE id = ${id} RETURNING *`;
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'Banco no encontrado' });
    res.json({ success: true, banco: deleted[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
