// api/create-preference.js
// Vercel Serverless Function — crea preferencia de pago en MercadoPago
//
// Variables de entorno requeridas (Vercel → Settings → Environment Variables):
//   MP_ACCESS_TOKEN  → Access Token de producción (APP_USR-...)
//   SITE_URL         → URL de tu sitio sin barra final (ej: https://evenforge.vercel.app)
//   MP_SANDBOX       → "true" para testing, "false" o vacío para producción

module.exports = async (req, res) => {
  // ── CORS ──────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { MP_ACCESS_TOKEN, SITE_URL, MP_SANDBOX } = process.env;

  if (!MP_ACCESS_TOKEN || !SITE_URL) {
    console.error('[create-preference] Faltan MP_ACCESS_TOKEN o SITE_URL');
    return res.status(500).json({ error: 'Configuración incompleta en el servidor' });
  }

  // ── Leer body ─────────────────────────────────────────────
  // Acepta tanto { items, payer_email } (order bumps dinámicos)
  // como { email } (compatibilidad hacia atrás)
  const body = req.body || {};
  const payer_email        = body.payer_email || body.email || null;
  const external_reference = body.external_reference || null;

  // Soporte para items dinámicos (order bumps) o precio fijo
  let items;
  if (Array.isArray(body.items) && body.items.length > 0) {
    items = body.items.map((item) => ({
      id:          item.id || 'evenforge-pro',
      title:       String(item.title || 'EvenForge Pro').slice(0, 256),
      description: item.description || 'Acceso a EvenForge Pro',
      quantity:    Number(item.quantity) || 1,
      currency_id: 'ARS',
      unit_price:  Number(item.unit_price),
    }));
  } else {
    // Fallback: precio fijo desde variable de entorno
    items = [{
      id:          'evenforge-pro-001',
      title:       'EvenForge Pro — Acceso completo',
      description: 'Acceso permanente a EvenForge Pro',
      quantity:    1,
      currency_id: 'ARS',
      unit_price:  parseFloat(process.env.PRODUCT_PRICE || '285000'),
    }];
  }

  // ── Armar preferencia ─────────────────────────────────────
  const preference = {
    items,
    payer: payer_email ? { email: payer_email } : undefined,
    external_reference: external_reference || (payer_email ? payer_email + '|' + Date.now() : 'ef_' + Date.now()),

    back_urls: {
      success: SITE_URL + '/success.html?status=approved',
      failure: SITE_URL + '/?error=pago_rechazado',
      pending: SITE_URL + '/success.html?status=pending',
    },
    auto_return: 'approved',

    // ← URL correcta para Vercel (antes apuntaba a /.netlify/functions/webhook)
    notification_url: SITE_URL + '/api/mp-webhook',

    statement_descriptor: 'EVENFORGE PRO',
  };

  console.log('[create-preference] Items:', items.map((i) => i.title).join(', '));
  console.log('[create-preference] Payer:', payer_email || 'sin email');

  // ── Llamar a la API de MP ─────────────────────────────────
  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN,
      },
      body: JSON.stringify(preference),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[create-preference] Error MP:', mpRes.status, JSON.stringify(data));
      return res.status(500).json({ error: data.message || 'Error en MercadoPago' });
    }

    const useSandbox  = MP_SANDBOX === 'true';
    const checkoutUrl = useSandbox ? data.sandbox_init_point : data.init_point;

    console.log('[create-preference] Preferencia creada:', data.id, '| Sandbox:', useSandbox);

    return res.status(200).json({
      checkout_url:  checkoutUrl,   // ← landing usa este campo
      url:           checkoutUrl,   // ← compatibilidad hacia atrás
      preference_id: data.id,
    });

  } catch (err) {
    console.error('[create-preference] Error interno:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
