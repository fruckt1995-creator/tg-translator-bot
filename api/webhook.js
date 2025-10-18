// api/webhook.js

// Повертаємо 200 навіть у разі помилки — щоб Telegram не бачив 500
export default async function handler(req, res) {
  try {
    // Перевіряємо токен в env (читаємо обидва варіанти, щоб не було плутанини)
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

    if (!TOKEN) {
      console.error('No TELEGRAM_BOT_TOKEN / BOT_TOKEN in env!');
      // ВАЖЛИВО: відповідаємо 200, щоб Telegram не відключав вебхук
      return res.status(200).send('OK');
    }

    if (req.method !== 'POST') {
      return res.status(200).send('OK');
    }

    const update = req.body;
    console.log('Incoming update:', JSON.stringify(update));

    // ---- ТУТ БУДЕ ТВІЙ ЛОГІЧНИЙ КОД (переклад, відповіді і т.д.) ----
    // Поки що просто підтверджуємо отримання, щоб прибрати 500.
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Все одно повертаємо 200 — хай Telegram продовжує слати апдейти
    return res.status(200).send('OK');
  }
}
