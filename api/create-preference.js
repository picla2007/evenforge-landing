// netlify/functions/create-preference.js
// En Netlify las funciones usan exports.handler en lugar de module.exports

const nodemailer = require('nodemailer'); // solo para referencia, no se usa aquí

exports.handler = async function (event) {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let email;
  try {
    const body = JSON.parse(event.body || '{}');
    email = body.email;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  const APP_URL = process.env.APP_URL;
  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

  if (!MP_ACCESS_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'MP_ACCESS_TOKEN no configurado' }) };
  }

  const preference = {
    items: [{
      id: 'evenflow-pro-001',
      title: 'EvenFlow Pro — Acceso completo',
      description: 'Acceso permanente a EvenFlow Pro',
      quantity: 1,
      currency_id: 'ARS',
      unit_price: parseFloat(process.env.PRODUCT_PRICE || '15000')
    }],
    payer: { email },
    back_urls: {
      success: APP_URL + '/success.html?status=approved',
      failure: APP_URL + '/?error=pago_rechazado',
      pending: APP_URL + '/success.html?status=pending'
    },
    auto_return: 'approved',
    notification_url: APP_URL + '/.netlify/functions/webhook',
    statement_descriptor: 'EVENFLOW PRO',
    external_reference: email + '|' + Date.now()
  };

  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN
      },
      body: JSON.stringify(preference)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('MP error:', data);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error en MercadoPago' }) };
    }

    const url = process.env.MP_SANDBOX === 'true' ? data.sandbox_init_point : data.init_point;
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
