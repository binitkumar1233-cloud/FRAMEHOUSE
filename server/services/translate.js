// Machine translation behind one function. Providers:
//   mymemory (default) - free MyMemory API, auto-detects the source language, 500-character limit per request
//   mock               - deterministic fake for tests / offline work ("mockfail" always errors)
// A provider failure throws TranslateError so the caller can keep showing the original text.

class TranslateError extends Error {}

// Languages offered in the UI. Anything else is rejected before a request is made.
const LANGUAGES = {
  en: "English", hi: "Hindi", bn: "Bengali", ta: "Tamil", te: "Telugu", mr: "Marathi", gu: "Gujarati", pa: "Punjabi",
  ur: "Urdu", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
  ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean", id: "Indonesian", tr: "Turkish", nl: "Dutch", th: "Thai",
};

const chunk = (text, size = 450) => {
  const parts = [];
  let current = "";
  for (const sentence of text.split(/(?<=[.!?।。！？\n])\s*/u)) {
    if (sentence.length > size) {
      if (current) parts.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += size) parts.push(sentence.slice(i, i + size));
      continue;
    }
    if ((current + " " + sentence).length > size) {
      parts.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) parts.push(current);
  return parts.filter((p) => p.trim());
};

const myMemory = async (text, target) => {
  const translated = [];
  let detected;
  for (const part of chunk(text)) {
    let data;
    try {
      const params = new URLSearchParams({ q: part, langpair: `Autodetect|${target}` });
      if (process.env.MYMEMORY_EMAIL) params.set("de", process.env.MYMEMORY_EMAIL);
      const response = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      throw new TranslateError(`Translation service unavailable (${error.message})`);
    }
    if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) {
      throw new TranslateError(String(data.responseDetails || "Translation failed").slice(0, 120));
    }
    // MyMemory answers its own error text with a 200 for some limits.
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(data.responseData.translatedText)) throw new TranslateError("Daily translation limit reached");
    translated.push(data.responseData.translatedText);
    detected = detected || data.responseData.detectedLanguage;
  }
  return { text: translated.join(" "), detectedLanguage: typeof detected === "string" ? detected.slice(0, 2).toLowerCase() : undefined };
};

const mock = async (text, target) => {
  if (process.env.TRANSLATE_PROVIDER === "mockfail") throw new TranslateError("Translation service unavailable (mock)");
  return { text: `[${target}] ${text}`, detectedLanguage: /[ऀ-ॿ]/.test(text) ? "hi" : "en" };
};

const translate = async (text, target) => {
  if (!LANGUAGES[target]) throw new TranslateError("That language isn't supported.");
  const provider = process.env.TRANSLATE_PROVIDER || "mymemory";
  if (provider === "mock" || provider === "mockfail") return mock(text, target);
  return myMemory(text, target);
};

module.exports = { translate, TranslateError, LANGUAGES };
