// api/webhook.js
export const config = { runtime: "edge" };

/**
 * Telegram Translator Webhook (Vercel Edge)
 * Правила:
 *   - uk/ru → pl
 *   - інші → ru
 * Автокорекція змішаних розкладок + fallback на MyMemory, якщо ШІ повернув той самий текст.
 */

const TG_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  "";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

const TG_API = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : null;

// ---- env
function assertEnv() {
  if (!TG_TOKEN || !TG_API) throw new Error("No TELEGRAM_BOT_TOKEN in env!");
  if (!OPENAI_KEY) throw new Error("No OPENAI_API_KEY in env!");
}

// ---- Telegram helpers
async function tgCall(method, body) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) console.warn("Telegram error:", j);
  return j;
}
const sendChatAction = (chat_id, action="typing") => tgCall("sendChatAction", { chat_id, action });
const sendMessage   = (chat_id, text, reply_to_message_id) =>
  tgCall("sendMessage", { chat_id, text, reply_to_message_id });

// ---- lang detection (грубо, локально)
const rxCyr = /[А-Яа-яЁёІіЇїЄєҐґЪъЫыЭэ]/;
const rxUkr = /[ІіЇїЄєҐґ]/;
const rxRus = /[ЁёЪъЫыЭэ]/;
function detectLangLocal(text) {
  if (rxCyr.test(text)) {
    if (rxUkr.test(text)) return "uk";
    if (rxRus.test(text)) return "ru";
    return "uk";
  }
  return "en";
}
function pickTargetLang(src) {
  const s = (src || "").toLowerCase();
  return s === "uk" || s === "ru" ? "pl" : "ru";
}

// ---- normalize mixed layout
function normalizeMixed(text) {
  const latinToCyr = {
    A:"А",a:"а",B:"В",E:"Е",e:"е",K:"К",k:"к",M:"М",m:"м",
    H:"Н",O:"О",o:"о",P:"Р",p:"р",C:"С",c:"с",T:"Т",t:"т",X:"Х",x:"х",
    I:"І",i:"і",Y:"У",y:"у"
  };
  const rusToUkr = { "ы":"и","Ы":"И","э":"е","Э":"Е","ъ":"ʼ","Ъ":"ʼ" };
  return text
    .split(/(\s+)/)
    .map(tok => {
      tok = tok.replace(/[ыЫэЭъЪ]/g, ch => rusToUkr[ch] || ch);
      if (/[A-Za-z]/.test(tok) && rxCyr.test(tok)) {
        tok = tok.replace(/[A-Za-z]/g, ch => latinToCyr[ch] || ch);
      }
      return tok;
    })
    .join("");
}

// ---- OpenAI translate (жорстка інструкція + response_format)
async function translateWithAI(text, src, tgt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "text" },
      messages: [
        {
          role: "system",
          content: [
            "You are a professional translator.",
            "ALWAYS translate the user's message into the exact TARGET language.",
            "Fix mixed keyboard (Latin/Cyrillic), typos and punctuation if necessary.",
            "Return ONLY the translated text. No quotes, no explanations."
          ].join(" ")
        },
        {
          role: "user",
          content: `TARGET=${tgt}\nSOURCE=${src}\nTEXT:\n${text}`
        }
      ]
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    console.warn("OpenAI HTTP error:", res.status, t);
    return null;
  }
  const data = await res.json().catch(()=> null);
  return data?.choices?.[0]?.message?.content?.trim?.() || null;
}

// ---- Fallback: MyMemory (без ключа)
async function translateFallback(text, src, tgt) {
  const map = { "zh-cn":"ZH-CN", "zh-tw":"ZH-TW" };
  const pair = `${(map[src]||src).toUpperCase()}|${(map[tgt]||tgt).toUpperCase()}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;
  try {
    const r = await fetch(url, { method:"GET" });
    if (!r.ok) return null;
    const j = await r.json();
    const out = j?.responseData?.translatedText;
    return (typeof out === "string" ? out.trim() : null);
  } catch { return null; }
}

export default async function handler(req) {
  try { assertEnv(); } catch (e) {
    console.error(e.message || e);
    return new Response("OK", { status: 200 });
  }
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let update;
  try { update = await req.json(); } catch { return new Response("OK", { status: 200 }); }

  const msg = update?.message;
  const chat_id = msg?.chat?.id;
  const text = (msg?.text || "").trim();
  if (!chat_id || !text) return new Response("OK", { status: 200 });

  await sendChatAction(chat_id, "typing").catch(()=>{});

  const fixed = normalizeMixed(text);
  const src = detectLangLocal(fixed);
  const tgt = pickTargetLang(src);

  // 1) AI
  let translated = await translateWithAI(fixed, src, tgt);

  // 2) якщо не перекладено або збігається — спроба ще раз з коротшою інструкцією
  if (!translated || translated.trim() === fixed.trim()) {
    const res2 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "text" },
        messages: [
          { role: "system", content: "Translate strictly to TARGET. Output ONLY the translated text." },
          { role: "user", content: `TARGET=${tgt}\nTEXT:\n${fixed}` }
        ]
      }),
    });
    if (res2.ok) {
      const j2 = await res2.json().catch(()=> null);
      translated = j2?.choices?.[0]?.message?.content?.trim?.() || translated;
    }
  }

  // 3) Fallback на MyMemory, якщо все ще збігається або порожньо
  if (!translated || translated.trim() === fixed.trim()) {
    translated = await translateFallback(fixed, src, tgt);
  }

  if (!translated || !translated.trim()) return new Response("OK", { status: 200 });

  await sendMessage(chat_id, translated, msg.message_id).catch(()=>{});
  return new Response("OK", { status: 200 });
}
