const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Sin clave de respaldo: si falta JWT_SECRET no se firman pases (antes usaba 'supersecreto').
const JWT_SECRET = process.env.JWT_SECRET;

// El registro público (/register) permitía a cualquiera crearse un admin.
// Ahora solo existe al correr las pruebas automáticas (Jest pone NODE_ENV=test).
// En el día a día los usuarios se crean desde el panel (POST /api/users, solo admin).
if (process.env.NODE_ENV === 'test') {
  router.post('/register', async (req, res) => {
    const { email, password, nombre, rol } = req.body || {};
    if (!email || !password || !nombre || !rol)
      return res.status(400).json({ error: 'Datos requeridos' });
    try {
      const existe = await sql`SELECT id FROM usuarios WHERE email = ${email}`;
      if (existe.length > 0) return res.status(400).json({ error: 'Email ya registrado' });
      const hash = await bcrypt.hash(password, 10);
      const result = await sql`
        INSERT INTO usuarios (nombre, email, password, rol)
        VALUES (${nombre}, ${email}, ${hash}, ${rol}) RETURNING id
      `;
      res.status(201).json({ mensaje: 'Usuario registrado', id: result[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Límite de intentos fallidos por conexión: 10 fallos en 15 minutos -> espera.
const MAX_FALLOS = 10;
const VENTANA_MS = 15 * 60 * 1000;
const fallosPorIp = new Map();

function ipDe(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || (req.connection && req.connection.remoteAddress) || 'desconocida';
}

function estaBloqueada(ip) {
  const r = fallosPorIp.get(ip);
  if (!r) return false;
  if (Date.now() - r.desde > VENTANA_MS) {
    fallosPorIp.delete(ip);
    return false;
  }
  return r.cantidad >= MAX_FALLOS;
}

function registrarFallo(ip) {
  const ahora = Date.now();
  const r = fallosPorIp.get(ip);
  if (!r || ahora - r.desde > VENTANA_MS) fallosPorIp.set(ip, { cantidad: 1, desde: ahora });
  else r.cantidad += 1;
  // Limpieza simple para que el mapa no crezca sin límite
  if (fallosPorIp.size > 5000) {
    for (const [k, v] of fallosPorIp) if (ahora - v.desde > VENTANA_MS) fallosPorIp.delete(k);
  }
}

const MENSAJE_FALLO = 'Correo o contraseña incorrectos';

// Login usando tabla usuarios
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Datos requeridos' });

  const ip = ipDe(req);
  if (estaBloqueada(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' });
  }
  if (!JWT_SECRET) {
    console.error('[auth] Falta JWT_SECRET en la configuración; no se puede iniciar sesión.');
    return res.status(500).json({ error: 'El servidor no está configurado para iniciar sesión' });
  }

  try {
    const usuarios = await sql`SELECT * FROM usuarios WHERE email = ${email}`;
    const usuario = usuarios[0];
    const valido = usuario ? await bcrypt.compare(password, usuario.password) : false;
    if (!valido) {
      registrarFallo(ip);
      return res.status(401).json({ error: MENSAJE_FALLO });
    }
    fallosPorIp.delete(ip);
    const token = jwt.sign({ id: usuario.id, email: usuario.email, rol: usuario.rol }, JWT_SECRET, {
      expiresIn: '2h',
    });
    res.json({ token });
  } catch (err) {
    console.error('[auth] Error en login:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

module.exports = router;
