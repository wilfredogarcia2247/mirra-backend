// Descuento al mayor: porcentaje automático según cuántos perfumes grandes lleva el pedido.
// Solo cuentan las presentaciones configuradas (por defecto 30, 50, 60 y 100 ml; los de 7 ml no),
// y el descuento se calcula solo sobre esos perfumes.
// Las reglas se editan en el panel (Configuración → Descuento al mayor) y se guardan en
// `descuento_mayor_config` (una sola fila). Si la fila no existe se usan las reglas por defecto.
//
// Con un cupón se aplica solo el descuento mayor de los dos: nunca se suman.

const { neon } = require('@neondatabase/serverless');

let sqlClient = null;
function sql(...args) {
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient(...args);
}

const CONFIG_POR_DEFECTO = Object.freeze({
  activo: true,
  niveles: [
    { desde: 4, porcentaje: 10 },
    { desde: 24, porcentaje: 15 },
  ],
  tamanos_ml: [30, 50, 60, 100],
});

const MAX_NIVELES = 6;
const MIN_ML_MAYOR = 30;

function redondear(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// "LATTAFA ASAD Presentación 100 ml" -> 100
function mlDe(nombre) {
  const m = /(\d+(?:[.,]\d+)?)\s*ml\b/i.exec(String(nombre || ''));
  if (!m) return null;
  const ml = Number(m[1].replace(',', '.'));
  return Number.isFinite(ml) ? ml : null;
}

/**
 * Valida y ordena la configuración que llega del panel.
 * Devuelve { config } o { error } con un mensaje para mostrar.
 */
function normalizarConfig(entrada) {
  const e = entrada || {};
  if (typeof e.activo !== 'boolean') return { error: 'Indica si el descuento al mayor está activo' };

  if (!Array.isArray(e.niveles) || e.niveles.length === 0) return { error: 'Agrega al menos un nivel de descuento' };
  if (e.niveles.length > MAX_NIVELES) return { error: `Máximo ${MAX_NIVELES} niveles` };
  const niveles = [];
  for (const nivel of e.niveles) {
    const desde = Number(nivel?.desde);
    const porcentaje = Number(nivel?.porcentaje);
    if (!Number.isInteger(desde) || desde < 2 || desde > 9999) {
      return { error: 'La cantidad de perfumes de cada nivel debe ser un número entero desde 2' };
    }
    if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 90) {
      return { error: 'El porcentaje de cada nivel debe estar entre 0,01 y 90' };
    }
    niveles.push({ desde, porcentaje: redondear(porcentaje) });
  }
  niveles.sort((a, b) => a.desde - b.desde);
  for (let i = 1; i < niveles.length; i += 1) {
    if (niveles[i].desde === niveles[i - 1].desde) return { error: 'Dos niveles no pueden empezar en la misma cantidad' };
    if (niveles[i].porcentaje <= niveles[i - 1].porcentaje) {
      return { error: 'Cada nivel debe dar más descuento que el anterior' };
    }
  }

  if (!Array.isArray(e.tamanos_ml) || e.tamanos_ml.length === 0) return { error: 'Elige al menos un tamaño que cuente' };
  const tamanos = [];
  for (const t of e.tamanos_ml) {
    const ml = Number(t);
    if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) return { error: 'Los tamaños deben ser mililitros válidos' };
    // Los de 7 ml (y cualquier muestra pequeña) nunca entran en el descuento al mayor
    if (ml < MIN_ML_MAYOR) return { error: `Los perfumes de menos de ${MIN_ML_MAYOR} ml no entran en el descuento al mayor` };
    if (!tamanos.includes(ml)) tamanos.push(ml);
  }
  tamanos.sort((a, b) => a - b);

  return { config: { activo: e.activo, niveles, tamanos_ml: tamanos } };
}

/**
 * Calcula el descuento al mayor de un conjunto de líneas.
 * lineas: [{ cantidad, precio, nombre }] (nombre = nombre de la presentación, con los ml)
 * Devuelve unidades que cuentan, base (subtotal de esas unidades), porcentaje, descuento
 * y el siguiente nivel (para el mensaje "te faltan N perfumes").
 */
