/**
 * Estilo nuevo de la tienda (2026-11): carga en la ficha de cada perfume
 *   - nombre_mirra (nombre corto de Mirra), color_liquido (color del frasco),
 *   - fotos { huele, inspirado, estilo } (galería de la ficha),
 *   - y las notas de 9 perfumes que tenían la ficha revisada pero sin notas.
 * Datos: scripts/datos/estilo_tienda.json. Fotos: carpeta "tienda" del zip que entrega el dueño
 * (tienda/huele/*.webp, tienda/inspirado/*.webp, tienda/estilo/*.webp).
 *
 * Uso (desde mirra-backend, con DATABASE_URL y S3_* / PUBLIC_BASE_URL del entorno que corresponda):
 *   node scripts/importar_estilo_tienda.js --fotos <carpeta tienda>             -> SIMULACIÓN: muestra qué haría, no escribe nada
 *   node scripts/importar_estilo_tienda.js --fotos <carpeta tienda> --ejecutar  -> sube las fotos y guarda las fichas
 *   node scripts/importar_estilo_tienda.js --deshacer <respaldo.json> [--ejecutar] -> deja las fichas como estaban
 *
 * Seguridad:
 *   - Solo cambia un perfume si su id Y su nombre (productos.nombre) coinciden con los datos; si no, lo salta y lo avisa.
 *     (Los ids son los de producción: en otra base casi todo saldrá "no coincide" y no se cambia nada.)
 *   - Conserva todo lo que ya tiene la ficha; solo agrega/actualiza nombre_mirra, color_liquido y fotos.
 *     Las notas y familias solo se llenan si hoy están vacías. Nunca toca nombre, precios, categorías ni inventario.
 *   - Antes de escribir guarda un respaldo con la ficha anterior de cada perfume (scripts/respaldos/).
 *   - Las fotos van a products/tienda/... (carpeta nueva); no borra ni reemplaza otras fotos. Se puede correr varias veces.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { normalizarFicha, asegurarColumnaFicha } = require('../services/fichaPerfume');

const sql = neon(process.env.DATABASE_URL);
const args = process.argv.slice(2);
const EJECUTAR = args.includes('--ejecutar');
const valor = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const CARPETA_FOTOS = valor('--fotos');
const DESHACER = valor('--deshacer');
const DATOS = path.join(__dirname, 'datos', 'estilo_tienda.json');
const RESPALDOS = path.join(__dirname, 'respaldos');
const PREFIJO = 'products/tienda/';
const CACHE = 'public, max-age=31536000, immutable';

function clienteS3() {
  const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  for (const v of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'PUBLIC_BASE_URL']) {
    if (!process.env[v]) throw new Error(`Falta ${v} en el entorno`);
  }
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  });
  return { s3, PutObjectCommand, HeadObjectCommand, BUCKET: process.env.S3_BUCKET };
}

// Misma forma que routes/imagenes.js (buildPublicUrl)
function urlPublica(key) {
  return `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/${process.env.S3_BUCKET}/${key}`;
}

const vacias = (n) => !n || !['salida', 'corazon', 'fondo'].some((k) => Array.isArray(n[k]) && n[k].length);

// Ficha nueva = la de hoy + lo del estilo nuevo (pasa por normalizarFicha, igual que el panel)
function fichaNueva(actual, d, urls) {
  const f = { ...(actual || {}) };
  f.nombre_mirra = d.nombre_mirra;
  f.color_liquido = d.color_liquido;
  f.fotos = { ...(actual && actual.fotos ? actual.fotos : {}), ...urls };
  if (d.notas && vacias(f.notas)) {
    f.notas = d.notas;
    if (!Array.isArray(f.familias) || !f.familias.length) f.familias = d.familias || [];
    if (d.inspirado_en) f.inspirado_en = d.inspirado_en;
    f.revisada = true; // el dueño aprobó estas notas (2026-11-22)
  }
  return normalizarFicha(f);
}

async function deshacer() {
  const respaldo = JSON.parse(fs.readFileSync(DESHACER, 'utf8'));
  console.log(`${EJECUTAR ? 'EJECUTANDO' : 'SIMULACIÓN (agrega --ejecutar para escribir)'}: deshacer ${respaldo.fichas.length} fichas del ${respaldo.fecha}`);
  if (!EJECUTAR) return;
  for (const r of respaldo.fichas) {
    await sql`UPDATE productos SET ficha = ${r.ficha_anterior === null ? null : JSON.stringify(r.ficha_anterior)}::jsonb WHERE id = ${r.id}`;
  }
  console.log('Listo: fichas restauradas (las fotos subidas quedan en MinIO sin usarse).');
}

async function importar() {
  if (!CARPETA_FOTOS) throw new Error('Indica la carpeta de fotos: --fotos <carpeta tienda del zip>');
  const datos = JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  console.log(`${EJECUTAR ? 'EJECUTANDO' : 'SIMULACIÓN (agrega --ejecutar para escribir)'} · ${datos.length} perfumes en los datos`);

  // 1) Fotos: que estén todas en la carpeta
  const archivos = [...new Set(datos.flatMap((d) => Object.values(d.fotos || {})))];
  const faltan = archivos.filter((a) => !fs.existsSync(path.join(CARPETA_FOTOS, a)));
  if (faltan.length) throw new Error(`Faltan ${faltan.length} fotos en ${CARPETA_FOTOS}, por ejemplo: ${faltan.slice(0, 5).join(', ')}`);
  console.log(`Fotos: ${archivos.length} archivos encontrados en la carpeta`);

  // 2) Perfumes: mismo id y mismo nombre
  await asegurarColumnaFicha();
  const filas = await sql`SELECT id, nombre, ficha FROM productos WHERE id = ANY(${datos.map((d) => d.id)})`;
  const porId = new Map(filas.map((f) => [f.id, f]));
  const listos = []; const saltados = [];
  for (const d of datos) {
    const f = porId.get(d.id);
    if (!f) saltados.push(`${d.numero}. id ${d.id} no existe`);
    else if (String(f.nombre).trim() !== d.nombre_producto) saltados.push(`${d.numero}. id ${d.id} no coincide: base "${String(f.nombre).trim()}" / datos "${d.nombre_producto}"`);
    else listos.push({ d, f });
  }
  const conNotas = listos.filter(({ d, f }) => d.notas && vacias(f.ficha && f.ficha.notas)).length;
  console.log(`Perfumes: ${listos.length} se actualizan, ${saltados.length} se saltan; ${conNotas} reciben notas nuevas`);
  saltados.slice(0, 20).forEach((s) => console.log('  SALTA', s));
  if (saltados.length > 20) console.log(`  ... y ${saltados.length - 20} más`);
  listos.slice(0, 5).forEach(({ d }) => console.log(`  ${d.numero}. ${d.nombre_producto} → "${d.nombre_mirra}" · ${d.color_liquido} · ${Object.values(d.fotos).join(', ')}`));
  if (!EJECUTAR || !listos.length) return;

  // 3) Respaldo antes de escribir
  fs.mkdirSync(RESPALDOS, { recursive: true });
  const fecha = new Date().toISOString().replace(/[:.]/g, '-');
  const archivoRespaldo = path.join(RESPALDOS, `estilo_tienda_${fecha}.json`);
  fs.writeFileSync(archivoRespaldo, JSON.stringify({ fecha, fichas: listos.map(({ f }) => ({ id: f.id, nombre: f.nombre, ficha_anterior: f.ficha || null })) }, null, 1));
  console.log(`Respaldo guardado: ${archivoRespaldo}`);

  // 4) Subir fotos (salta las que ya están)
  const { s3, PutObjectCommand, HeadObjectCommand, BUCKET } = clienteS3();
  const usadas = [...new Set(listos.flatMap(({ d }) => Object.values(d.fotos || {})))];
  let subidas = 0;
  for (const a of usadas) {
    const key = PREFIJO + a;
    try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); continue; } catch (_) { /* no existe: se sube */ }
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fs.readFileSync(path.join(CARPETA_FOTOS, a)), ContentType: 'image/webp', CacheControl: CACHE }));
    subidas++;
  }
  console.log(`Fotos subidas: ${subidas} (ya estaban: ${usadas.length - subidas})`);

  // 5) Guardar fichas
  let ok = 0;
  for (const { d, f } of listos) {
    const urls = {};
    for (const [k, a] of Object.entries(d.fotos || {})) urls[k] = urlPublica(PREFIJO + a);
    const nueva = fichaNueva(f.ficha, d, urls);
    await sql`UPDATE productos SET ficha = ${JSON.stringify(nueva)}::jsonb WHERE id = ${f.id}`;
    ok++;
  }
  console.log(`Listo: ${ok} fichas actualizadas. Para deshacer: node scripts/importar_estilo_tienda.js --deshacer "${archivoRespaldo}" --ejecutar`);
}

(DESHACER ? deshacer() : importar()).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
