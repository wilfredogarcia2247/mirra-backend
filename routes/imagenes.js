/**
 * routes/images.js
 * Subida de imágenes a MinIO (S3 compatible)
 *
 * Endpoint:
 *  POST /api/images/upload
 *
 * Env requeridas:
 *  S3_ENDPOINT=https://minio-xxxx.sslip.io
 *  S3_REGION=us-east-1
 *  S3_ACCESS_KEY=xxxx
 *  S3_SECRET_KEY=xxxx
 *  S3_BUCKET=images
 *  S3_FORCE_PATH_STYLE=true
 *  PUBLIC_BASE_URL=https://minio-xxxx.sslip.io   (opcional, si bucket público)
 */

const express = require('express');
const multer = require('multer');
const {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const router = express.Router();

/* =========================
   Multer (memoria)
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* =========================
   Utils
========================= */
function mustEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return process.env[name];
}

function sanitize(name = 'image') {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80);
}

function extFromMime(mime) {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'bin';
  }
}

/* =========================
   S3 / MinIO client
========================= */
const https = require('https');

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: mustEnv('S3_ENDPOINT'),
  credentials: {
    accessKeyId: mustEnv('S3_ACCESS_KEY'),
    secretAccessKey: mustEnv('S3_SECRET_KEY'),
  },
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
});

const BUCKET = mustEnv('S3_BUCKET');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const SIGNED_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES_SECONDS || 604800);

/* =========================
   Bucket ensure
========================= */
async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

function buildPublicUrl(key) {
  if (!PUBLIC_BASE_URL) return null;
  return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/${BUCKET}/${key}`;
}

/* =========================
   Route: upload image
========================= */
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    await ensureBucket();

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Archivo no recibido (field: image)' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ ok: false, error: 'Solo se permiten imágenes' });
    }

    const ext = extFromMime(req.file.mimetype);
    const safeName = sanitize(req.file.originalname);
    const key = `products/${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    // Preferir URL pública fija
    const publicUrl = buildPublicUrl(key);
    if (publicUrl) {
      return res.json({
        ok: true,
        url: publicUrl,
        key,
        bucket: BUCKET,
      });
    }

    // Fallback: signed URL
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: SIGNED_EXPIRES }
    );

    return res.json({
      ok: true,
      url: signedUrl,
      key,
      bucket: BUCKET,
      expiresIn: SIGNED_EXPIRES,
    });
  } catch (err) {
    console.error('Error subiendo imagen:', err);
    
    // Log de la respuesta cruda para depuración
    if (err.$response) {
      console.error('Respuesta cruda del servidor:', err.$response);
    }
    
    return res.status(500).json({
      ok: false,
      error: err.message || 'Error interno al subir imagen',
    });
  }
});

module.exports = router;