function calcularDescuentoMayor(lineas, config) {
  const cfg = config || CONFIG_POR_DEFECTO;
  const tamanos = new Set((cfg.tamanos_ml || []).map(Number));
  let unidades = 0;
  let base = 0;
  for (const linea of Array.isArray(lineas) ? lineas : []) {
    const ml = mlDe(linea?.nombre);
    if (ml == null || !tamanos.has(ml)) continue;
    const cantidad = Number(linea?.cantidad);
    const precio = Number(linea?.precio);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    unidades += cantidad;
    base += cantidad * (Number.isFinite(precio) && precio > 0 ? precio : 0);
  }
  base = redondear(base);

  const niveles = cfg.activo ? [...(cfg.niveles || [])].sort((a, b) => a.desde - b.desde) : [];
  let actual = null;
  let siguiente = null;
  for (const nivel of niveles) {
    if (unidades >= nivel.desde) actual = nivel;
    else if (!siguiente) siguiente = nivel;
  }
  const porcentaje = actual ? Number(actual.porcentaje) : 0;
  return {
    unidades,
    base,
    porcentaje,
    descuento: porcentaje > 0 ? redondear(base * (porcentaje / 100)) : 0,
    siguiente: siguiente
      ? { desde: siguiente.desde, porcentaje: Number(siguiente.porcentaje), faltan: siguiente.desde - unidades }
      : null,
  };
}

/**
 * Elige entre cupón y descuento al mayor: se aplica solo el que descuenta más.
 * En empate gana el cupón (el cliente lo escribió y el colaborador recibe su comisión).
 */
function elegirDescuento(descuentoCupon, descuentoMayor) {
  const cupon = redondear(descuentoCupon);
  const mayor = redondear(descuentoMayor);
  if (mayor > 0 && mayor > cupon) return 'mayor';
  if (cupon > 0) return 'cupon';
  return null;
}

let esquemaListo = null;

// Crea la tabla de configuración y las columnas del pedido si no existen (solo la primera vez).
function asegurarEsquemaDescuentoMayor() {
  if (!esquemaListo) {
    esquemaListo = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS descuento_mayor_config (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          activo BOOLEAN NOT NULL DEFAULT TRUE,
          niveles JSONB NOT NULL,
          tamanos_ml JSONB NOT NULL,
          actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_mayor NUMERIC(12, 2) NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_mayor_porcentaje NUMERIC(5, 2)`;
      // Marcado desde el panel cuando se quita el descuento (por ejemplo, pago con Cashea)
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_mayor_quitado BOOLEAN NOT NULL DEFAULT FALSE`;
      // Copia de las reglas vigentes cuando se hizo el pedido: si después cambian en el panel,
      // el pedido sigue con las suyas
      await sql`ALTER TABLE pedidos_venta ADD COLUMN IF NOT EXISTS descuento_mayor_reglas JSONB`;
    })().catch((error) => {
      esquemaListo = null; // se reintenta en la próxima llamada
      throw error;
    });
  }
  return esquemaListo;
}

async function obtenerConfigDescuentoMayor() {
  await asegurarEsquemaDescuentoMayor();
  const filas = await sql`SELECT activo, niveles, tamanos_ml, actualizado_en FROM descuento_mayor_config WHERE id = 1`;
  if (!filas || !filas[0]) return { ...CONFIG_POR_DEFECTO, actualizado_en: null };
  const fila = filas[0];
  const normal = normalizarConfig({ activo: fila.activo, niveles: fila.niveles, tamanos_ml: fila.tamanos_ml });
  if (normal.error) return { ...CONFIG_POR_DEFECTO, actualizado_en: null };
  return { ...normal.config, actualizado_en: fila.actualizado_en };
}

