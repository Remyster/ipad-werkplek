(function () {
  "use strict";
  // Slimme notities (zoeken + AI-titels), vangnet (versies + prullenbak) en taakvakjes.
  const $ = id => document.getElementById(id);
  const W = () => window.WorkplaceWriting;
  const H = () => window.WorkplaceWerkhub;
  const S = () => window.WorkplaceStore;
  const ready = () => !!(W() && typeof W().listDocuments === "function");
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (error) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (error) { /* alleen gemak */ } };
  const loggedIn = () => { try { window.WorkplaceConnections.session(localStorage); return true; } catch (error) { return false; } };
  const time = at => new Date(at).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
    return (value >>> 0).toString(36) + ":" + text.length;
  }

  // ================= Taakvakjes =================
  const BOX_KEY = "remy-ipad-boxes";
  const boxesOn = () => read(BOX_KEY, "1") !== "0";
  const bounds = stroke => W().strokeBounds(stroke);
  const overlaps = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

  // Een getekend vierkantje: gesloten, ongeveer vierkant, met vier echte hoeken (een "o" of cirkel valt af).
  function isBoxStroke(stroke) {
    if (stroke.box || stroke.brush === "highlighter") return false;
    const b = bounds(stroke);
    const w = b.right - b.left - stroke.width, h = b.bottom - b.top - stroke.width;
    const size = Math.max(w, h);
    if (size < 12 || size > 90 || Math.min(w, h) / size < .6) return false;
    if (stroke.shape) return stroke.shape === "rectangle";
    const points = stroke.points;
    if (points.length < 4) return false;
    const first = points[0], last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > .3 * size) return false;
    const left = b.left + stroke.width / 2, right = b.right - stroke.width / 2;
    const top = b.top + stroke.width / 2, bottom = b.bottom - stroke.width / 2;
    for (const [cx, cy] of [[left, top], [right, top], [right, bottom], [left, bottom]]) {
      let nearest = Infinity;
      for (const p of points) nearest = Math.min(nearest, Math.hypot(p.x - cx, p.y - cy));
      if (nearest / size > .16) return false;
    }
    let edge = 0;
    for (const p of points) edge += Math.min(p.x - left, right - p.x, p.y - top, bottom - p.y);
    return edge / points.length / size < .07;
  }

  // Een streep of vinkje in (of net over) een open vakje.
  function tickTarget(doc, stroke) {
    if (stroke.box) return null;
    const s = bounds(stroke);
    const cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2;
    const size = Math.max(s.right - s.left, s.bottom - s.top);
    for (let index = doc.strokes.length - 1; index >= 0; index--) {
      const box = doc.strokes[index];
      if (!box.box || box.box.done || box === stroke) continue;
      const b = bounds(box);
      const bw = Math.max(b.right - b.left, b.bottom - b.top);
      const pad = bw * .25;
      if (cx >= b.left - pad && cx <= b.right + pad && cy >= b.top - pad && cy <= b.bottom + pad &&
          size <= 2.2 * bw && size >= .3 * bw) return box;
    }
    return null;
  }

  function lineRect(box) {
    const b = bounds(box);
    const h = Math.max(20, b.bottom - b.top);
    return { left: b.right + 2, right: b.right + 1400, top: b.top - h * .5, bottom: b.bottom + h * .5 };
  }

  // Wat hoort bij een vakje: de regel erachter, plus de regels eronder die op of rechts van
  // het vakje beginnen. Een lege regel of een volgend vakje sluit de taak af. Heb je met de
  // lasso zelf een stuk gekozen (box.area.manual), dan geldt alleen dat stuk.
  function regionStrokes(doc, box) {
    const b = bounds(box);
    const h = Math.max(20, b.bottom - b.top);
    const ink = doc.strokes.filter(stroke => stroke !== box && !stroke.box);
    const area = box.box.area;
    if (area && area.manual) {
      return ink.filter(stroke => {
        const s = bounds(stroke), cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2;
        return cx >= area.left && cx <= area.right && cy >= area.top && cy <= area.bottom;
      });
    }
    // Eerstvolgende vakje eronder (dat begint een nieuwe taak).
    let stop = Infinity;
    for (const other of doc.strokes) {
      if (!other.box || other === box) continue;
      const o = bounds(other);
      if (o.top > b.top + h * .5 && o.right >= b.left - 4 * h && o.left <= b.right + 1400) stop = Math.min(stop, o.top - 2);
    }
    const line = lineRect(box);
    const picked = ink.filter(stroke => { const s = bounds(stroke); return overlaps(line, s) && s.top < stop; });
    if (!picked.length) return [];
    let bottom = Math.max(...picked.map(stroke => bounds(stroke).bottom));
    const gap = Math.max(20, h);
    for (let round = 0; round < 20; round++) {
      const more = ink.filter(stroke => {
        if (picked.includes(stroke)) return false;
        const s = bounds(stroke);
        return s.top > b.top && s.top <= bottom + gap && s.top < stop && s.left >= b.left - h * .5 && s.left <= b.right + 1400;
      });
      if (!more.length) break;
      picked.push(...more);
      bottom = Math.max(bottom, ...more.map(stroke => bounds(stroke).bottom));
    }
    return picked;
  }

  // Verandert er iets aan de inkt van een taak, dan verandert deze handtekening.
  function signature(strokes) {
    let value = strokes.length;
    for (const stroke of strokes) {
      const s = bounds(stroke);
      value = (value * 31 + Math.round(s.left) * 7 + Math.round(s.top) * 13 + stroke.points.length) % 2147483647;
    }
    return String(value);
  }

  function areaOf(strokes) {
    return { left: Math.min(...strokes.map(stroke => bounds(stroke).left)), right: Math.max(...strokes.map(stroke => bounds(stroke).right)),
      top: Math.min(...strokes.map(stroke => bounds(stroke).top)), bottom: Math.max(...strokes.map(stroke => bounds(stroke).bottom)) };
  }

  let boxTimer = null, boxDoc = null, boxBusy = false;
  const offered = new Set();
  function scheduleBoxes(doc, delay = 6000) {
    boxDoc = doc;
    clearTimeout(boxTimer);
    boxTimer = setTimeout(processBoxes, delay);
  }

  const cleanTaskLine = value => value.replace(/\[onleesbaar\]/gi, "").replace(/^[\s\-*•☐□]+/, "").trim();

  function titleFrom(text) {
    const line = String(text || "").split(/\r?\n/).map(cleanTaskLine).find(value => /[a-zà-ÿ0-9]{2,}/i.test(value));
    return line ? line.slice(0, 200) : "";
  }

  // Eerste gelezen regel = taak, de rest = notitie.
  function splitTask(text) {
    const lines = String(text || "").split(/\r?\n/).map(cleanTaskLine).filter(Boolean);
    const first = lines.findIndex(value => /[a-zà-ÿ0-9]{2,}/i.test(value));
    if (first < 0) return { title: "", note: "" };
    return { title: lines[first].slice(0, 200), note: lines.slice(first + 1).join("\n").slice(0, 3800) };
  }

  async function processBoxes() {
    const doc = boxDoc;
    if (!doc || boxBusy) return;
    if (W().isDrawing()) { scheduleBoxes(doc, 2500); return; }
    const work = [];
    let touched = false;
    for (const box of doc.strokes) {
      if (!box.box || box.box.done) continue;
      const strokes = regionStrokes(doc, box);
      if (!strokes.length) continue;
      const sig = signature(strokes);
      if (box.box.taskId && !box.box.sig) { box.box.sig = sig; touched = true; continue; } // vakje van vóór v24.3: niet opnieuw lezen
      if (box.box.taskId && box.box.sig === sig) continue;
      work.push({ box, strokes, sig });
    }
    if (touched) W().changed();
    if (!work.length) return;
    if (!loggedIn()) { W().notify("Vakje gezien, maar je bent niet ingelogd bij WerkHub. Log in op Vandaag en teken het vakje opnieuw."); return; }
    if (!H().hasAiConsent()) {
      W().notify("Vakje gezien. Mag AI (Gemini, buiten PWN) de tekst achter het vakje lezen?", "Ja, altijd", () => { H().giveAiConsent(); scheduleBoxes(doc, 10); }, 15000);
      return;
    }
    boxBusy = true;
    try {
      for (const { box, strokes, sig } of work.slice(0, 3)) {
        const canvas = W().inkFor(strokes);
        const image = window.AiChat.cropInk(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height });
        const { title, note } = splitTask(await window.AiChat.recognizeHandwriting(image));
        const current = doc.strokes.find(stroke => stroke.box && stroke.box.id === box.box.id);
        if (!current || current.box.done) continue;
        if (!title) { W().notify("Kon de tekst achter het vakje niet lezen. Schrijf iets duidelijker of gebruik Taak."); continue; }
        const area = { ...areaOf(strokes), manual: !!(current.box.area && current.box.area.manual) };
        if (current.box.taskId) {
          if (current.box.title !== title || (current.box.note || "") !== note) {
            await H().updateOne(current.box.taskId, title, note);
            W().notify(`Taak bijgewerkt: ${title}${note ? ` (+${note.split("\n").length} regel${note.includes("\n") ? "s" : ""} notitie)` : ""}`);
          }
          Object.assign(current.box, { title, note, sig, area });
          W().changed();
          continue;
        }
        const taskId = await H().createOne(title, read("remy-ipad-box-type", "belangrijk"), "", note);
        Object.assign(current.box, { taskId, title, note, sig, area });
        W().changed();
        W().notify(`Taak in WerkHub: ${title}${note ? " (rest als notitie)" : ""}`, "Ongedaan", async () => {
          try { await H().setTaskStatus(taskId, "klaar"); delete current.box.taskId; delete current.box.title; current.box.done = true; W().changed(); W().notify("Taak weer weggehaald (op klaar gezet in WerkHub)."); }
          catch (error) { W().notify(error.message || String(error)); }
        });
      }
      if (work.length > 3) scheduleBoxes(doc, 10);
    } catch (error) {
      W().notify(`Taak uit vakje mislukt: ${error.message || error}`, "Opnieuw", () => scheduleBoxes(doc, 10));
    } finally {
      boxBusy = false;
    }
  }

  // Lasso om een vakje plus tekst, dan Taak: precies dat stuk wordt de taak van dat vakje.
  // Geeft false terug als er geen (of meer dan één) vakje in de selectie zit.
  function boxFromSelection() {
    if (!boxesOn()) return false;
    const doc = W().activeDocument && W().activeDocument();
    const selected = W().selectedStrokes ? W().selectedStrokes() : [];
    const boxes = selected.filter(stroke => stroke.box && !stroke.box.done);
    if (!doc || boxes.length !== 1) return false;
    const ink = selected.filter(stroke => !stroke.box);
    if (!ink.length) { W().notify("Selecteer het vakje samen met de tekst die bij de taak hoort."); return true; }
    const box = boxes[0];
    box.box.area = { ...areaOf(ink), manual: true };
    delete box.box.sig;
    if (box.box.taskId) box.box.sig = "opnieuw";
    W().changed();
    W().notify(box.box.taskId ? "Taak wordt bijgewerkt met je selectie..." : "Taak wordt gemaakt uit je selectie...");
    scheduleBoxes(doc, 10);
    return true;
  }

  async function markDone(box) {
    box.box.done = true;
    W().changed();
    if (!box.box.taskId) { W().notify("Vakje afgevinkt."); return; }
    const title = box.box.title || "taak";
    try {
      await H().setTaskStatus(box.box.taskId, "klaar");
      W().notify(`✓ Klaar in WerkHub: ${title}`, "Ongedaan", async () => {
        try { await H().setTaskStatus(box.box.taskId, "backlog"); box.box.done = false; W().changed(); W().notify(`Weer open: ${title}`); }
        catch (error) { W().notify(error.message || String(error)); }
      });
    } catch (error) {
      box.box.done = false;
      W().changed();
      W().notify(`Afvinken in WerkHub mislukt: ${error.message || error}`, "Opnieuw", () => markDone(box));
    }
  }

  function afterStroke(doc, stroke) {
    if (!boxesOn()) return;
    const target = tickTarget(doc, stroke);
    if (target) { markDone(target); return; }
    if (isBoxStroke(stroke)) {
      stroke.box = { id: crypto.randomUUID() };
      W().changed();
      W().notify("Vakje herkend: schrijf je taak erachter.", "Geen vakje", () => { delete stroke.box; W().changed(); });
      return;
    }
    // Ook ná het aanmaken: schrijf je verder onder de taak, dan wordt hij bijgewerkt.
    const owner = doc.strokes.find(box => box.box && !box.box.done && regionStrokes(doc, box).includes(stroke));
    if (!owner) return;
    scheduleBoxes(doc);
    // Eén keer per vakje: wil je niet wachten, dan meteen lezen.
    if (!owner.box.taskId && !offered.has(owner.box.id)) {
      offered.add(owner.box.id);
      W().notify("Taak wordt gelezen zodra je even stopt met schrijven.", "Nu lezen", () => scheduleBoxes(doc, 10), 5000);
    }
  }

  // Overzicht van open vakjes: tik = naar dat vakje springen.
  function renderBoxList() {
    const list = $("box-list");
    const boxes = W().openBoxes ? W().openBoxes() : [];
    if (!boxes.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty", textContent: "Geen open vakjes. Teken ☐ voor een regel om er een taak van te maken." }));
      return;
    }
    list.replaceChildren(...boxes.slice(0, 40).map(item => {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "box-row" });
      button.textContent = `${item.inWerkhub ? "🟢" : "⚪"} ${item.title || "(nog niet gelezen)"} · ${item.docTitle}`;
      button.addEventListener("click", () => { try { W().goTo(item.docId, item.x, item.y); } catch (error) { W().notify(error.message || String(error)); } });
      return button;
    }));
  }

  // ================= Vangnet: versies =================
  const VERSION_GAP = 10 * 60 * 1000;
  const lastHash = new Map(), lastAt = new Map();
  let lastActive = null, versionBusy = false;

  async function maybeSaveVersion(id, force = false) {
    const json = W().documentSnapshot(id);
    if (!json) return false;
    const value = hash(json.replace(/"view":\{[^}]*\}/, ""));
    if (lastHash.get(id) === value) return false;
    if (!force && lastAt.has(id) && Date.now() - lastAt.get(id) < VERSION_GAP) return false;
    if (!lastHash.has(id)) {
      // Eerste keer gezien: alleen bewaren als de laatste versie anders is.
      const latest = (await S().listVersions(id))[0];
      if (latest) {
        const stored = await S().getVersion(latest.key);
        if (stored && hash(stored.json.replace(/"view":\{[^}]*\}/, "")) === value) { lastHash.set(id, value); lastAt.set(id, latest.at); return false; }
      }
    }
    const doc = JSON.parse(json);
    await S().saveVersion(id, doc.title || "", json);
    lastHash.set(id, value);
    lastAt.set(id, Date.now());
    return true;
  }

  async function versionTick(force = false) {
    if (!ready() || versionBusy || W().isDrawing()) return;
    versionBusy = true;
    try {
      const id = W().activeDocumentId();
      if (lastActive && lastActive !== id) await maybeSaveVersion(lastActive, true);
      await maybeSaveVersion(id, force);
      lastActive = id;
      if ($("vangnet")?.open) await renderVersions();
    } catch (error) {
      console.warn("Werkplek: versie bewaren:", error.message);
    } finally {
      versionBusy = false;
    }
  }

  async function renderVersions() {
    const select = $("version-list");
    const id = W().activeDocumentId();
    const versions = await S().listVersions(id);
    select.replaceChildren(...(versions.length ? versions.map(version => {
      const option = document.createElement("option");
      option.value = String(version.key);
      option.textContent = `${time(version.at)} · ${version.title || "Zonder titel"} · ${Math.max(1, Math.round(version.size / 1024))} kB`;
      return option;
    }) : [Object.assign(document.createElement("option"), { value: "", textContent: "Nog geen versies van dit blad (komt vanzelf, elke 10 minuten bij wijzigingen)" })]));
    $("version-restore").disabled = !versions.length;
  }

  async function restoreSelectedVersion() {
    const key = Number($("version-list").value);
    if (!key) return;
    const id = W().activeDocumentId();
    const version = await S().getVersion(key);
    if (!version || version.docId !== id) throw new Error("Deze versie hoort bij een ander blad. Open dat blad eerst.");
    await maybeSaveVersion(id, true);
    const before = W().restoreVersion(id, version.json);
    lastHash.delete(id);
    W().notify(`Versie van ${time(version.at)} teruggezet.`, "Ongedaan", () => { W().restoreVersion(id, before); lastHash.delete(id); });
    await renderVersions();
  }

  // ================= Vangnet: prullenbak =================
  function renderTrash() {
    const list = $("trash-list");
    const items = W().trashList();
    if (!items.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty", textContent: "Prullenbak is leeg. Weggegooide schriften blijven hier 30 dagen staan." }));
      return;
    }
    list.replaceChildren(...items.map(item => {
      const row = document.createElement("div");
      row.className = "trash-row";
      const label = document.createElement("span");
      const days = Math.floor((Date.now() - item.deletedAt) / 864e5);
      label.textContent = `${item.title || "Zonder titel"} · ${item.kind === "page" ? "schrift" : "bord"}${item.folder ? ` · ${item.folder}` : ""} · ${days ? `${days} d geleden` : "vandaag"}`;
      const back = Object.assign(document.createElement("button"), { type: "button", textContent: "Zet terug" });
      back.addEventListener("click", () => { try { W().restoreFromTrash(item.id); renderTrash(); } catch (error) { W().notify(error.message); } });
      const gone = Object.assign(document.createElement("button"), { type: "button", textContent: "Definitief weg", className: "danger-button" });
      gone.addEventListener("click", () => {
        if (!window.confirm(`"${item.title || "Zonder titel"}" definitief weggooien? Dit kan niet terug.`)) return;
        try { W().purgeFromTrash(item.id); renderTrash(); } catch (error) { W().notify(error.message); }
      });
      row.append(label, back, gone);
      return row;
    }));
  }

  // ================= Zoeken =================
  const normalize = value => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function snippet(text, query) {
    const plain = String(text || "").replace(/\s+/g, " ");
    const index = normalize(plain).indexOf(query);
    if (index < 0) return "";
    const start = Math.max(0, index - 40);
    return (start ? "…" : "") + plain.slice(start, index + query.length + 60) + (index + query.length + 60 < plain.length ? "…" : "");
  }
  function search() {
    const results = $("note-results");
    const query = normalize($("note-search").value.trim());
    if (query.length < 2) { results.replaceChildren(); results.hidden = true; return; }
    const hits = W().listDocuments().map(doc => {
      const inTitle = normalize(doc.title).includes(query);
      const textHit = snippet(doc.text, query) || snippet(doc.transcript, query);
      const folderHit = normalize(doc.folder).includes(query);
      return { doc, score: (inTitle ? 3 : 0) + (textHit ? 2 : 0) + (folderHit ? 1 : 0), textHit };
    }).filter(hit => hit.score).sort((a, b) => b.score - a.score).slice(0, 15);
    results.hidden = false;
    if (!hits.length) {
      results.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty",
        textContent: "Niets gevonden. Handschrift is pas doorzoekbaar nadat AI het gelezen heeft (vinkje hieronder)." }));
      return;
    }
    results.replaceChildren(...hits.map(({ doc, textHit }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "note-hit";
      const title = Object.assign(document.createElement("strong"), { textContent: doc.title || "Zonder titel" });
      const meta = Object.assign(document.createElement("small"), { textContent: `${doc.kind === "page" ? "Schrift" : "Bord"} · ${doc.folder}` });
      button.append(title, meta);
      if (textHit) button.append(Object.assign(document.createElement("span"), { textContent: textHit }));
      button.addEventListener("click", () => {
        try { W().openDocument(doc.id); $("note-search").value = ""; search(); }
        catch (error) { W().notify(error.message); }
      });
      return button;
    }));
  }

  // ================= AI leest notities: titel + zoekindex =================
  const NOTES_KEY = "remy-ipad-ai-notes-consent";
  let transcribing = false;
  function needsTranscript(doc) {
    if (doc.strokes < 12) return false;
    return !doc.transcript ? true : doc.strokes - doc.transcriptStrokes >= 15;
  }
  function makeTitle(text) {
    const line = titleFrom(text).replace(/[.:;,!?]+$/, "");
    if (!line) return "";
    let title = line.length > 48 ? line.slice(0, 48).replace(/\s+\S*$/, "") : line;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return title.length >= 3 ? title : "";
  }
  async function transcribeTick() {
    if (!ready() || transcribing || read(NOTES_KEY, "0") !== "1" || !loggedIn() || W().isDrawing() || document.visibilityState !== "visible") return;
    const docs = W().listDocuments();
    const activeId = W().activeDocumentId();
    const doc = docs.find(item => item.id === activeId && needsTranscript(item)) || docs.find(needsTranscript);
    if (!doc) return;
    transcribing = true;
    try {
      const canvas = W().documentCanvas(doc.id);
      if (!canvas) return;
      const image = window.AiChat.cropInk(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      const text = await window.AiChat.recognizeHandwriting(image);
      const fresh = W().listDocuments().find(item => item.id === doc.id);
      if (!fresh) return;
      const title = fresh.defaultTitle ? makeTitle(text) : "";
      W().setTranscript(doc.id, text, title);
      if (title) W().notify(`Titel gegeven: "${title}"`, "Andere titel", () => { W().openDocument(doc.id); $("title").focus(); $("title").select(); });
      $("smart-status").textContent = `Laatst gelezen: "${title || fresh.title || "Zonder titel"}" om ${new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`;
    } catch (error) {
      $("smart-status").textContent = `AI-lezen overgeslagen: ${error.message || error}`;
    } finally {
      transcribing = false;
    }
  }

  // ================= Opstarten =================
  function wire() {
    const searchInput = $("note-search");
    if (!searchInput) return;
    let searchTimer = null;
    searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 120); });
    searchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); $("note-results").querySelector("button")?.click(); }
      if (event.key === "Escape") { searchInput.value = ""; search(); }
    });
    const consent = $("ai-notes-consent");
    consent.checked = read(NOTES_KEY, "0") === "1";
    consent.addEventListener("change", () => { write(NOTES_KEY, consent.checked ? "1" : "0"); if (consent.checked) setTimeout(transcribeTick, 500); });
    const boxes = $("boxes-on");
    boxes.checked = boxesOn();
    boxes.addEventListener("change", () => write(BOX_KEY, boxes.checked ? "1" : "0"));
    const boxType = $("box-type");
    const savedType = read("remy-ipad-box-type", "belangrijk");
    boxType.value = ["urgent", "belangrijk", "subtaak"].includes(savedType) ? savedType : "belangrijk";
    boxType.addEventListener("change", () => write("remy-ipad-box-type", boxType.value));
    $("box-list").closest("details").addEventListener("toggle", event => { if (event.target.open) renderBoxList(); });
    $("vangnet").addEventListener("toggle", event => {
      if (!event.target.open) return;
      renderTrash();
      versionTick(true).then(renderVersions).catch(error => W().notify(error.message));
    });
    $("version-restore").addEventListener("click", () => restoreSelectedVersion().catch(error => W().notify(error.message || String(error))));
    setInterval(() => versionTick(false), 60000);
    setInterval(transcribeTick, 90000);
    setTimeout(transcribeTick, 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") versionTick(true); });
  }
  wire();

  window.WorkplaceSmart = { afterStroke, boxFromSelection, regionStrokes, splitTask, isBoxStroke, tickTarget, titleFrom, makeTitle, versionTick, processBoxes: () => processBoxes(), transcribeTick, search };
})();
