
/**
 * POST /api/mp-webhook
 *
 * Webhook que MercadoPago llama cuando el estado de un pago cambia.
 * Si el pago está APROBADO → envía email con el link de descarga del producto.
 *
 * Variables de entorno requeridas:
 *   MP_ACCESS_TOKEN       → Token de MercadoPago
 *   RESEND_API_KEY        → API key de Resend (resend.com — free tier: 3000 emails/mes)
 *   FROM_EMAIL            → noreply@tudominio.com  (debe estar verificado en Resend)
 *   FROM_NAME             → EvenForge Pro
 *   PRODUCT_DOWNLOAD_URL  → https://drive.google.com/... (link directo al producto)
 *   PRODUCT_NAME          → EvenForge Pro — Sistema completo
 *
 * Flujo:
 *   MP llama → verificamos pago con API de MP → si approved → enviamos email → 200 OK
 *   MP reintenta si recibe algo distinto a 2xx, por eso respondemos rápido.
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // MP envía GET con ?topic=payment&id=xxx para validación inicial
  if (req.method === 'GET') {
    return new Response('OK', { status: 200 });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── Parseamos la notificación de MP
  let notification;
  try { notification = await req.json(); }
  catch {
    // MP a veces envía form-encoded — igual respondemos 200 para que no reintente
    return new Response('OK', { status: 200 });
  }

  console.log('[mp-webhook] Notification:', JSON.stringify(notification));

  // MP envía distintos tipos: payment, merchant_order, etc.
  // Solo nos interesa "payment"
  const topic    = notification.topic || notification.type;
  const payId    = notification.data?.id || notification.id;

  if (topic !== 'payment' || !payId) {
    // Ignoramos silenciosamente otros topics pero respondemos 200
    return new Response('OK', { status: 200 });
  }

  // ── Verificamos el pago con la API de MP (nunca confiar solo en el webhook)
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[mp-webhook] MP_ACCESS_TOKEN not set');
    return new Response('Config error', { status: 500 });
  }

  let payment;
  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!mpRes.ok) {
      console.error('[mp-webhook] Failed to fetch payment:', payId);
      return new Response('MP fetch error', { status: 502 });
    }
    payment = await mpRes.json();
  } catch (err) {
    console.error('[mp-webhook] Network error fetching payment:', err);
    return new Response('Network error', { status: 502 });
  }

  console.log('[mp-webhook] Payment status:', payment.status, '| ID:', payId);

  // Solo procesamos pagos APROBADOS
  if (payment.status !== 'approved') {
    // Respondemos 200 igual para que MP no reintente indefinidamente
    return new Response('OK — non-approved status ignored', { status: 200 });
  }

  // ── Evitar duplicados: MP puede llamar varias veces al webhook
  // En producción usarías Redis/KV para marcar el payment_id como procesado.
  // Por ahora: si el status_detail es "accredited" procedemos; si no, ignoramos.
  if (payment.status_detail !== 'accredited') {
    return new Response('OK — not accredited yet', { status: 200 });
  }

  // ── Obtenemos el email del comprador
  const buyerEmail = payment.payer?.email;
  if (!buyerEmail) {
    console.error('[mp-webhook] No payer email found for payment:', payId);
    return new Response('No email', { status: 200 }); // No reintentamos
  }

  // ── Enviamos el email con el producto
  const sent = await sendProductEmail({
    to:    buyerEmail,
    name:  payment.payer?.first_name || 'Cliente',
    payId: String(payId),
    amount: `$${Number(payment.transaction_amount).toLocaleString('es-AR')}`,
  });

  if (!sent) {
    // Devolvemos 500 para que MP reintente (el email falló)
    return new Response('Email send failed', { status: 500 });
  }

  console.log('[mp-webhook] Product delivered to:', buyerEmail, '| payment:', payId);
  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// Email via Resend  (resend.com — free: 3.000 emails/mes)
// ─────────────────────────────────────────────────────────────
async function sendProductEmail({ to, name, payId, amount }) {
  const resendKey   = process.env.RESEND_API_KEY;
  const fromEmail   = process.env.FROM_EMAIL    || 'noreply@evenforge.pro';
  const fromName    = process.env.FROM_NAME     || 'EvenForge Pro';
  const productUrl  = process.env.PRODUCT_DOWNLOAD_URL;
  const productName = process.env.PRODUCT_NAME  || 'EvenForge Pro — Sistema completo';

  if (!resendKey) {
    console.error('[mp-webhook] RESEND_API_KEY not set');
    return false;
  }
  if (!productUrl) {
    console.error('[mp-webhook] PRODUCT_DOWNLOAD_URL not set');
    return false;
  }

  const html = buildEmailHTML({ name, productName, productUrl, amount, payId });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `${fromName} <${fromEmail}>`,
        to:      [to],
        subject: `✅ Tu acceso a ${productName} está listo`,
        html,
        // Texto plano como fallback
        text: `Hola ${name}! Tu pago fue aprobado. Accedé a ${productName} acá: ${productUrl} — Número de pago: ${payId}`,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[mp-webhook] Resend error:', JSON.stringify(data));
      return false;
    }
    return true;

  } catch (err) {
    console.error('[mp-webhook] Resend network error:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Template del email — responsive, sin dependencias externas
// ─────────────────────────────────────────────────────────────
function buildEmailHTML({ name, productName, productUrl, amount, payId }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu acceso a ${productName}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header gradient -->
        <tr>
          <td style="background:linear-gradient(135deg,#dc2626,#f59e0b);padding:32px 32px 24px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🎉</div>
            <h1 style="color:white;font-size:22px;font-weight:800;margin:0;line-height:1.2;">
              ¡Pago aprobado!
            </h1>
            <p style="color:rgba(255,255,255,.85);font-size:14px;margin:6px 0 0;">
              Tu compra de <strong>${amount}</strong> fue procesada con éxito
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="font-size:16px;color:#374151;margin:0 0 20px;">
              Hola <strong>${name}</strong>,
            </p>
            <p style="font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
              Tu acceso a <strong>${productName}</strong> está listo. 
              Hacé clic en el botón para descargar tu producto:
            </p>

            <!-- CTA button -->
            <div style="text-align:center;margin:28px 0;">
              <a href="${productUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#dc2626,#f59e0b);
                        color:white;text-decoration:none;padding:15px 40px;border-radius:12px;
                        font-size:16px;font-weight:800;letter-spacing:.3px;">
                📥 Acceder a ${productName}
              </a>
            </div>

            <p style="font-size:13px;color:#6b7280;margin:16px 0 0;line-height:1.6;">
              Si el botón no funciona, copiá este link en tu navegador:<br>
              <a href="${productUrl}" style="color:#dc2626;word-break:break-all;">${productUrl}</a>
            </p>

            <!-- Divider -->
            <div style="border-top:1px solid #f1f5f9;margin:28px 0;"></div>

            <!-- Details -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f8fafc;border-radius:10px;padding:16px;">
                  <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">
                    Detalles de tu compra
                  </div>
                  <div style="font-size:13px;color:#374151;margin-bottom:4px;">
                    <span style="color:#6b7280;">Producto:</span> ${productName}
                  </div>
                  <div style="font-size:13px;color:#374151;margin-bottom:4px;">
                    <span style="color:#6b7280;">Total pagado:</span> ${amount}
                  </div>
                  <div style="font-size:13px;color:#374151;">
                    <span style="color:#6b7280;">N° de pago:</span> ${payId}
                  </div>
                </td>
              </tr>
            </table>

            <p style="font-size:13px;color:#6b7280;margin:24px 0 0;line-height:1.6;">
              ¿Tuviste algún problema? Respondé este email o escribinos por 
              <a href="https://wa.me/5491135881631" style="color:#dc2626;">WhatsApp</a> 
              y te ayudamos en minutos.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #f1f5f9;">
            <p style="font-size:11px;color:#9ca3af;margin:0;">
              © 2026 EvenForge Pro · joselotobias@gmail.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