async function guardarConfigDescuentoMayor(entrada) {
  const normal = normalizarConfig(entrada);
  if (normal.error) return normal;
  await asegurarEsquemaDescuentoMayor();
  const c = normal.config;
  await sql`
    INSERT INTO descuento_mayor_config (id, activo, niveles, tamanos_ml, actualizado_en)
    VALUES (1, ${c.activo}, ${JSON.stringify(c.niveles)}::jsonb, ${JSON.stringify(c.tamanos_ml)}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
      SET activo = EXCLUDED.activo, niveles = EXCLUDED.niveles,
          tamanos_ml = EXCLUDED.tamanos_ml, actualizado_en = NOW()
  `;
  return { config: await obtenerConfigDescuentoMayor() };
}

// Líneas guardadas de un pedido, en el formato que usa calcularDescuentoMayor
async function lineasDelPedido(pedidoId) {
  const filas = await sql`
    SELECT pvp.cantidad,
           COALESCE(pvp.precio_venta, prod.precio_venta, 0) AS precio,
           COALESCE(NULLIF(pvp.formula_nombre, ''), NULLIF(pvp.nombre_producto, ''), prod.nombre, '') AS nombre
    FROM pedido_venta_productos pvp
    LEFT JOIN productos prod ON prod.id = pvp.producto_id
    WHERE pvp.pedido_venta_id = ${pedidoId}
  `;
  return (filas || []).map((f) => ({ cantidad: Number(f.cantidad), precio: Number(f.precio), nombre: f.nombre }));
}

// Reglas para guardar dentro del pedido (sin la fecha de actualización)
function reglasParaGuardar(config) {
  return { activo: Boolean(config.activo), niveles: config.niveles, tamanos_ml: config.tamanos_ml };
}

// Descuento que le toca a un pedido con sus productos actuales, usando SIEMPRE las reglas
// guardadas en el pedido cuando se hizo (cambiar las reglas en el panel no lo afecta).
// Solo si el pedido no tiene reglas guardadas se usan las actuales, conservando su porcentaje
// si el descuento está apagado.
function descuentoParaPedido(pedido, lineas, configActual) {
  const guardadas = pedido.descuento_mayor_reglas ? normalizarConfig(pedido.descuento_mayor_reglas).config : null;
  if (guardadas) return calcularDescuentoMayor(lineas, guardadas);
  const config = configActual || CONFIG_POR_DEFECTO;
  let resultado = calcularDescuentoMayor(lineas, config);
  const pctGuardado = Number(pedido.descuento_mayor_porcentaje);
  if (!config.activo && pctGuardado > 0) {
    resultado = { ...resultado, porcentaje: pctGuardado, descuento: redondear(resultado.base * (pctGuardado / 100)) };
  }
  return resultado;
}

/**
 * Cuando el panel agrega o quita productos de un pedido de la web sin cupón, el descuento
 * al mayor se vuelve a calcular con las reglas que tenía el pedido cuando se hizo (por ejemplo,
 * si llega a 24 perfumes pasa a 15 %). Cambiar las reglas en el panel no afecta pedidos ya hechos.
 * Solo toca pedidos creados con el descuento al mayor ya funcionando (tienen
 * descuento_mayor_porcentaje: 0 si no les tocó), para que los pedidos viejos no cambien.
 * No toca pedidos con cupón, completados ni a los que se les quitó el descuento.
 */
async function recalcularDescuentoMayor(pedidoVentaId) {
  const pedidoId = Number(pedidoVentaId);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) return null;
  try {
    await asegurarEsquemaDescuentoMayor();
    const filas = await sql`
      SELECT id, estado, cupon_id, descuento_mayor_porcentaje, descuento_mayor_quitado, descuento_mayor_reglas
      FROM pedidos_venta WHERE id = ${pedidoId} LIMIT 1
    `;
    const pedido = filas && filas[0];
    if (!pedido || pedido.cupon_id != null) return null;
    if (pedido.descuento_mayor_porcentaje == null) return null; // pedido anterior al descuento al mayor
    // Si en el panel se quitó el descuento (pago con Cashea), no vuelve a aparecer al editar productos
    if (pedido.descuento_mayor_quitado) return null;
    if (String(pedido.estado || '').toLowerCase() === 'completado') return null;

    const config = pedido.descuento_mayor_reglas ? null : await obtenerConfigDescuentoMayor();
    const resultado = descuentoParaPedido(pedido, await lineasDelPedido(pedidoId), config);
    const porcentaje = resultado.descuento > 0 ? resultado.porcentaje : 0;
    await sql`
      UPDATE pedidos_venta
      SET descuento_mayor = ${resultado.descuento}, descuento_mayor_porcentaje = ${porcentaje}
      WHERE id = ${pedidoId}
    `;
    return { descuento_mayor: resultado.descuento, descuento_mayor_porcentaje: porcentaje };
  } catch (error) {
    console.error('Error recalculando descuento al mayor:', error.message || error);
    return null;
  }
}

