(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const MAX_ROW_BYTES = 8 * 1024 * 1024;
  const MAX_TASKS = 20;

  // Alle aanroepen gebruiken de bestaande WerkHub-login (connections.js) en de vastgepinde
  // WerkHub-database. Er wordt niets automatisch verstuurd: alleen na een klik op een knop hieronder.
  async function call(path, options = {}, timeout = 60000) {
    const connections = window.WorkplaceConnections;
    if (!connections || typeof connections.session !== "function" || typeof connections.config !== "function") {
      throw new Error("WerkHub-koppeling is niet geladen. Herlaad de app en probeer het opnieuw.");
    }
    const token = typeof connections.freshSession === "function" ? await connections.freshSession(localStorage) : connections.session(localStorage);
    const config = await connections.config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(`${config.url}/rest/v1/${path}`, {
        cache: "no-store", credentials: "omit", signal: controller.signal, ...options,
        headers: { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("WerkHub reageerde niet op tijd. Probeer het opnieuw.");
      throw new Error("WerkHub is niet bereikbaar. Controleer de verbinding.");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) throw new Error("WerkHub-login is verlopen. Open het WerkHub-paneel op Vandaag, log opnieuw in en probeer het nog eens.");
    if (response.status === 403) throw new Error("Geen toegang met dit account. Controleer de databaserechten.");
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch (error) { body = null; } }
    if (!response.ok) {
      const error = new Error(body && (body.message || body.hint) || `WerkHub gaf HTTP ${response.status}.`);
      error.status = response.status;
      error.code = body && body.code;
      throw error;
    }
    return body;
  }

  // ---- Taak aanmaken ----

  function cleanLine(line) {
    return line.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim();
  }

  // Een regel mag eindigen op "| 2026-10-20": dat wordt de deadline van die taak (zo levert de AI ze aan).
  // Regel: "taak | 2026-10-20 | urgent" (datum en soort mogen ontbreken).
  const KINDS = { urgent: "urgent", u: "urgent", belangrijk: "belangrijk", b: "belangrijk", subtaak: "subtaak", wel: "subtaak", "wel doen": "subtaak", s: "subtaak" };
  function splitDeadline(line) {
    const match = line.match(/^(.*?)\s*\|\s*(\d{4}-\d{2}-\d{2})?\s*(?:\|\s*([a-z ]+?))?\s*$/i);
    if (!match) return { titel: line, deadline: "", kind: "" };
    return { titel: match[1].trim(), deadline: match[2] && !Number.isNaN(Date.parse(match[2])) ? match[2] : "",
      kind: KINDS[String(match[3] || "").trim().toLowerCase()] || "" };
  }

  function parseTasks(text, split) {
    const lines = String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!lines.length) throw new Error("Vul eerst in wat er moet gebeuren.");
    if (split) {
      if (lines.length > MAX_TASKS) throw new Error(`Maximaal ${MAX_TASKS} taken tegelijk. Verwijder regels of maak twee rondes.`);
      return lines.map(splitDeadline).filter(task => task.titel).map(task =>
        ({ titel: task.titel.slice(0, 200), notitie: task.titel.length > 200 ? task.titel : "", deadline: task.deadline, kind: task.kind }));
    }
    const first = splitDeadline(lines[0]);
    if (first.titel) lines[0] = first.titel;
    const rest = lines.slice(1).join("\n");
    return [{ titel: lines[0].slice(0, 200), notitie: [lines[0].length > 200 ? lines[0] : "", rest].filter(Boolean).join("\n").slice(0, 4000), deadline: first.deadline, kind: first.kind }];
  }

  // type: urgent | belangrijk | subtaak ("taak" = belangrijk, voor oude aanroepen).
  async function createTasks(text, { split = false, type = "belangrijk", deadline = "" } = {}) {
    if (type === "taak") type = "belangrijk";
    if (!["urgent", "belangrijk", "subtaak"].includes(type)) throw new Error("Onbekend taaktype.");
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error("Deadline is geen geldige datum.");
    const tasks = parseTasks(text, split);
    const now = new Date().toISOString();
    const rows = tasks.map(task => {
      const kind = task.kind || type;
      return {
        project: "pwn", titel: task.titel, waar: "", wie: "", notitie: task.notitie, status: "backlog",
        deadline: kind === "subtaak" ? null : (task.deadline || deadline || null), updated_at: now,
        taaktype: kind === "subtaak" ? "subtaak" : "taak", prioriteit: kind === "subtaak" ? null : kind
      };
    });
    try {
      await call("work_tasks", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    } catch (error) {
      if (type === "subtaak" && /taaktype/i.test(error.message || "")) {
        throw new Error("Subtaken zijn nog niet aangezet in WerkHub: voer eerst TAKEN-SUBTAKEN-MIGRATIE.sql uit in Supabase.");
      }
      throw error;
    }
    return rows.length;
  }

  const taskDialog = $("task-dialog");
  const taskForm = $("task-form");
  const taskStatus = $("task-status");

  function openTask(text = "") {
    taskForm.reset();
    pendingInk = null;
    $("task-read").hidden = true;
    $("task-consent-row").hidden = true;
    $("task-text").value = String(text || "").slice(0, 4000);
    const lines = $("task-text").value.split(/\r?\n/).map(cleanLine).filter(Boolean);
    $("task-split").checked = lines.length > 1 && lines.length <= MAX_TASKS && lines.every(line => line.length <= 200);
    syncTaskType();
    taskStatus.textContent = "Wordt als nieuwe taak in WerkHub gezet (PWN, Nog beginnen). Er gaat niets naar AI.";
    $("task-send").disabled = false;
    if (!taskDialog.open) taskDialog.showModal();
    $("task-text").focus();
  }

  // ---- Taak uit handschrift (lasso-menu, lang drukken, knop Taak) ----

  const CONSENT_KEY = "remy-ipad-ai-task-consent";
  const aiConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch (error) { return false; } };
  let pendingInk = null;

  function taskPrompt() {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const day = today.toLocaleDateString("nl-NL", { weekday: "long" });
    return "Haal de taken of actiepunten uit dit handschrift. Vandaag is " + day + " " + iso + ". " +
      "Geef alleen regels in de vorm: taak | JJJJ-MM-DD | soort. Zet een datum alleen als er een datum, dag of termijn in het handschrift staat " +
      "(reken die om naar een echte datum), anders laat je de datum leeg. Soort is precies één woord: urgent (moet zo snel mogelijk, vandaag of morgen), " +
      "belangrijk (moet gebeuren maar kan ingepland worden) of subtaak (klein klusje, niet urgent en niet belangrijk, wel doen). " +
      "Eén regel per taak, geen uitleg, geen opsommingstekens, geen Markdown. " +
      "Staat er maar één ding, geef één regel. Onleesbare woorden: [onleesbaar].";
  }

  async function readInk() {
    if (!pendingInk) return;
    const ai = window.AiChat;
    if (!ai) throw new Error("AI-module is niet geladen. Herlaad de app.");
    $("task-read").disabled = true;
    taskStatus.textContent = "Handschrift wordt gelezen...";
    try {
      const image = ai.cropInk(pendingInk, { x: 0, y: 0, width: pendingInk.width, height: pendingInk.height });
      const answer = (await ai.askBoard(image, taskPrompt())).replace(/```[a-z]*\n?|```/gi, "").trim();
      const lines = answer.split(/\r?\n/).map(cleanLine).filter(Boolean).slice(0, MAX_TASKS);
      if (!lines.length) throw new Error("AI vond geen taak in het handschrift. Typ hem zelf in.");
      const existing = $("task-text").value.trim();
      $("task-text").value = [existing, ...lines].filter(Boolean).join("\n").slice(0, 4000);
      $("task-split").checked = $("task-text").value.split(/\r?\n/).filter(line => line.trim()).length > 1;
      taskStatus.textContent = lines.length === 1 ? "Gelezen. Controleer de tekst en tik op Maak taak." :
        `${lines.length} taken gevonden. Haal weg wat niet klopt en tik op Maak taak.`;
      pendingInk = null;
      $("task-read").hidden = true;
      $("task-consent-row").hidden = true;
    } finally {
      $("task-read").disabled = false;
    }
  }

  async function taskFromInk(type = "taak") {
    let source;
    try { source = window.WorkplaceWriting.captureSelection(); }
    catch (error) { openTask(""); taskStatus.textContent = error.message || String(error); return; }
    openTask(source.text || "");
    $("task-type").value = type === "subtaak" ? "subtaak" : type === "urgent" ? "urgent" : "belangrijk";
    syncTaskType();
    pendingInk = source.canvas;
    const where = source.selected ? "de selectie" : "dit hele blad";
    if (!pendingInk) {
      taskStatus.textContent = source.text ? "Getypte tekst overgenomen. Controleer en tik op Maak taak." : "Geen handschrift gevonden. Typ de taak zelf in.";
      return;
    }
    $("task-read").hidden = false;
    $("task-consent-row").hidden = aiConsent();
    $("task-consent").checked = aiConsent();
    if (!aiConsent()) {
      taskStatus.textContent = `Vink aan dat AI ${where} mag lezen (Gemini, buiten PWN), of typ de taak zelf.`;
      return;
    }
    try { await readInk(); }
    catch (error) { taskStatus.textContent = error.message || String(error); }
  }

  $("task-consent").addEventListener("change", () => {
    try { localStorage.setItem(CONSENT_KEY, $("task-consent").checked ? "1" : "0"); } catch (error) { /* alleen gemak */ }
  });
  $("task-read").addEventListener("click", async () => {
    if (!$("task-consent").checked) { taskStatus.textContent = "Vink eerst aan dat AI het handschrift mag lezen."; return; }
    try { await readInk(); }
    catch (error) { taskStatus.textContent = error.message || String(error); }
  });

  function syncTaskType() {
    const subtask = $("task-type").value === "subtaak";
    $("task-deadline").disabled = subtask;
    if (subtask) $("task-deadline").value = "";
  }

  $("task-type").addEventListener("change", syncTaskType);
  $("task-open").addEventListener("click", () => taskFromInk("taak"));
  $("task-close").addEventListener("click", () => taskDialog.close());
  taskForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("task-send");
    button.disabled = true;
    taskStatus.textContent = "Taak wordt opgeslagen in WerkHub...";
    try {
      const count = await createTasks($("task-text").value, {
        split: $("task-split").checked, type: $("task-type").value, deadline: $("task-deadline").value
      });
      taskStatus.textContent = count === 1 ? "Taak staat in WerkHub." : `${count} taken staan in WerkHub.`;
      $("task-text").value = "";
      $("task-split").checked = false;
    } catch (error) {
      taskStatus.textContent = error.message || String(error);
    } finally {
      button.disabled = false;
    }
  });

  const aiTask = $("writing-ai-task");
  if (aiTask) {
    aiTask.addEventListener("click", () => {
      const transcript = $("writing-ai-transcript");
      const text = !$("writing-ai-transcript-panel").hidden && transcript.value.trim()
        ? transcript.value : $("writing-ai-answer").textContent;
      openTask(text);
    });
    // Knop alleen aan zodra er een antwoord of herkende tekst staat.
    new MutationObserver(() => { aiTask.disabled = $("writing-ai-insert").disabled; })
      .observe($("writing-ai-insert"), { attributes: true, attributeFilter: ["disabled"] });
  }

  // Notities synchroniseren gebeurt nu automatisch in sync.js (alles, alle apparaten).

  // Eén taak maken en het id teruggeven (voor taakvakjes in het schrift).
  async function createOne(titel, type = "belangrijk", deadline = "") {
    if (type === "taak") type = "belangrijk";
    const clean = cleanLine(String(titel || "")).slice(0, 200);
    if (!clean) throw new Error("Geen taaktekst.");
    const row = { project: "pwn", titel: clean, waar: "", wie: "", notitie: "Uit de iPad Werkplek (taakvakje).", status: "backlog",
      deadline: type === "subtaak" ? null : (deadline || null), updated_at: new Date().toISOString(),
      taaktype: type === "subtaak" ? "subtaak" : "taak", prioriteit: type === "subtaak" ? null : (type === "urgent" ? "urgent" : "belangrijk") };
    const rows = await call("work_tasks?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([row]) });
    if (!Array.isArray(rows) || !rows[0] || typeof rows[0].id !== "string") throw new Error("WerkHub gaf geen taak-id terug.");
    return rows[0].id;
  }

  async function setTaskStatus(id, status) {
    if (!["backlog", "bezig", "wacht_op", "klaar"].includes(status)) throw new Error("Onbekende status.");
    await call(`work_tasks?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
  }

  async function openTasks() {
    const rows = await call("work_tasks?select=id,titel,status,deadline,taaktype,prioriteit,project,team_id&project=eq.pwn&status=neq.klaar&order=deadline.asc.nullslast&limit=80");
    return Array.isArray(rows) ? rows : [];
  }

  function hasAiConsent() { return aiConsent(); }
  function giveAiConsent() { try { localStorage.setItem(CONSENT_KEY, "1"); } catch (error) { /* alleen gemak */ } }

  window.WorkplaceWerkhub = { parseTasks, createTasks, openTask, taskFromInk, splitDeadline, createOne, setTaskStatus, openTasks, hasAiConsent, giveAiConsent, call };
})();
