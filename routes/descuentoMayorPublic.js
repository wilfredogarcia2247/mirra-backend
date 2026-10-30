const express = require('express');
const router = express.Router();
const { obtenerConfigDescuentoMayor } = require('../services/descuentoMayor');

// Reglas del descuento al mayor para el carrito de la tienda (sin autenticación).
// El carrito solo muestra el cálculo; el que manda es el servidor al crear el pedido.
router.get('/', async (req, res) => {
  try {
    const config = await obtenerConfigDescuentoMayor();
    return res.json({ activo: config.activo, niveles: config.niveles, tamanos_ml: config.tamanos_ml });
  } catch (err) {
    console.error('Error obteniendo descuento al mayor:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error obteniendo el descuento al mayor' });
  }
});

module.exports = router;
