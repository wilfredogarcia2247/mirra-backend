const express = require('express');
const router = express.Router();
const {
  obtenerConfigDescuentoMayor,
  guardarConfigDescuentoMayor,
} = require('../services/descuentoMayor');

// Panel: ver y cambiar las reglas del descuento al mayor
router.get('/', async (req, res) => {
  try {
    return res.json(await obtenerConfigDescuentoMayor());
  } catch (err) {
    console.error('Error obteniendo descuento al mayor:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error obteniendo el descuento al mayor' });
  }
});

router.put('/', async (req, res) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar el descuento al mayor' });
  try {
    const resultado = await guardarConfigDescuentoMayor(req.body || {});
    if (resultado.error) return res.status(400).json({ error: resultado.error });
    return res.json(resultado.config);
  } catch (err) {
    console.error('Error guardando descuento al mayor:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando el descuento al mayor' });
  }
});

module.exports = router;
