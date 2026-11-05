/**
 * Crea las miniaturas (products/cinta/*.webp, mismo tamaño que la original, WebP calidad 90) de las fotos de productos que ya están en MinIO.
 * Las fotos nuevas ya la crean al subirse (routes/imagenes.js); esto es para las anteriores.
 *
 * Uso (desde mirra-backend, con las variables S3_* del entorno que corresponda):
 *   node scripts/crear_miniaturas.js             -> solo muestra qué haría, no escribe nada
 *   node scripts/crear_miniaturas.js --ejecutar  -> crea las miniaturas que faltan
 *
 * Solo agrega archivos nuevos en products/cinta/; nunca modifica ni borra las fotos originales.
 * Se puede correr varias veces: salta las miniaturas que ya existen.
 */
require('dotenv').config();
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { claveMiniatura, crearMiniatura, CACHE_CONTROL } = require('../services/miniaturas');

const EJECUTAR = process.argv.includes('--ejecutar');
const PREFIJO = 'products/';
const IMAGEN = /\.(png|jpe?g|webp)$/i;

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
});
const BUCKET = process.env.S3_BUCKET;

async function listarTodo() {
  const claves = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIJO, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => claves.push(o.Key));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return claves;
}

async function bajar(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}

(async () => {
  if (!BUCKET || !process.env.S3_ENDPOINT) throw new Error('Faltan S3_ENDPOINT / S3_BUCKET en el entorno');
  console.log(`${EJECUTAR ? 'EJECUTANDO' : 'SIMULACIÓN (agrega --ejecutar para escribir)'} en ${process.env.S3_ENDPOINT} / ${BUCKET}`);

  const claves = await listarTodo();
  const existentes = new Set(claves);
  const pendientes = claves.filter((k) => IMAGEN.test(k) && claveMiniatura(k) && !existentes.has(claveMiniatura(k)));
  console.log(`Fotos: ${claves.length} archivos, ${pendientes.length} sin miniatura`);

  let hechas = 0, fallidas = 0, antes = 0, despues = 0;
  for (const key of pendientes) {
    const keyMini = claveMiniatura(key);
    if (!EJECUTAR) { console.log(`  ${key} -> ${keyMini}`); continue; }
    try {
      const original = await bajar(key);
      const mini = await crearMiniatura(original);
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: keyMini, Body: mini, ContentType: 'image/webp', CacheControl: CACHE_CONTROL }));
      hechas += 1; antes += original.length; despues += mini.length;
      console.log(`  ok ${keyMini} (${Math.round(original.length / 1024)} KB -> ${Math.round(mini.length / 1024)} KB)`);
    } catch (e) {
      fallidas += 1;
      console.error(`  ERROR ${key}: ${e.message}`);
    }
  }
  if (EJECUTAR) {
    console.log(`Listo: ${hechas} miniaturas creadas, ${fallidas} con error. ${Math.round(antes / 1048576)} MB -> ${Math.round(despues / 1024)} KB`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
