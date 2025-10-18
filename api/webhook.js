// api/webhook.js
// Vercel Serverless handler for Telegram webhook

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // <-- обов'язково додай у Vercel
const API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

// дуже груба мовна евристика: є кирилиця → вважаємо RU/UK → переклад у польську
// немає кирилиці → інші мови → переклад у російську (можеш змінити на 'uk' якщо треба)
const hasCyrillic = (s) => /[\u0400-\u04FF]/.test(s);

async function sendMessage(chat_id, text, reply_to_message_id) {
  const body = { chat_id, text, reply_to_message_id, parse_mode: 'HTML', disable_web_page_preview: true };
  const r = await fetch(API('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    console.error('sendMessage error:', r.status, j);
  }
}

// дуже простий переклад через MyMemory (без ключа)
async function translateMyMemory(text, from, to) {
  // MyMemory сам намагається детектити; але задаємо from|to
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j && j.responseData && j.responseData.translatedText) {
    return j.responseData.translatedText;
  }
  console.warn('MyMemory fallback used, raw:', j);
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Telegram інколи дергає GET — просто відповімо 200
    return res.status(200).send('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Telegram повинен отримати 200 швидко. Ми не «ранньо відповідаємо»,
    // бо тоді функція може завершитись до відправки повідомлення.
    const update = req.body || {};

    // Логи в Vercel → Deployments → Logs
    console.log('Incoming update:', JSON.stringify(update));

    if (!BOT_TOKEN) {
      console.error('No TELEGRAM_BOT_TOKEN in env!');
      return res.status(500).send('Missing token');
    }

    if (!update.message || !update.message.chat) {
      return res.status(200).send('no message');
    }

    const chatId = update.message.chat.id;
    const msgId  = update.message.message_id;
    const text   = (update.message.text || '').trim();

    if (!text) {
      await sendMessage(chatId, 'Надішли, будь ласка, текстове повідомлення.', msgId);
      return res.status(200).send('no text');
    }

    // Яка цільова мова?
    const target = hasCyrillic(text) ? 'pl' : 'ru'; // кирилиця → в польську, інші → у російську
    const source = hasCyrillic(text) ? 'uk' : 'en'; // приблизно (MyMemory все одно детектить)

    // спроба перекладу
    let translated = null;
    try {
      translated = await translateMyMemory(text, source, target);
    } catch (e) {
      console.error('Translate error:', e);
    }

    // якщо не вдалось — віддамо оригінал, аби хоч щось прийшло
    const out = translated || text;

    await sendMessage(chatId, out, msgId);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(200).send('ok'); // все одно 200, щоб TG не ретраїв
  }
}
