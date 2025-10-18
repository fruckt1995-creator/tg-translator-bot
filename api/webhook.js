// api/webhook.js
import axios from "axios";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("OK"); // для пінгу
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.error("❌ No TELEGRAM_BOT_TOKEN in env!");
    return res.status(200).send("OK"); // щоб Telegram не ретраїв
  }

  const update = req.body;
  console.log("Incoming update:", JSON.stringify(update));

  try {
    const msg =
      update.message ||
      update.edited_message ||
      update.callback_query?.message;

    const chatId = msg?.chat?.id;
    const messageId = msg?.message_id;

    const incomingText =
      update.message?.text ||
      update.edited_message?.text ||
      update.callback_query?.data ||
      "";

    if (!chatId) {
      console.log("No chat_id in update → nothing to do");
      return res.status(200).send("OK");
    }

    const replyText =
      incomingText?.trim()
        ? `✅ Отримав: ${incomingText}`
        : "👋 Привіт! Надішли мені текст — я відповім.";

    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: replyText,
      reply_to_message_id: messageId,
    };

    const tgResp = await axios.post(url, payload, { timeout: 15000 });
    console.log("sendMessage OK:", tgResp.data);
  } catch (err) {
    const data = err?.response?.data;
    console.error("sendMessage ERROR:", data || err.message || err);
  }

  // ПОВИННІ швидко відповісти 200, інакше Telegram робить ретраї
  return res.status(200).send("OK");
}
