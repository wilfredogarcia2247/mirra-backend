const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// GET /api/precios?producto_id=
// Nota: los parámetros relacionados con 'tamano' fueron removidos. Si se necesita precio por fórmula, consulte la tabla `formulas`.
router.get('/', async (req, res) => {
  const { producto_id, tamano_id } = req.query;
  if (tamano_id != null) return res.status(400).json({ error: 'Parámetro tamano_id no soportado' });
  try {
    if (producto_id) {
      const q = await sql`SELECT * FROM precio_productos WHERE producto_id = ${producto_id}`;
      return res.json(q);
    }
    const all = await sql`SELECT * FROM precio_productos`;
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:producto_id/:tamano_id', async (req, res) => {
  // Esta ruta mantenida por compatibilidad, pero el parámetro tamano no es soportado.
  return res.status(400).json({ error: 'Ruta de precio por tamano no soportada, use /api/precios?producto_id=' });
});

module.exports = router;
