(function () {
  "use strict";
  // Inspreken: 🎤 bij elk tekstveld (meetstatus, observaties, notities, taak, titel) en op het blad.
  // Opname wordt WAV (16 kHz mono) en gaat via werkplek-ai naar Gemini, die het uitschrijft.
  const CONSENT_KEY = "remy-ipad-ai-voice-consent";
  const MAX_SECONDS = 120;
  const TARGET_RATE = 16000;
  let current = null; // lopende opname

  const consent = () => { try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch (error) { return false; } };
  function askConsent() {
    if (consent()) return true;
    const ok = window.confirm("Inspreken stuurt je opname naar Gemini (Google, buiten PWN) om hem uit te schrijven. De opname wordt niet bewaard. Akkoord? (wordt onthouden)");
    if (ok) { try { localStorage.setItem(CONSENT_KEY, "1"); } catch (error) { /* vraagt volgende keer opnieuw */ } }
    return ok;
  }

  function downsample(buffer, rate) {
    if (rate === TARGET_RATE) return buffer;
    const ratio = rate / TARGET_RATE;
    const length = Math.floor(buffer.length / ratio);
    const result = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const start = Math.floor(index * ratio), end = Math.min(buffer.length, Math.floor((index + 1) * ratio));
      let sum = 0;
      for (let k = start; k < end; k++) sum += buffer[k];
      result[index] = end > start ? sum / (end - start) : 0;
    }
    return result;
  }

  function wav(samples) {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(bytes);
  }

  function base64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function start(onTick) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Deze browser laat geen microfoon toe. Gebruik Safari of Chrome.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const Context = window.AudioContext || window.webkitAudioContext;
    const ctx = new Context();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    processor.onaudioprocess = event => { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
    source.connect(processor);
    processor.connect(ctx.destination);
    const began = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - began) / 1000);
      onTick(seconds);
      if (seconds >= MAX_SECONDS && current) current.stop();
    }, 250);
    let resolveStop;
    const done = new Promise(resolve => { resolveStop = resolve; });
    current = {
      stop() {
        if (!current) return;
        current = null;
        clearInterval(timer);
        processor.disconnect(); source.disconnect();
        stream.getTracks().forEach(track => track.stop());
        const rate = ctx.sampleRate;
        ctx.close().catch(() => {});
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
        resolveStop({ samples: downsample(merged, rate), seconds: total / rate });
      }
    };
    return done;
  }

  async function transcribe(samples) {
    const ai = window.AiChat;
    if (!ai || typeof ai.transcribe !== "function") throw new Error("AI-module is niet geladen. Herlaad de app.");
    const text = (await ai.transcribe({ mimeType: "audio/wav", data: base64(wav(samples)) })).trim();
    if (!text || text === "[niets verstaan]") throw new Error("Niets verstaan. Probeer het nog eens, iets dichter bij de microfoon.");
    return text;
  }

  // Opnemen met een knop: eerste tik start, tweede tik stopt. Geeft de tekst terug.
  async function record(button) {
    if (current) { current.stop(); return null; }
    if (!askConsent()) return null;
    const html = button.innerHTML;
    button.classList.add("rec");
    button.textContent = "■ 0:00";
    button.setAttribute("aria-label", "Stop opname");
    try {
      const result = await start(seconds => { button.textContent = `■ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; });
      button.classList.remove("rec");
      if (result.seconds < .6) throw new Error("Opname te kort.");
      button.classList.add("busy");
      button.textContent = "✍️…";
      return await transcribe(result.samples);
    } finally {
      button.classList.remove("rec", "busy");
      button.innerHTML = html;
      button.setAttribute("aria-label", "Inspreken");
    }
  }

  function insert(field, text) {
    const value = field.value;
    const start = typeof field.selectionStart === "number" && document.activeElement === field ? field.selectionStart : value.length;
    const end = typeof field.selectionEnd === "number" && document.activeElement === field ? field.selectionEnd : value.length;
    const before = value.slice(0, start), after = value.slice(end);
    const glue = before && !/\s$/.test(before) ? " " : "";
    const max = field.maxLength > 0 ? field.maxLength : Infinity;
    field.value = (before + glue + text + after).slice(0, max);
    const caret = Math.min(field.value.length, (before + glue + text).length);
    try { field.setSelectionRange(caret, caret); } catch (error) { /* sommige invoertypes */ }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function say(text) {
    if (window.WorkplaceWriting?.notify) window.WorkplaceWriting.notify(text);
    else alert(text);
  }

  // ---- 🎤 bij tekstvelden ----
  const SELECTOR = "#writing textarea, #measurement-editor input[type=text], #measurement-editor input:not([type]), #title, #task-text, #writing-ai-prompt, #ai-prompt";
  function attach(field) {
    if (field.dataset.dictate === "1" || field.type === "hidden" || field.closest(".dictate-wrap")) return;
    field.dataset.dictate = "1";
    const wrap = document.createElement("span");
    wrap.className = "dictate-wrap" + (field.tagName === "INPUT" ? " inline" : "");
    field.parentNode.insertBefore(wrap, field);
    wrap.append(field);
    const button = Object.assign(document.createElement("button"), { type: "button", className: "dictate-btn", textContent: "🎤", title: "Inspreken" });
    button.setAttribute("aria-label", "Inspreken");
    button.addEventListener("pointerdown", event => event.preventDefault()); // focus/cursor in het veld houden
    button.addEventListener("click", async () => {
      try {
        const text = await record(button);
        if (text) insert(field, text);
      } catch (error) {
        say(error.name === "NotAllowedError" ? "Microfoon geweigerd. Sta de microfoon toe voor deze site (Instellingen > Safari > Microfoon)." : error.message || String(error));
      }
    });
    wrap.append(button);
  }
  const scan = root => root.querySelectorAll?.(SELECTOR).forEach(attach);
  scan(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(SELECTOR)) attach(node);
      scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ---- 🎤 op het blad: wordt een tekstblok ----
  const sheetButton = document.getElementById("dictate-sheet");
  sheetButton?.addEventListener("click", async () => {
    const writing = window.WorkplaceWriting;
    try {
      const id = writing.currentId();
      const text = await record(sheetButton);
      if (text) { writing.insertAnswer(id, text); say("Ingesproken tekst staat op het blad. Ongedaan haalt hem weg."); }
    } catch (error) {
      say(error.name === "NotAllowedError" ? "Microfoon geweigerd. Sta de microfoon toe voor deze site." : error.message || String(error));
    }
  });

  window.WorkplaceDictate = { record, insert, wav, downsample, attach };
})();
