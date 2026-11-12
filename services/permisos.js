// Revisa en el servidor los permisos por pantalla (usuario_modulos.permisos).
// El admin pasa siempre; los demás solo si tienen la clave marcada.
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function tienePermiso(user, clave) {
  if (!user) return false;
  if (String(user.rol || '').toLowerCase() === 'admin') return true;
  const id = Number(user.id);
  if (!Number.isFinite(id)) return false;
  try {
    const rows = await sql`SELECT permisos FROM usuario_modulos WHERE usuario_id = ${id} LIMIT 1`;
    const permisos = (rows && rows[0] && rows[0].permisos) || {};
    return permisos[clave] === true;
  } catch (e) {
    return false; // sin tabla o sin columna: sin permiso
  }
}

// Middleware: corta con 403 si el usuario no tiene la clave
function requierePermiso(clave) {
  return async (req, res, next) => {
    if (await tienePermiso(req.user, clave)) return next();
    return res.status(403).json({ error: 'No tienes permiso para ver este reporte' });
  };
}

module.exports = { tienePermiso, requierePermiso };
