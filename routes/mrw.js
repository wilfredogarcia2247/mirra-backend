const express = require('express');
const router = express.Router();

// POST /api/mrw/tracking
// Proxy hacia mrwve.com para rastrear guías MRW Venezuela
router.post('/tracking', async (req, res) => {
  const { nro_tracking } = req.body || {};
  if (!nro_tracking || String(nro_tracking).trim().length < 5) {
    return res.status(400).json({ error: 'Número de guía requerido (mínimo 5 caracteres)' });
  }

  try {
    const upstream = await fetch('https://mrwve.com/api/tracking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mrwve.com/',
        'Origin': 'https://mrwve.com',
      },
      body: JSON.stringify({ nro_tracking: String(nro_tracking).trim() }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstream.json();

    // Si mrwve devuelve un codigo de error → número no válido o no encontrado
    if (data.codigo) {
      return res.status(404).json({
        error: 'El número de envío no es válido o no existe en el sistema de MRW.',
        contacto: 'https://wa.me/584242566482',
        codigo: data.codigo,
      });
    }

    return res.json(data);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'MRW no respondió a tiempo. Intenta de nuevo.' });
    }
    console.error('MRW proxy error:', err.message);
    return res.status(502).json({ error: 'No se pudo conectar con MRW Venezuela.' });
  }
});

module.exports = router;
