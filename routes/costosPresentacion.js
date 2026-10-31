const express = require('express');
const router = express.Router();
const { obtenerCostos, guardarCostos } = require('../services/costosPresentacion');

// Panel: costos por tamaño (30 ml, 60 ml...) y costos especiales por perfume
router.get('/', async (req, res) => {
  try {
    return res.json(await obtenerCostos());
  } catch (err) {
    console.error('Error obteniendo costos por presentación:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error obteniendo los costos' });
  }
});

router.put('/', async (req, res) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar los costos' });
  try {
    const r = await guardarCostos(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    return res.json(r.costos);
  } catch (err) {
    console.error('Error guardando costos por presentación:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error guardando los costos' });
  }
});

module.exports = router;
