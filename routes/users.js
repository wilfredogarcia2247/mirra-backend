const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// GET /api/users -> listar usuarios (id, nombre, email, rol)
router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT id, nombre, email, rol FROM usuarios ORDER BY id DESC`;
    return res.json(rows || []);
  } catch (err) {
    console.error('Error listando usuarios:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error listando usuarios' });
  }
});

module.exports = router;
