// Endpoint `/api/tamanos` removido del API.
// Este archivo queda como stub para indicar que la ruta fue eliminada.
const express = require('express');
const router = express.Router();

router.use((req, res) => {
  res.status(410).json({ error: 'El endpoint /api/tamanos fue removido. Use /api/formulas para presentaciones.' });
});

module.exports = router;
