
// netlify/functions/webhook.js
// Recibe el IPN de MercadoPago, verifica el pago y envía el email de entrega

const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

async function getPaymentInfo(paymentId) {
  const res = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
    headers: { 'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN }
  });
  return res.json();
}

async function sendDeliveryEmail(buyerEmail, paymentId) {
  const transporter = createTransporter();
  const productUrl = 'https://evenflow-pro-single.netlify.app';
  const senderName = process.env.SENDER_NAME || 'EvenFlow Pro';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#13131a;border:1px solid #1e1e2e;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#7c5cfc,#5a3fd4);padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:26px;font-weight:800;color:#fff;">EvenFlow Pro</p>
            <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase;">Acceso activado</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0eff6;">¡Tu compra fue confirmada!</p>
            <p style="margin:0 0 28px;font-size:14px;color:#7070a0;line-height:1.6;">Gracias por tu compra. A continuación encontrás tu acceso a EvenFlow Pro.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(124,92,252,.08);border:1px solid rgba(124,92,252,.25);border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:22px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#7c5cfc;letter-spacing:.08em;text-transform:uppercase;">🚀 Tu acceso</p>
                  <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#f0eff6;">${productUrl}</p>
                  <a href="${productUrl}" style="display:inline-block;background:#7c5cfc;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:700;font-size:14px;">
                    Acceder a EvenFlow Pro →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px;font-size:12px;color:#7070a0;">Guardá este email — contiene tu link de acceso.</p>
            <p style="margin:0;font-size:12px;color:#7070a0;">ID de pago: <span style="color:#c0bfd8;font-family:monospace;">${paymentId}</span></p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px;border-top:1px solid #1e1e2e;text-align:center;">
            <p style="margin:0;font-size:11px;color:#7070a0;">© 2026 EvenFlow Pro</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `"${senderName}" <${process.env.GMAIL_USER}>`,
    to: buyerEmail,
    subject: '✅ Tu acceso a EvenFlow Pro está listo',
    html
  });

  console.log('✅ Email enviado a:', buyerEmail);
}

exports.handler = async function (event) {
  // Responder 200 inmediatamente (MP exige respuesta rápida)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, body: 'OK' };
  }

  const { type, data } = body;
  const params = event.queryStringParameters || {};
  const topic = params.topic;

  console.log('Webhook recibido:', { type, topic });

  const isPayment = type === 'payment' || topic === 'payment';
  if (!isPayment) {
    return { statusCode: 200, body: 'OK' };
  }

  const paymentId = data?.id || params.id;
  if (!paymentId) {
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const payment = await getPaymentInfo(paymentId);
    console.log('Estado del pago:', payment.status, '| Email:', payment.payer?.email);

    if (payment.status !== 'approved') {
      return { statusCode: 200, body: 'OK' };
    }

    const buyerEmail = payment.payer?.email;
    if (!buyerEmail) {
      return { statusCode: 200, body: 'OK' };
    }

    await sendDeliveryEmail(buyerEmail, paymentId);

  } catch (err) {
    console.error('Error en webhook:', err);
  }

  return { statusCode: 200, body: 'OK' };
};
