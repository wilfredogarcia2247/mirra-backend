// Alertas del panel (requiere sesión del personal)
const express = require('express');
const { getEstadoEsencias } = require('../services/esenciasAlerta');

const router = express.Router();

// GET /api/alertas/esencias -> esencias por acabarse (con rotación) y perfumes agotados
router.get('/esencias', async (req, res) => {
  try {
    const data = await getEstadoEsencias();
    return res.json(data);
  } catch (error) {
    console.error('[alertas] Error calculando esencias bajas:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'No se pudieron calcular las alertas de esencias' });
  }
});

module.exports = router;
