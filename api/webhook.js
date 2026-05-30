// api/mp-webhook.js  ← este archivo REEMPLAZA a webhook.js
// Vercel Serverless Function — recibe IPN de MercadoPago y entrega el producto
//
// Variables de entorno requeridas (Vercel → Settings → Environment Variables):
//   MP_ACCESS_TOKEN   → Access Token de producción de MP
//   GMAIL_USER        → tu Gmail (ej: jose_536@yahoo.com.ar o una cuenta Gmail)
//   GMAIL_APP_PASSWORD → contraseña de aplicación de Gmail (16 caracteres)
//   SENDER_NAME       → nombre que aparece en el email (ej: EvenForge Pro)
//   PRODUCT_URL       → link de acceso al producto
//   SITE_URL          → URL de tu sitio
//
// Opcional — para WhatsApp automático (UltraMsg):
//   ULTRAMSG_TOKEN    → token de tu instancia UltraMsg
//   ULTRAMSG_INSTANCE → instance ID (ej: instance12345)

const nodemailer = require('nodemailer');

// ── Email de entrega ──────────────────────────────────────────

async function sendDeliveryEmail({ buyerEmail, buyerName, paymentId, totalARS }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const productUrl = process.env.PRODUCT_URL || process.env.SITE_URL || 'https://evenforge.vercel.app';
  const senderName = process.env.SENDER_NAME || 'EvenForge Pro';
  const name       = buyerName || 'Cliente';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#13131a;border:1px solid #1e1e2e;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#8b5cf6,#ec4899);padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:26px;font-weight:800;color:#fff;">EvenForge Pro</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase;">Acceso activado ✅</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0eff6;">¡Hola ${name}, tu compra fue confirmada!</p>
            <p style="margin:0 0 28px;font-size:14px;color:#7070a0;line-height:1.6;">
              Tu pago de <strong style="color:#f0eff6;">$${totalARS}</strong> fue aprobado. A continuación encontrás tu acceso a EvenForge Pro.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:22px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#8b5cf6;letter-spacing:.08em;text-transform:uppercase;">🚀 Tu acceso</p>
                  <p style="margin:0 0 16px;font-size:13px;color:#c0bfd8;word-break:break-all;">${productUrl}</p>
                  <a href="${productUrl}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:700;font-size:14px;">
                    Acceder a EvenForge Pro →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px;font-size:12px;color:#7070a0;">Guardá este email — contiene tu link de acceso permanente.</p>
            <p style="margin:0;font-size:12px;color:#7070a0;">ID de pago: <span style="color:#c0bfd8;font-family:monospace;">${paymentId}</span></p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px;border-top:1px solid #1e1e2e;text-align:center;">
            <p style="margin:0;font-size:11px;color:#7070a0;">© 2026 ${senderName} · <a href="mailto:jose_536@yahoo.com.ar" style="color:#7070a0;">jose_536@yahoo.com.ar</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"${senderName}" <${process.env.GMAIL_USER}>`,
    to:      buyerEmail,
    subject: '✅ Tu acceso a EvenForge Pro está listo',
    html,
  });

  console.log('[mp-webhook] Email enviado a:', buyerEmail);
}

// ── WhatsApp vía UltraMsg (opcional) ─────────────────────────

async function sendWhatsApp({ phone, buyerName, totalARS }) {
  const instance = process.env.ULTRAMSG_INSTANCE;
  const token    = process.env.ULTRAMSG_TOKEN;
  const productUrl = process.env.PRODUCT_URL || process.env.SITE_URL;

  if (!instance || !token || !phone) return;

  // Normalizar número argentino
  let num = String(phone).replace(/\D/g, '');
  if (num.startsWith('0')) num = num.slice(1);
  if (!num.startsWith('549') && !num.startsWith('54')) {
    num = '549' + num;
  } else if (num.startsWith('54') && !num.startsWith('549')) {
    num = '549' + num.slice(2);
  }

  const message =
    `¡Hola ${buyerName || 'Cliente'}! 🎉\n\n` +
    `Tu pago de *$${totalARS}* fue *aprobado* con éxito ✅\n\n` +
    `📦 *Tu acceso a EvenForge Pro:*\n${productUrl}\n\n` +
    `Si tenés alguna duda respondé este mensaje 💬\n¡Gracias por tu confianza! 🚀`;

  try {
    const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, to: '+' + num, body: message, priority: 1 }),
    });
    const data = await res.json();
    console.log('[mp-webhook] WhatsApp enviado — status:', res.status, data?.sent);
  } catch (err) {
    console.error('[mp-webhook] Error WhatsApp:', err.message);
    // No lanzar — el email ya se envió
  }
}

// ── Handler principal ─────────────────────────────────────────

module.exports = async (req, res) => {
  // MP exige respuesta 200 rápida
  if (req.method !== 'POST') return res.status(200).end('OK');

  const body   = req.body || {};
  const params = req.query || {};

  const type  = body.type  || params.topic;
  const dataId = body.data?.id || params.id;

  console.log('[mp-webhook] Notificación — type:', type, '| id:', dataId);

  const isPayment = type === 'payment';
  if (!isPayment || !dataId) return res.status(200).end('OK');

  try {
    // ── Verificar pago con la API de MP ───────────────────
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN },
    });
    const payment = await mpRes.json();

    console.log('[mp-webhook] Estado:', payment.status, '| Monto:', payment.transaction_amount);

    if (payment.status !== 'approved') return res.status(200).end('OK');

    // ── Extraer datos del comprador ───────────────────────
    const buyerEmail = payment.payer?.email;
    const buyerName  = payment.payer?.first_name
                    || payment.additional_info?.payer?.first_name
                    || 'Cliente';
    const areaCode   = payment.additional_info?.payer?.phone?.area_code || '';
    const phoneNum   = payment.additional_info?.payer?.phone?.number    || '';
    const buyerPhone = payment.payer?.phone?.number || (areaCode + phoneNum) || null;
    const totalARS   = new Intl.NumberFormat('es-AR').format(payment.transaction_amount);

    console.log('[mp-webhook] Comprador:', buyerName, '| Email:', buyerEmail, '| Tel:', buyerPhone || 'no disponible');

    // ── Enviar email de entrega ───────────────────────────
    if (buyerEmail && process.env.GMAIL_USER) {
      await sendDeliveryEmail({ buyerEmail, buyerName, paymentId: dataId, totalARS });
    } else {
      console.warn('[mp-webhook] Sin email de comprador o GMAIL_USER no configurado');
    }

    // ── Enviar WhatsApp (si hay teléfono y credenciales) ──
    await sendWhatsApp({ phone: buyerPhone, buyerName, totalARS });

  } catch (err) {
    console.error('[mp-webhook] Error:', err.message);
    // Siempre 200 para que MP no reintente indefinidamente
  }

  return res.status(200).end('OK');
};
