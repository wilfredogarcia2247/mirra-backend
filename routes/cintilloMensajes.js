const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function validateMessage(body) {
  const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
  const orden = body.orden === undefined ? 0 : Number(body.orden);

  if (!texto || texto.length > 280) return { error: 'El texto es obligatorio y no puede superar 280 caracteres' };
  if (!Number.isInteger(orden)) return { error: 'El orden debe ser un número entero' };
  if (body.activo !== undefined && typeof body.activo !== 'boolean') return { error: 'El estado activo debe ser booleano' };

  return { texto, orden, activo: body.activo !== false };
}

router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM cintillo_mensajes ORDER BY orden ASC, id ASC`;
    return res.json(rows);
  } catch (err) {
    console.error('Error listando mensajes del cintillo:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error listando mensajes del cintillo' });
  }
});

router.post('/', async (req, res) => {
  const message = validateMessage(req.body || {});
  if (message.error) return res.status(400).json({ error: message.error });

  try {
    const rows = await sql`
      INSERT INTO cintillo_mensajes (texto, orden, activo)
      VALUES (${message.texto}, ${message.orden}, ${message.activo})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creando mensaje del cintillo:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error creando mensaje del cintillo' });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  const message = validateMessage(req.body || {});
  if (message.error) return res.status(400).json({ error: message.error });

  try {
    const rows = await sql`
      UPDATE cintillo_mensajes
      SET texto = ${message.texto}, orden = ${message.orden},
          activo = ${message.activo}, actualizado_en = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Mensaje no encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error actualizando mensaje del cintillo:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error actualizando mensaje del cintillo' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  try {
    const rows = await sql`DELETE FROM cintillo_mensajes WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Mensaje no encontrado' });
    return res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('Error eliminando mensaje del cintillo:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error eliminando mensaje del cintillo' });
  }
});

module.exports = router;