// "Avísame cuando llegue"
// - Público (tienda): POST /api/avisos-llegada  { producto_id, nombre, telefono }
// - Panel (con sesión): GET /api/avisos-llegada?estado=esperando|avisado|descartado
//                       PATCH /api/avisos-llegada/:id  { estado }
const express = require('express');
const { normalizarTelefono, validarNombre, crearAviso, listarAvisos, cambiarEstado } = require('../services/avisosLlegada');

// Límite simple por conexión: 10 avisos por hora
const MAX_POR_HORA = 10;
const VENTANA_MS = 60 * 60 * 1000;
const usosPorIp = new Map();
function superaLimite(ip) {
  const ahora = Date.now();
  const r = usosPorIp.get(ip);
  if (!r || ahora - r.desde > VENTANA_MS) {
    usosPorIp.set(ip, { cantidad: 1, desde: ahora });
    if (usosPorIp.size > 5000) {
      for (const [k, v] of usosPorIp) if (ahora - v.desde > VENTANA_MS) usosPorIp.delete(k);
    }
    return false;
  }
  r.cantidad += 1;
  return r.cantidad > MAX_POR_HORA;
}

async function crearAvisoPublico(req, res) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
  if (superaLimite(ip)) return res.status(429).json({ error: 'Demasiados intentos. Prueba más tarde.' });

  const body = req.body || {};
  const productoId = Number(body.producto_id);
  const nombre = validarNombre(body.nombre);
  const telefono = normalizarTelefono(body.telefono);
  if (!Number.isInteger(productoId) || productoId <= 0) return res.status(400).json({ error: 'Perfume inválido' });
  if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre' });
  if (!telefono) return res.status(400).json({ error: 'Escribe un teléfono válido, por ejemplo 0414 1234567' });

  try {
    const r = await crearAviso({ productoId, nombre, telefono });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    return res.status(r.ya_registrado ? 200 : 201).json({ ok: true, ya_registrado: r.ya_registrado });
  } catch (error) {
    console.error('[avisos-llegada] Error creando aviso:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'No pudimos guardar tu aviso. Inténtalo de nuevo.' });
  }
}

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    return res.json(await listarAvisos(String(req.query.estado || 'esperando')));
  } catch (error) {
    console.error('[avisos-llegada] Error listando:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'No se pudieron cargar los avisos' });
  }
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await cambiarEstado(id, String((req.body || {}).estado || ''));
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    return res.json(r);
  } catch (error) {
    console.error('[avisos-llegada] Error cambiando estado:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'No se pudo actualizar el aviso' });
  }
});

module.exports = router;
module.exports.crearAvisoPublico = crearAvisoPublico;
