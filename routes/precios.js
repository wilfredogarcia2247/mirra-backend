const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// GET /api/precios?producto_id=&tamano_id=
router.get('/', async (req, res) => {
  const { producto_id, tamano_id } = req.query;
  try {
    let q = sql`SELECT * FROM precio_productos`;
    if (producto_id && tamano_id) {
      q = await sql`SELECT * FROM precio_productos WHERE producto_id = ${producto_id} AND tamano_id = ${tamano_id}`;
      return res.json(q);
    }
    if (producto_id) {
      q = await sql`SELECT * FROM precio_productos WHERE producto_id = ${producto_id}`;
      return res.json(q);
    }
    if (tamano_id) {
      q = await sql`SELECT * FROM precio_productos WHERE tamano_id = ${tamano_id}`;
      return res.json(q);
    }
    const all = await sql`SELECT * FROM precio_productos`;
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:producto_id/:tamano_id', async (req, res) => {
  const { producto_id, tamano_id } = req.params;
  try {
    const row = await sql`SELECT * FROM precio_productos WHERE producto_id = ${producto_id} AND tamano_id = ${tamano_id} LIMIT 1`;
    if (!row || row.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(row[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
