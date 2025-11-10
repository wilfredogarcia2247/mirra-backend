const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Público: obtener la tasa activa (si existe)
router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM tasas_cambio WHERE activo = TRUE ORDER BY id DESC LIMIT 1`;
    if (!rows || rows.length === 0) return res.status(200).json({ active: null, message: 'No hay tasa activa' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Error obteniendo tasa activa:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error obteniendo tasa activa' });
  }
});

module.exports = router;