/**
 * Quita o vuelve a aplicar el descuento al mayor de un pedido desde el panel
 * (por ejemplo, el cliente paga con Cashea y ahí no aplica).
 * Devuelve { ok: true, descuento_mayor, descuento_mayor_porcentaje, descuento_mayor_quitado }
 * o { ok: false, status, error }.
 */
async function cambiarDescuentoMayorPedido(pedidoVentaId, aplicar) {
  const pedidoId = Number(pedidoVentaId);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) return { ok: false, status: 400, error: 'ID de pedido inválido' };
  await asegurarEsquemaDescuentoMayor();
  const filas = await sql`
    SELECT id, estado, cupon_id, descuento_mayor, descuento_mayor_porcentaje, descuento_mayor_quitado, descuento_mayor_reglas
    FROM pedidos_venta WHERE id = ${pedidoId} LIMIT 1
  `;
  const pedido = filas && filas[0];
  if (!pedido) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (String(pedido.estado || '').toLowerCase() === 'completado') {
    return { ok: false, status: 400, error: 'El pedido ya está completado; no se puede cambiar el descuento' };
  }
  if (pedido.cupon_id != null) {
    return { ok: false, status: 400, error: 'Este pedido usa un cupón; el descuento al mayor no aplica' };
  }

  if (!aplicar) {
    if (Number(pedido.descuento_mayor || 0) <= 0) {
      return { ok: false, status: 400, error: 'Este pedido no tiene descuento al mayor' };
    }
    // Se conserva el porcentaje para poder mostrar cuál se quitó
    await sql`
      UPDATE pedidos_venta
      SET descuento_mayor = 0, descuento_mayor_quitado = TRUE
      WHERE id = ${pedidoId}
    `;
    return {
      ok: true,
      descuento_mayor: 0,
      descuento_mayor_porcentaje: Number(pedido.descuento_mayor_porcentaje || 0),
      descuento_mayor_quitado: true,
    };
  }

  if (!pedido.descuento_mayor_quitado) {
    return { ok: false, status: 400, error: 'El descuento al mayor de este pedido no está quitado' };
  }
  // Volver a aplicar: se calcula primero con los productos actuales y solo se guarda si alcanza
  const config = pedido.descuento_mayor_reglas ? null : await obtenerConfigDescuentoMayor();
  const resultado = descuentoParaPedido(pedido, await lineasDelPedido(pedidoId), config);
  if (!(resultado.descuento > 0)) {
    return { ok: false, status: 400, error: 'El pedido no tiene suficientes perfumes para el descuento al mayor' };
  }
  await sql`
    UPDATE pedidos_venta
    SET descuento_mayor = ${resultado.descuento}, descuento_mayor_porcentaje = ${resultado.porcentaje},
        descuento_mayor_quitado = FALSE
    WHERE id = ${pedidoId}
  `;
  return {
    ok: true,
    descuento_mayor: resultado.descuento,
    descuento_mayor_porcentaje: resultado.porcentaje,
    descuento_mayor_quitado: false,
  };
}

module.exports = {
  cambiarDescuentoMayorPedido,
  CONFIG_POR_DEFECTO,
  mlDe,
  normalizarConfig,
  calcularDescuentoMayor,
  elegirDescuento,
  asegurarEsquemaDescuentoMayor,
  obtenerConfigDescuentoMayor,
  guardarConfigDescuentoMayor,
  lineasDelPedido,
  descuentoParaPedido,
  reglasParaGuardar,
  recalcularDescuentoMayor,
};
