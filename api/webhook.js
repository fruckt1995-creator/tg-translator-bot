
// api/webhook.js — Vercel serverless webhook (CommonJS)
// Повна логіка: автокорекція, мішані літери, LanguageTool, uk/ru→pl; інші→ru, /setlang,/mylang,/help

const { Telegraf } = require("telegraf");

// ⚠️ На Vercel ми НЕ запускаємо bot.launch()
// Ми приймаємо HTTP POST і прокидуємо update у Telegraf.

const userPrefs = new Map(); // userId -> langCode

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

async function autocorrectWithLanguageTool(text){
  try{
    const params = new URLSearchParams();
    params.append("text", text);
    params.append("language", "auto");
    const r = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    const data = await r.json().catch(()=>null);
    const matches = data?.matches || [];
    if (!matches.length) return text;
    return applyLTReplacements(text, matches);
  }catch(e){
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

async function detectLang(text){
  if (hasCyr(text)) {
    if (looksUkr(text)) return "uk";
    if (looksRus(text)) return "ru";
    return "uk";
  }
  try {
    const r = await fetch("https://libretranslate.de/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text })
    });
    const data = await r.json().catch(()=>null);
    const lang = data?.[0]?.language;
    if (typeof lang === "string" && lang.length === 2) return lang.toLowerCase();
  }catch(_){}
  return "en";
}

async function translateMyMemory(text, src, tgt){
  try{
    const pair = `${memoryPairCode(src)}|${memoryPairCode(tgt)}`;
    const url = "https://api.mymemory.translated.net/get?" + new URLSearchParams({ q: text, langpair: pair });
    const r = await fetch(url);
    const d = await r.json();
    const out = d?.responseData?.translatedText;
    if (out && typeof out === "string") return out.trim();
  }catch(e){}
  return null;
}

async function translateLibre(text, src, tgt){
  const bases = ["https://libretranslate.de","https://translate.astian.org"];
  for (const base of bases){
    try{
      const r = await fetch(`${base}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q:text, source:src, target:tgt, format:"text" })
      });
      const d = await r.json().catch(()=>null);
      const t = d?.translatedText || d?.translated_text || (Array.isArray(d) && d[0]?.translatedText);
      if (t) return String(t).trim();
    }catch(e){}
  }
  return null;
}

async function translateSmartToTarget(text, src, tgt){
  if (!src) src = "auto";
  if (src!=="auto" && src.toLowerCase()===tgt.toLowerCase()) return null;
  let out = await translateMyMemory(text, src, tgt);
  if (out) return out;
  out = await translateLibre(text, src, tgt);
  if (out) return out;
  return null;
}

let bot = null;
function ensureBot(){
  if (bot) return bot;
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  const b = new Telegraf(token);

  const helpText = \`Команди:
  /setlang <код> — зафіксувати цільову мову
  /mylang — показати цільову мову
  /help — допомога
  За замовчуванням: uk/ru → pl, інші → ru.\`;

  b.start(ctx => ctx.reply("Привіт! Я готовий перекладати."));
  b.help(ctx => ctx.reply(helpText));
  b.command("mylang", ctx => {
    const pref = userPrefs.get(ctx.from.id) || "(не встановлено)";
    ctx.reply(\`Ваше /setlang: \${pref}\`);
  });
  b.command("setlang", ctx => {
    const parts = (ctx.message.text||"").trim().split(/\s+/);
    const raw = parts[1]?.toLowerCase();
    if (!raw) return ctx.reply("Вкажіть код мови. Напр.: /setlang pl");
    const normalized = normLang(raw) || raw;
    userPrefs.set(ctx.from.id, normalized);
    ctx.reply(\`Готово! Цільова мова для вас: \${normalized}\`);
  });

  b.on("text", async (ctx)=>{
    try{
      if (ctx.from?.is_bot) return;
      const raw = ctx.message.text || "";
      const mixedFixed = normalizeMixed(raw);
      const corrected = await autocorrectWithLanguageTool(mixedFixed);
      const src = await detectLang(corrected);
      const pref = userPrefs.get(ctx.from.id);
      let target = pref ? pref.toLowerCase() : ((src==="uk"||src==="ru")?"pl":"ru");
      if (src && target && src.toLowerCase() === target) return;
      const translated = await translateSmartToTarget(corrected, src, target);
      if (!translated) return;
      await ctx.reply(\`Переклад (\${src}→\${target}):\n\${translated}\`, { reply_to_message_id: ctx.message.message_id });
    }catch(e){}
  });

  bot = b;
  return bot;
}

module.exports = async (req, res) => {
  try{
    if (req.method !== "POST") return res.status(200).send("ok");
    const b = ensureBot();
    await b.handleUpdate(req.body);
    return res.status(200).send("ok");
  }catch(e){
    return res.status(200).send("ok");
  }
};
