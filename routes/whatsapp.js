const express = require('express');
const {
  sendTextMessage,
  getSessionStatus,
  disconnectSession,
  restartSession,
  resetSessionStorage,
  generateNewQr,
  addIncomingMessage,
  listIncomingMessages,
  listOutboundMessages,
} = require('../services/waha');

const router = express.Router();

function getSessionFromRequest(req) {
  return (req.query && req.query.session) || (req.body && req.body.session) || undefined;
}

function webhookHandler(req, res) {
  addIncomingMessage(req.body || {});
  return res.status(200).json({ ok: true });
}

router.get('/session/status', async (req, res, next) => {
  try {
    const data = await getSessionStatus(getSessionFromRequest(req));
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/session/disconnect', async (req, res, next) => {
  try {
    await disconnectSession(getSessionFromRequest(req));
    return res.json({ ok: true, message: 'Sesion desconectada' });
  } catch (error) {
    return next(error);
  }
});

router.post('/session/recover-lock', async (req, res, next) => {
  try {
    await restartSession(getSessionFromRequest(req));
    return res.json({ ok: true, message: 'Sesion reiniciada' });
  } catch (error) {
    return next(error);
  }
});

router.post('/session/reset-storage', async (req, res, next) => {
  try {
    await resetSessionStorage(getSessionFromRequest(req));
    return res.json({ ok: true, message: 'Sesion reiniciada desde cero' });
  } catch (error) {
    return next(error);
  }
});

router.post('/session/new-qr', async (req, res, next) => {
  try {
    const data = await generateNewQr(getSessionFromRequest(req));
    return res.json({ ok: true, data, message: 'Nuevo QR generado' });
  } catch (error) {
    return next(error);
  }
});

router.post('/send', async (req, res, next) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ ok: false, error: 'to y text son obligatorios' });
    }
    const data = await sendTextMessage({ to, text, session: getSessionFromRequest(req) });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/messages/incoming', (req, res) => {
  return res.json({ ok: true, data: listIncomingMessages() });
});

router.get('/messages/outbound-orders', (req, res) => {
  const data = listOutboundMessages().filter((item) =>
    item && item.meta && (item.meta.type === 'order-success' || item.meta.type === 'order-notification')
  );
  return res.json({ ok: true, data });
});

module.exports = router;
module.exports.webhookHandler = webhookHandler;
