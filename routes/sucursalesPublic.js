const express = require('express');
const router = express.Router();
const { sql, ensureSucursalesTable } = require('../services/sucursales');

router.get('/activas', async (req, res) => {
  try {
    await ensureSucursalesTable();
    const rows = await sql`
      SELECT id, nombre, direccion
      FROM sucursales
      WHERE activa = TRUE
      ORDER BY nombre ASC, id ASC
    `;
    return res.json(rows || []);
  } catch (error) {
    console.error('Error listando sucursales activas:', error.message || error);
    return res.status(500).json({ error: 'No se pudieron cargar las sucursales' });
  }
});

module.exports = router;
