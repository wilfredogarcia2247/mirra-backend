const WAHA_BASE_URL = (process.env.WAHA_API_URL || process.env.WHATSAPP_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

const recentIncomingMessages = [];
const MAX_INCOMING_MESSAGES = 100;
const recentOutboundMessages = [];
const MAX_OUTBOUND_MESSAGES = 200;

const ITEM_NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function getHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(WAHA_API_KEY ? { 'X-Api-Key': WAHA_API_KEY } : {}),
    ...extra,
  };
}

async function callWaha(path, options = {}) {
  const { method = 'GET', body } = options;
  const response = await fetch(`${WAHA_BASE_URL}${path}`, {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const raw = await response.text();
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = raw;
  }

  if (!response.ok) {
    const err = new Error(
      (payload && payload.message) || (typeof payload === 'string' ? payload : 'Error WAHA')
    );
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function toChatId(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

function formatTotalBs(totalDivisa, tasaCambio) {
  const total = Number(totalDivisa);
  const tasa = Number(tasaCambio);
  if (!Number.isFinite(total) || !Number.isFinite(tasa) || tasa <= 0) return 'N/D';
  const totalBs = total * tasa;
  return `${totalBs.toFixed(2).replace('.', ',')}bs`;
}

function formatOrderSuccessMessage(order) {
  const customerName = order.customerName || order.nombre_cliente || 'Cliente';
  const orderId = order.orderId || order.id || 'N/D';
  const cedula = order.cedula || order.documento || 'N/D';
  const totalBs = formatTotalBs(order.total, order.tasa_cambio_monto);
  const totalLabel = totalBs !== 'N/D'
    ? totalBs
    : (order.total_formatted || order.total || 'N/D');

  const lines = [];
  lines.push('🌟 *Pedido confirmado en Mirra Perfumeria* 🌟');
  lines.push('');
  lines.push(`Hola ${customerName}, hemos confirmado tu pedido con exito:`);
  lines.push('');
  lines.push(`📝 *Pedido:* #${orderId}`);
  lines.push(`👤 *Cliente:* ${customerName}`);
  lines.push(`💳 *Cedula:* ${cedula}`);
  lines.push(`💰 *Total cancelado:* ${totalLabel}`);

  if (Array.isArray(order.items) && order.items.length > 0) {
    lines.push('');
    lines.push('🛍️ *Tu seleccion:*');
    lines.push('');
    order.items.forEach((item, index) => {
      const badge = ITEM_NUMBER_EMOJI[index] || `${index + 1}.`;
      const productName = item.name || 'Producto';
      const presentation = item.presentation || item.presentacion || item.size || item.tamano || null;
      const presentationText = presentation ? ` - ${presentation}` : '';
      lines.push(`${badge} *${productName}*${presentationText} x${item.quantity || 1}`);
    });
  }

  lines.push('');
  lines.push('✅ Gracias por tu confirmacion. Tu pedido esta en proceso.');
  lines.push('');
  lines.push('Seguimos a tu orden.');
  return lines.join('\n');
}

function formatOrderNotificationMessage(order) {
  const customerName = order.customerName || order.nombre_cliente || 'Cliente';
  const orderId = order.orderId || order.id || 'N/D';
  const cedula = order.cedula || order.documento || 'N/D';

  const lines = [];
  lines.push('🌟 *Nueva compra en Mirra Perfumeria* 🌟');
  lines.push('');
  lines.push(`Hola ${customerName}, gracias por elegirnos. Hemos recibido tu pedido con exito:`);
  lines.push('');
  lines.push(`📝 *Pedido:* #${orderId}`);
  lines.push(`👤 *Cliente:* ${customerName}`);
  lines.push(`💳 *Cedula:* ${cedula}`);
  lines.push(`💰 *Total a pagar:* ${formatTotalBs(order.total, order.tasa_cambio_monto)}`);

  if (Array.isArray(order.items) && order.items.length > 0) {
    lines.push('');
    lines.push('🛍️ *Tu seleccion:*');
    lines.push('');
    order.items.forEach((item, index) => {
      const badge = ITEM_NUMBER_EMOJI[index] || `${index + 1}.`;
      const productName = item.name || 'Producto';
      const presentation = item.presentation || item.presentacion || item.size || item.tamano || null;
      const presentationText = presentation ? ` - ${presentation}` : '';
      lines.push(`${badge} *${productName}*${presentationText} x${item.quantity || 1}`);
    });
  }

  lines.push('');
  lines.push(
    '✨ Por favor, confirmanos este pedido respondiendo a este mensaje o enviando tu comprobante de pago.',
  );
  lines.push('');
  lines.push('Gracias por confiar en nosotros.');
  return lines.join('\n');
}

function resolveSessionName(sessionName) {
  const value = String(sessionName || WAHA_SESSION || 'default').trim();
  return value || 'default';
}

async function ensureSession(sessionName) {
  const session = resolveSessionName(sessionName);
  try {
    await callWaha(`/api/sessions/${session}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await callWaha('/api/sessions', {
      method: 'POST',
      body: { name: session },
    });
    try {
      await callWaha(`/api/sessions/${session}`);
    } catch (innerError) {
      if (innerError.status !== 404) throw innerError;
    }
  }
}

async function ensureSessionStarted(sessionName) {
  const session = resolveSessionName(sessionName);
  await ensureSession(session);
  try {
    await callWaha(`/api/sessions/${session}/start`, { method: 'POST' });
  } catch (error) {
    // Operacion idempotente en WAHA; si ya esta iniciada, ignoramos errores no criticos.
    if (error.status && error.status >= 500) throw error;
  }
}

async function sendTextMessage({ to, text, session, meta }) {
  const chatId = toChatId(to);
  if (!chatId) throw new Error('Telefono destino invalido para WhatsApp');
  const sessionName = resolveSessionName(session);
  await ensureSessionStarted(sessionName);
  const response = await callWaha('/api/sendText', {
    method: 'POST',
    body: {
      session: sessionName,
      chatId,
      text,
    },
  });

  recentOutboundMessages.unshift({
    createdAt: new Date().toISOString(),
    session: sessionName,
    to,
    chatId,
    text,
    meta: meta || null,
    response,
  });
  if (recentOutboundMessages.length > MAX_OUTBOUND_MESSAGES) {
    recentOutboundMessages.length = MAX_OUTBOUND_MESSAGES;
  }

  return response;
}

async function getSessionStatus(sessionName) {
  const session = resolveSessionName(sessionName);
  try {
    await ensureSessionStarted(session);
  } catch (error) {
    if (error.status !== 404) throw error;
    await callWaha('/api/sessions', {
      method: 'POST',
      body: { name: session },
    });
    await callWaha(`/api/sessions/${session}/start`, { method: 'POST' });
  }

  let sessionInfo;
  try {
    sessionInfo = await callWaha(`/api/sessions/${session}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await callWaha('/api/sessions', {
      method: 'POST',
      body: { name: session },
    });
    await callWaha(`/api/sessions/${session}/start`, { method: 'POST' });
    sessionInfo = await callWaha(`/api/sessions/${session}`);
  }

  if (sessionInfo?.status === 'STOPPED' || sessionInfo?.status === 'FAILED') {
    await callWaha(`/api/sessions/${session}/restart`, { method: 'POST' });
    sessionInfo = await callWaha(`/api/sessions/${session}`);
  }

  let qrData = null;

  if (sessionInfo?.status === 'SCAN_QR_CODE') {
    try {
      qrData = await callWaha(`/api/${session}/auth/qr`, {
        method: 'POST',
      });
    } catch (error) {
      qrData = null;
    }
  }

  return {
    ready: sessionInfo?.status === 'WORKING',
    hasQr: Boolean(qrData),
    qrImage: qrData?.data ? `data:image/png;base64,${qrData.data}` : null,
    qrRaw: qrData?.qr || null,
    session,
    device: {
      wid: sessionInfo?.me?.id || null,
      phone: sessionInfo?.me?.id ? String(sessionInfo.me.id).replace('@c.us', '') : null,
      pushname: sessionInfo?.me?.pushName || null,
      platform: sessionInfo?.engine?.engine || null,
    },
    statusCode: (sessionInfo?.status || 'STOPPED').toLowerCase(),
    statusMessage: `Estado de sesion: ${sessionInfo?.status || 'STOPPED'}`,
    events: {
      lastReadyAt: null,
      lastDisconnectedAt: null,
      lastAuthFailureAt: null,
      lastAuthFailureMessage: null,
    },
    lastSendAttempt: null,
  };
}

async function disconnectSession(sessionName) {
  const session = resolveSessionName(sessionName);
  await ensureSessionStarted(session);
  return callWaha(`/api/sessions/${session}/logout`, { method: 'POST' });
}

async function restartSession(sessionName) {
  const session = resolveSessionName(sessionName);
  await ensureSessionStarted(session);
  return callWaha(`/api/sessions/${session}/restart`, { method: 'POST' });
}

async function resetSessionStorage(sessionName) {
  const session = resolveSessionName(sessionName);
  try {
    await callWaha(`/api/sessions/${session}`, { method: 'DELETE' });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await callWaha('/api/sessions', {
    method: 'POST',
    body: { name: session },
  });
  await callWaha(`/api/sessions/${session}/start`, { method: 'POST' });
}

async function generateNewQr(sessionName) {
  const session = resolveSessionName(sessionName);
  try {
    await callWaha(`/api/sessions/${session}/logout`, { method: 'POST' });
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    await callWaha('/api/sessions', {
      method: 'POST',
      body: { name: session },
    });
  } catch (error) {
    // Si ya existe, seguimos
  }

  await callWaha(`/api/sessions/${session}/start`, { method: 'POST' });
  return getSessionStatus(session);
}

function addIncomingMessage(payload) {
  recentIncomingMessages.unshift({
    receivedAt: new Date().toISOString(),
    payload,
  });
  if (recentIncomingMessages.length > MAX_INCOMING_MESSAGES) {
    recentIncomingMessages.length = MAX_INCOMING_MESSAGES;
  }
}

function listIncomingMessages() {
  return recentIncomingMessages;
}

function listOutboundMessages() {
  return recentOutboundMessages;
}

module.exports = {
  WAHA_SESSION,
  sendTextMessage,
  formatOrderSuccessMessage,
  formatOrderNotificationMessage,
  getSessionStatus,
  disconnectSession,
  restartSession,
  resetSessionStorage,
  generateNewQr,
  addIncomingMessage,
  listIncomingMessages,
  listOutboundMessages,
};
