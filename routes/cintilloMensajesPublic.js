const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

router.get('/', async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, texto, orden
      FROM cintillo_mensajes
      WHERE activo = TRUE
      ORDER BY orden ASC, id ASC
    `;
    return res.json(rows);
  } catch (err) {
    console.error('Error obteniendo mensajes activos del cintillo:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error obteniendo mensajes del cintillo' });
  }
});

module.exports = router;