"use strict";

/**
 * Telegram Translator Bot (rules: uk/ru -> pl, others -> ru)
 * - Autocorrect: mixed alphabet normalization + LanguageTool
 * - Works in private chats and groups (reply to original message)
 * - Commands: /setlang <code>, /mylang, /help (optional override per user)
 */

const { Telegraf } = require("telegraf");
const axios = require("axios");
require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error("Missing BOT_TOKEN in .env"); process.exit(1); }
const bot = new Telegraf(BOT_TOKEN);

/* ========= In-memory user language preferences (optional override) ========= */
const userPrefs = new Map(); // userId -> langCode (e.g., "pl","ru","uk","en","zh-cn"...)

/* ========= Helpers ========= */
const hasCyr  = s => /[А-Яа-яІіЇїЄєҐґЁёЪъЫыЭэ]/.test(s);
const looksUkr= s => /[ІіЇїЄєҐґ]/.test(s);
const looksRus= s => /[ЁёЪъЫыЭэ]/.test(s);

function normLang(code) {
  if (!code) return null;
  code = String(code).toLowerCase();
  const map = {
    "uk":"uk","ru":"ru","pl":"pl","en":"en","tr":"tr","de":"de","fr":"fr","es":"es","it":"it","pt":"pt",
    "ar":"ar","fa":"fa","hi":"hi","ja":"ja","ko":"ko","zh":"zh-cn","zh-hans":"zh-cn","zh-cn":"zh-cn",
    "zh-hant":"zh-tw","zh-tw":"zh-tw"
  };
  return map[code] || null;
}
function memoryPairCode(code) {
  const map = {"zh-cn":"ZH-CN","zh-tw":"ZH-TW"};
  return map[code] || code;
}

/* ========= Normalize mixed alphabets (e.g., 'привыт' -> 'привіт') ========= */
function normalizeMixed(text){
  const latinToCyr = {
    A:"А",a:"а",B:"В",E:"Е",e:"е",K:"К",k:"к",M:"М",m:"м",
    H:"Н",O:"О",o:"о",P:"Р",p:"р",C:"С",c:"с",T:"Т",t:"т",X:"Х",x:"х",
    I:"І",i:"і",Y:"У",y:"у"
  };
  const rusToUkr = { "ы":"и","Ы":"И","э":"е","Э":"Е","ъ":"ʼ","Ъ":"ʼ" };
  const isCyr = s=>/[А-Яа-яІіЇїЄєҐґ]/.test(s);
  const isLat = s=>/[A-Za-z]/.test(s);

  return text
    .split(/(\s+)/)
    .map(tok=>{
      tok = tok.replace(/[ыЫэЭъЪ]/g, ch => rusToUkr[ch] || ch);
      if (isCyr(tok) && isLat(tok)) tok = tok.replace(/[A-Za-z]/g, ch => latinToCyr[ch] || ch);
      return tok;
    })
    .join("");
}

/* ========= LanguageTool autocorrect ========= */
async function autocorrectWithLanguageTool(text){
  try{
    const params=new URLSearchParams();
    params.append("text", text);
    params.append("language", "auto");
    const r = await axios.post("https://api.languagetool.org/v2/check", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000
    });
    const matches = r?.data?.matches || [];
    if (!matches.length) return text;
    return applyLTReplacements(text, matches);
  }catch(e){
    console.warn("LanguageTool fail:", e?.response?.status || "", e?.message);
    return text;
  }
}
function applyLTReplacements(original, matches){
  const ms=[...matches].sort((a,b)=>(a.offset??0)-(b.offset??0));
  let out="", cursor=0;
  for(const m of ms){
    const off=m.offset??0, len=m.length??0, repl=m.replacements?.[0]?.value;
    if (off < cursor) continue;
    out += original.slice(cursor, off);
    out += (typeof repl==="string" ? repl : original.slice(off, off+len));
    cursor = off + len;
  }
  out += original.slice(cursor);
  return out;
}

/* ========= Detect language ========= */
async function detectLang(text){
  if (hasCyr(text)) {
    if (looksUkr(text)) return "uk";
    if (looksRus(text)) return "ru";
    return "uk";
  }
  try {
    const r = await axios.post("https://libretranslate.de/detect", { q: text }, {
      headers: { "Content-Type": "application/json" }, timeout: 8000
    });
    const lang = r?.data?.[0]?.language;
    if (typeof lang === "string" && lang.length === 2) return lang.toLowerCase();
  } catch(_) {}
  return "en";
}

