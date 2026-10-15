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
    const token = connections.session(localStorage);
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

  function parseTasks(text, split) {
    const lines = String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!lines.length) throw new Error("Vul eerst in wat er moet gebeuren.");
    if (split) {
      if (lines.length > MAX_TASKS) throw new Error(`Maximaal ${MAX_TASKS} taken tegelijk. Verwijder regels of maak twee rondes.`);
      return lines.map(line => ({ titel: line.slice(0, 200), notitie: line.length > 200 ? line : "" }));
    }
    const rest = lines.slice(1).join("\n");
    return [{ titel: lines[0].slice(0, 200), notitie: [lines[0].length > 200 ? lines[0] : "", rest].filter(Boolean).join("\n").slice(0, 4000) }];
  }

  async function createTasks(text, { split = false, type = "taak", deadline = "" } = {}) {
    if (type !== "taak" && type !== "subtaak") throw new Error("Onbekend taaktype.");
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error("Deadline is geen geldige datum.");
    const tasks = parseTasks(text, split);
    const now = new Date().toISOString();
    const rows = tasks.map(task => ({
      project: "pwn", titel: task.titel, waar: "", wie: "", notitie: task.notitie, status: "backlog",
      deadline: type === "subtaak" ? null : (deadline || null), updated_at: now,
      ...(type === "subtaak" ? { taaktype: "subtaak" } : {})
    }));
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
    $("task-text").value = String(text || "").slice(0, 4000);
    const lines = $("task-text").value.split(/\r?\n/).map(cleanLine).filter(Boolean);
    $("task-split").checked = lines.length > 1 && lines.length <= MAX_TASKS && lines.every(line => line.length <= 200);
    syncTaskType();
    taskStatus.textContent = "Wordt als nieuwe taak in WerkHub gezet (PWN, Nog beginnen). Er gaat niets naar AI.";
    $("task-send").disabled = false;
    if (!taskDialog.open) taskDialog.showModal();
    $("task-text").focus();
  }

  function syncTaskType() {
    const subtask = $("task-type").value === "subtaak";
    $("task-deadline").disabled = subtask;
    if (subtask) $("task-deadline").value = "";
  }

  $("task-type").addEventListener("change", syncTaskType);
  $("task-open").addEventListener("click", () => openTask(""));
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

  // ---- Notities opslaan in / ophalen uit WerkHub ----

  const syncStatus = $("wh-status");
  const syncList = $("wh-docs");
  const say = text => { syncStatus.textContent = text; };

  function tableMissing(error) {
    return error && (error.code === "PGRST205" || error.status === 404 || /werkplek_documents/i.test(error.message || ""));
  }
  function friendly(error) {
    if (tableMissing(error)) return "De opslag in WerkHub bestaat nog niet: voer eerst WERKPLEK-NOTITIES-MIGRATIE.sql uit in Supabase.";
    return error.message || String(error);
  }

  async function push(all) {
    const writing = window.WorkplaceWriting;
    if (!writing) throw new Error("Schrijven is niet beschikbaar.");
    const docs = writing.exportForSync(all);
    if (!docs.length) throw new Error("Meetlijsten blijven lokaal. Open een schrift of bord om te bewaren.");
    const now = new Date().toISOString();
    const rows = docs.map(doc => ({ id: doc.id, title: doc.title, kind: doc.kind, folder_title: doc.folder_title, data: doc.data, updated_at: now }));
    for (const row of rows) {
      if (JSON.stringify(row).length > MAX_ROW_BYTES) throw new Error(`"${row.title || "Zonder titel"}" is te groot voor WerkHub (meer dan 8 MB). Download een back-up of splits het bord.`);
    }
    // Per document een eigen aanvraag: een mislukt groot bord blokkeert de rest niet.
    let saved = 0;
    for (const row of rows) {
      await call("werkplek_documents?on_conflict=id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([row])
      });
      saved++;
      say(`Bewaren in WerkHub: ${saved} van ${rows.length}...`);
    }
    const pdfs = docs.filter(doc => doc.had_pdf).length;
    return `${saved} ${saved === 1 ? "document" : "documenten"} bewaard in WerkHub.` +
      (pdfs ? ` PDF-bestanden gaan niet mee (${pdfs}): die blijven op dit apparaat.` : "");
  }

  async function refresh() {
    const rows = await call("werkplek_documents?select=id,title,kind,folder_title,updated_at&order=updated_at.desc&limit=200");
    if (!Array.isArray(rows)) throw new Error("WerkHub gaf een onverwacht antwoord.");
    const options = rows.map(row => {
      const option = document.createElement("option");
      option.value = row.id;
      const date = new Date(row.updated_at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      option.textContent = `${row.folder_title ? row.folder_title + " / " : ""}${row.title || "Zonder titel"} (${row.kind === "page" ? "schrift" : "bord"}, ${date})`;
      return option;
    });
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nog niets bewaard in WerkHub";
      options.push(option);
    }
    syncList.replaceChildren(...options);
    $("wh-pull").disabled = !rows.length;
    return rows.length;
  }

  async function pull() {
    const id = syncList.value;
    if (!id) throw new Error("Kies eerst een document uit de lijst.");
    const rows = await call(`werkplek_documents?id=eq.${encodeURIComponent(id)}&select=id,title,kind,folder_title,updated_at,data`);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Dit document is niet meer in WerkHub gevonden.");
    const writing = window.WorkplaceWriting;
    if (writing.hasDocument(id) && !window.confirm(`"${rows[0].title || "Zonder titel"}" bestaat al op dit apparaat. De lokale versie wordt vervangen door de WerkHub-versie. Verder gaan?`)) {
      return "Niet opgehaald: lokale versie behouden.";
    }
    const title = writing.importFromSync(rows[0]);
    return `"${title}" opgehaald uit WerkHub en geopend.`;
  }

  async function run(button, task) {
    const buttons = ["wh-push", "wh-push-all", "wh-list", "wh-pull"].map($);
    buttons.forEach(item => { item.disabled = true; });
    try { say(await task()); }
    catch (error) { say(friendly(error)); }
    finally {
      buttons.forEach(item => { item.disabled = false; });
      $("wh-pull").disabled = !syncList.value;
    }
  }

  $("wh-push").addEventListener("click", event => run(event.currentTarget, () => push(false)));
  $("wh-push-all").addEventListener("click", event => run(event.currentTarget, () => push(true)));
  $("wh-list").addEventListener("click", event => run(event.currentTarget, async () => `${await refresh()} documenten in WerkHub.`));
  $("wh-pull").addEventListener("click", event => run(event.currentTarget, pull));
  $("wh-pull").disabled = true;

  window.WorkplaceWerkhub = { parseTasks, createTasks, openTask };
})();
