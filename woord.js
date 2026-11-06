(function () {
  "use strict";
  // 📖 Woordhulp: zwevende knop. Tik, typ (of lasso eerst het woord) en krijg in gewone taal
  // uitgelegd wat het is. Uitgelegde woorden worden bewaard als eigen woordenlijst (op dit apparaat).
  const $ = id => document.getElementById(id);
  const LIST_KEY = "remy-ipad-woorden";
  const read = () => { try { const list = JSON.parse(localStorage.getItem(LIST_KEY) || "[]"); return Array.isArray(list) ? list : []; } catch (error) { return []; } };
  const save = list => { try { localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, 60))); } catch (error) { /* alleen gemak */ } };

  const fab = $("word-fab"), panel = $("word-panel"), input = $("word-input"), answer = $("word-answer"), status = $("word-status");
  if (!fab || !panel) return;

  function prompt(word) {
    return "Leg de term \"" + word + "\" uit aan Remy. Hij werkt als operator/monteur bij drinkwaterbedrijf PWN " +
      "(waterzuivering met onder andere UF, RO, AKF, pompen, meet- en regeltechniek, veiligheid zoals LMRA en TRA). " +
      "Schrijf in eenvoudig Nederlands, korte zinnen, geen moeilijke woorden in de uitleg zelf. Opbouw: " +
      "1) wat het is in één of twee zinnen; 2) als het een afkorting is: voluit; 3) een kort voorbeeld uit de praktijk bij drinkwater als dat past. " +
      "Maximaal 90 woorden, geen Markdown-koppen, geen opsommingstekens. Weet je het niet zeker, zeg dat dan eerlijk.";
  }

  function show(word, text) {
    answer.hidden = false;
    answer.replaceChildren(Object.assign(document.createElement("strong"), { textContent: word }), document.createElement("br"),
      document.createTextNode(text));
  }

  function renderList() {
    const list = read();
    const box = $("word-list");
    box.replaceChildren(...list.slice(0, 20).map(item => {
      const chip = Object.assign(document.createElement("button"), { type: "button", className: "word-chip", textContent: item.woord });
      chip.addEventListener("click", () => { input.value = item.woord; show(item.woord, item.uitleg); status.textContent = "Uit je woordenlijst (geen AI nodig)."; });
      return chip;
    }));
    $("word-list-head").hidden = !list.length;
  }

  async function explain() {
    const word = input.value.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!word) { status.textContent = "Typ eerst een woord of afkorting."; input.focus(); return; }
    const known = read().find(item => item.woord.toLowerCase() === word.toLowerCase());
    if (known) { show(known.woord, known.uitleg); status.textContent = "Uit je woordenlijst (geen AI nodig)."; return; }
    const hub = window.WorkplaceWerkhub;
    if (!window.AiChat || !hub) { status.textContent = "AI-module is niet geladen. Herlaad de app."; return; }
    if (!hub.hasAiConsent()) {
      if (!$("word-consent").checked) { $("word-consent-row").hidden = false; status.textContent = "Vink aan dat AI (Gemini, buiten PWN) het woord mag krijgen."; return; }
      hub.giveAiConsent();
    }
    $("word-go").disabled = true;
    status.textContent = "Even opzoeken…";
    try {
      const text = String(await window.AiChat.sendPrompt("gemini", prompt(word))).replace(/```[a-z]*\n?|```/gi, "").replace(/^#+\s*/gm, "").trim();
      if (!text) throw new Error("AI gaf geen uitleg terug.");
      show(word, text);
      save([{ woord: word, uitleg: text.slice(0, 2000) }, ...read().filter(item => item.woord.toLowerCase() !== word.toLowerCase())]);
      renderList();
      status.textContent = "Bewaard in je woordenlijst.";
    } catch (error) {
      status.textContent = `Opzoeken mislukt: ${error.message || error}`;
    } finally {
      $("word-go").disabled = false;
    }
  }

  // Lasso je eerst een woord (getypt of geschreven), dan wordt dat het zoekwoord.
  async function fromSelection() {
    const writing = window.WorkplaceWriting;
    let source = null;
    try { source = writing?.selectedStrokes?.().length || writing?.hasTypedSelection?.() ? writing.captureSelection() : null; } catch (error) { source = null; }
    if (!source || !source.selected) return;
    if (source.text) { input.value = source.text.split(/\s+/).slice(0, 6).join(" "); return; }
    if (!source.canvas || !window.WorkplaceWerkhub?.hasAiConsent()) return;
    status.textContent = "Geschreven woord lezen…";
    try {
      const image = window.AiChat.cropInk(source.canvas, { x: 0, y: 0, width: source.canvas.width, height: source.canvas.height });
      const text = String(await window.AiChat.recognizeHandwriting(image)).replace(/\[onleesbaar\]/gi, "").trim();
      if (text) { input.value = text.split(/\s+/).slice(0, 6).join(" "); status.textContent = "Klopt het woord? Tik dan op Leg uit."; }
      else status.textContent = "Kon het woord niet lezen. Typ het even.";
    } catch (error) {
      status.textContent = "Kon het woord niet lezen. Typ het even.";
    }
  }

  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    answer.hidden = true;
    status.textContent = "";
    $("word-consent-row").hidden = true;
    renderList();
    input.value = "";
    fromSelection();
    input.focus();
  }
  function close() { panel.hidden = true; fab.setAttribute("aria-expanded", "false"); }

  fab.addEventListener("click", () => (panel.hidden ? open() : close()));
  $("word-close").addEventListener("click", close);
  $("word-go").addEventListener("click", explain);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); explain(); } if (event.key === "Escape") close(); });
  for (const type of ["pointerdown", "touchstart"]) panel.addEventListener(type, event => event.stopPropagation());
  $("word-clear").addEventListener("click", () => { if (window.confirm("Je hele woordenlijst wissen?")) { save([]); renderList(); } });

  window.WorkplaceWord = { open, close, prompt };
})();