/* ========= Translation providers ========= */
async function translateMyMemory(text, src, tgt) {
  try {
    const pair = `${memoryPairCode(src)}|${memoryPairCode(tgt)}`;
    const r = await axios.get("https://api.mymemory.translated.net/get", {
      params: { q: text, langpair: pair }, timeout: 12000
    });
    const out = r?.data?.responseData?.translatedText;
    if (out && typeof out === "string") return out.trim();
    return null;
  } catch(e){
    console.warn("MyMemory error:", e?.response?.status || "", e?.message);
    return null;
  }
}
async function translateLibre(text, src, tgt){
  const bases=["https://libretranslate.de","https://translate.astian.org"];
  for (const base of bases){
    try{
      const res = await axios.post(`${base}/translate`,
        { q:text, source:src, target:tgt, format:"text" },
        { headers:{ "Content-Type":"application/json" }, timeout: 12000 }
      );
      const d = res?.data;
      const t = d?.translatedText || d?.translated_text || (Array.isArray(d) && d[0]?.translatedText);
      if (t) return String(t).trim();
    }catch(e){
      console.warn(`LibreTranslate fail @ ${base}:`, e?.response?.status || "", e?.message);
    }
  }
  return null;
}
async function translateSmartToTarget(text, src, tgt){
  if (!src) src="auto";
  if (src!=="auto" && src.toLowerCase()===tgt.toLowerCase()) return null;
  let out = await translateMyMemory(text, src, tgt);
  if (out) return out;
  out = await translateLibre(text, src, tgt);
  if (out) return out;
  return null;
}

/* ========= Commands (optional per-user override) ========= */
const helpText =
`Команди:
/setlang <код> — зафіксувати вашу цільову мову (en, uk, ru, pl, tr, de, fr, es, it, ar, zh-cn, zh-tw)
/mylang — показати вашу цільову мову
/help — ця довідка

Правила за замовчуванням:
• якщо вхідна мова uk/ru → переклад у pl
• інакше → переклад у ru
/autocorrect: "привыт" → "привіт"`;

bot.start(ctx => ctx.reply("Привіт! За замовчуванням uk/ru → pl, інші → ru. Можна змінити для себе через /setlang. /help — деталі."));
bot.help(ctx  => ctx.reply(helpText));

bot.command("mylang", (ctx)=>{
  const pref = userPrefs.get(ctx.from.id) || "(не встановлено)";
  ctx.reply(`Ваше /setlang: ${pref}`);
});
bot.command("setlang", (ctx)=>{
  const parts = (ctx.message.text||"").trim().split(/\s+/);
  const raw = parts[1]?.toLowerCase();
  if (!raw) return ctx.reply("Вкажіть код мови. Напр.: /setlang pl");
  const normalized = normLang(raw) || raw;
  userPrefs.set(ctx.from.id, normalized);
  ctx.reply(`Готово! Цільова мова для вас: ${normalized}`);
});

/* ========= Main handler ========= */
bot.on("text", async (ctx)=>{
  try{
    if (ctx.from?.is_bot) return;

    const raw = ctx.message.text || "";

    // 1) normalize mixed alphabets
    const mixedFixed = normalizeMixed(raw);

    // 2) autocorrect with LanguageTool
    const corrected = await autocorrectWithLanguageTool(mixedFixed);

    // 3) detect source
    const src = await detectLang(corrected);

    // 4) determine target:
    //    - if user set /setlang -> use it
    //    - else: uk/ru -> pl; others -> ru
    const userId = ctx.from.id;
    const pref = userPrefs.get(userId); // comment out this line + 'if (pref)' block to ignore overrides
    let target;
    if (pref) {
      target = pref.toLowerCase();
    } else {
      const s = (src || "").toLowerCase();
      target = (s === "uk" || s === "ru") ? "pl" : "ru";
    }

    // 5) skip if same language
    if (src && target && src.toLowerCase() === target) return;

    // 6) translate
    const translated = await translateSmartToTarget(corrected, src, target);
    if (!translated) return;

    await ctx.reply(`Переклад (${src}→${target}):\n${translated}`, {
      reply_to_message_id: ctx.message.message_id
    });
  }catch(e){
    console.error("Handler error:", e?.message || e);
  }
});

/* ========= Start ========= */
bot.launch()
  .then(()=>console.log("🤖 Telegram bot started"))
  .catch(err=>{ console.error("Launch failed:", err?.message || err); process.exit(1); });

process.once("SIGINT", ()=>bot.stop("SIGINT"));
process.once("SIGTERM", ()=>bot.stop("SIGTERM"));
