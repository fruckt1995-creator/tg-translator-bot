// api/webhook.js
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const TOKEN =
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BOT_TOKEN ||
      process.env.TELEGRAM_TOKEN;

    if (!TOKEN) {
      console.error("NO TELEGRAM_BOT_TOKEN in env!");
      return res.status(500).send("NO TOKEN");
    }

    // Vercel інколи дає body вже розібраним
    const update = req.body || JSON.parse(req.body || "{}");
    console.log("Incoming update:", JSON.stringify(update));

    const msg =
      update.message || update.edited_message || update.callback_query?.message;

    const chatId = msg?.chat?.id;
    const text =
      update.message?.text ||
      update.edited_message?.text ||
      update.callback_query?.data ||
      "";

    if (chatId) {
      // простий echo — щоб переконатись, що відповіді доходять
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text ? `echo: ${text}` : "✅ бот живий",
          reply_to_message_id: update.message?.message_id,
          disable_web_page_preview: true,
        }),
      });
    }

    return res.status(200).send("OK");
  } catch (e) {
    console.error("Handler error:", e?.message || e);
    // Відповідаємо 200, щоб Telegram не ретраїв
    return res.status(200).send("OK");
  }
};
