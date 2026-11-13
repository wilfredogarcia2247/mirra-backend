const express = require('express');
const router = express.Router();
const { obtenerResenasGoogle } = require('../services/resenasGoogle');

// Público: la página Comunidad pide la nota y las reseñas de Google Maps.
// Responde { nota, total, enlace, resumen } o null si no hay clave o Google falla.
router.get('/', async (req, res) => {
  const datos = await obtenerResenasGoogle();
  res.set('Cache-Control', 'public, max-age=1800');
  return res.json(datos);
});

module.exports = router;
