const express = require('express');
const router = express.Router();
const { obtenerResenasGoogle } = require('../services/resenasGoogle');

// Público: la página Comunidad pide la nota y las reseñas de Google Maps.
// Responde { nota, total, enlace, resumen } o null si no hay clave o Google falla.
router.get('/', async (req, res) => {
  const datos = await obtenerResenasGoogle();
  // El navegador pregunta siempre (el servidor ya guarda 6 h): así nadie se queda con datos viejos
  res.set('Cache-Control', 'no-cache');
  return res.json(datos);
});

module.exports = router;
