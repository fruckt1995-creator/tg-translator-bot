// api/webhook.js
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      // Telegram надсилає JSON; у Vercel body вже розпарсений
      const update = req.body;
      console.log('Incoming update:', JSON.stringify(update));

      // Тут нічого не робимо, просто підтверджуємо отримання
      return res.status(200).send('OK');
    }

    // GET-запит — корисно для перевірки живості
    return res.status(200).send('OK');
  } catch (err) {
    // Навіть якщо щось впало, відповідь 200 — щоб Telegram не бачив 500
    console.error('Webhook handler error:', err);
    return res.status(200).send('OK');
  }
}
