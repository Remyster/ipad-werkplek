(function () {
  "use strict";
  // Cloud-sync: alles wat je doet (schrift, bord, meetstatus, getypte en ingesproken tekst, mappen)
  // staat automatisch in Supabase (tabel werkplek_documents) en op elk apparaat waar je inlogt.
  // Wijzigingen gaan binnen een paar seconden omhoog; elke 15 s (en als je de app opent) komt
  // nieuws van je andere apparaten binnen. Zijn op twee apparaten tegelijk wijzigingen, dan wint
  // dit apparaat en staat de andere versie in Vangnet > oude versies. Er gaat dus niets verloren.
  const $ = id => document.getElementById(id);
  const STATE_KEY = "remy-ipad-sync-state";
  const RENAMED_KEY = "remy-ipad-sync-renamed";
  const MAX_ROW = 8 * 1024 * 1024;
  const PULL_EVERY = 10000;
  // Verhoog bij een nieuwe app-versie die documenten anders kan lezen: dan haalt elk apparaat
  // alles nog één keer opnieuw op (eerder overgeslagen documenten komen dan alsnog binnen).
  const SYNC_VERSION = 2;
  const W = () => window.WorkplaceWriting;

  const readState = () => {
    try { const value = JSON.parse(localStorage.getItem(STATE_KEY) || "null"); if (value && value.docs) return value; } catch (error) { /* opnieuw beginnen */ }
    return { lastPull: "1970-01-01T00:00:00Z", docs: {} };
  };
  let state = readState();
  if (state.version !== SYNC_VERSION) {
    state.lastPull = "1970-01-01T00:00:00Z";
    for (const id of Object.keys(state.docs)) state.docs[id] = { ...state.docs[id], at: "" };
    state.version = SYNC_VERSION;
  }
  const invalidTries = new Map();
  let skipped = 0;
  const saveState = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (error) { /* volgende keer opnieuw */ } };

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
    return (value >>> 0).toString(36) + ":" + text.length;
  }

  // Inhoud vergelijken los van sleutelvolgorde (Postgres jsonb sorteert sleutels anders) en zonder weergave.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).filter(key => key !== "view" && key !== "folderId").sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function sameContent(localJson, remoteData) {
    try { return canonical(JSON.parse(localJson)) === canonical(remoteData || {}); } catch (error) { return false; }
  }

  // ---- status in de kop ----
  let lastOk = 0;
  function show(kind, text) {
    const el = $("cloud-status");
    if (!el) return;
    el.dataset.kind = kind;
    el.textContent = text;
  }
  const clock = () => new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

  async function call(path, options = {}) {
    const connections = window.WorkplaceConnections;
    const token = await connections.freshSession(localStorage);
    const settings = await connections.config();
    const response = await fetch(`${settings.url}/rest/v1/${path}`, {
      cache: "no-store", credentials: "omit", ...options,
      headers: { apikey: settings.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch (error) { body = null; } }
    if (!response.ok) {
      const error = new Error((body && (body.message || body.hint)) || `Cloud gaf HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  // ---- omhoog ----
  async function pushDoc(doc, value) {
    const row = { id: doc.id, title: doc.title.slice(0, 120), kind: doc.kind, folder_title: doc.folder_title, data: JSON.parse(doc.json), deleted: false };
    const rows = await call("werkplek_documents?on_conflict=id&select=id,updated_at", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([row])
    });
    state.docs[doc.id] = { hash: value, at: rows && rows[0] ? rows[0].updated_at : state.docs[doc.id]?.at };
  }

  async function markDeleted(id) {
    const rows = await call(`werkplek_documents?id=eq.${encodeURIComponent(id)}&select=id,updated_at`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ deleted: true })
    });
    delete state.docs[id];
    return rows;
  }

  let tooBig = new Set();
  async function push() {
    const docs = W().syncDocs();
    const present = new Set(docs.map(doc => doc.id));
    let pushed = 0;
    for (const doc of docs) {
      const value = hash(doc.json);
      if (state.docs[doc.id] && state.docs[doc.id].hash === value) continue;
      if (doc.json.length > MAX_ROW) {
        if (!tooBig.has(doc.id)) { tooBig.add(doc.id); W().notify?.(`"${doc.title || "Zonder titel"}" is te groot voor de cloud (meer dan 8 MB). Splits het bord; het blijft wel op dit apparaat.`); }
        continue;
      }
      await pushDoc(doc, value);
      pushed++;
    }
    // Weggegooid op dit apparaat: in de cloud als verwijderd markeren (komt op andere apparaten in de prullenbak).
    for (const id of Object.keys(state.docs)) {
      if (!present.has(id)) { await markDeleted(id); pushed++; }
    }
    let renamed = [];
    try { renamed = JSON.parse(localStorage.getItem(RENAMED_KEY) || "[]"); } catch (error) { renamed = []; }
    for (const id of renamed) {
      if (present.has(id)) continue;
      try { await markDeleted(id); } catch (error) { if (error.status !== 404) throw error; }
    }
    if (renamed.length) localStorage.removeItem(RENAMED_KEY);
    // PDF-originelen die nog niet in de cloud staan alsnog uploaden.
    const pdfIds = [...new Set(docs.filter(doc => doc.pdf && doc.pdf.id).map(doc => doc.pdf.id))];
    if (pdfIds.length) await window.WorkplacePdf.uploadPending(pdfIds).catch(error => console.warn("Werkplek: PDF-upload:", error.message));
    saveState();
    return pushed;
  }

  // ---- omlaag ----
  async function pull() {
    const since = state.lastPull || "1970-01-01T00:00:00Z";
    const changes = await call(`werkplek_documents?select=id,updated_at&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`);
    if (!Array.isArray(changes) || !changes.length) return 0;
    const wanted = changes.filter(change => !state.docs[change.id] || state.docs[change.id].at !== change.updated_at).map(change => change.id);
    let newest = since;
    for (const change of changes) if (change.updated_at > newest) newest = change.updated_at;
    if (!wanted.length) { state.lastPull = newest; saveState(); return 0; }
    const local = new Map(W().syncDocs().map(doc => [doc.id, doc]));
    const toApply = [];
    let busy = false;
    for (let index = 0; index < wanted.length; index += 10) {
      const ids = wanted.slice(index, index + 10).map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
      const rows = await call(`werkplek_documents?id=in.(${encodeURIComponent(ids)})&select=id,kind,title,folder_title,data,deleted,updated_at`);
      for (const row of rows || []) {
        const mine = local.get(row.id);
        const known = state.docs[row.id];
        const localChanged = mine && (!known || known.hash !== hash(mine.json));
        if (localChanged && !row.deleted && sameContent(mine.json, row.data)) {
          // Zelfde inhoud (bijv. eerste sync): alleen onthouden, niets toepassen.
          state.docs[row.id] = { hash: hash(mine.json), at: row.updated_at };
          continue;
        }
        if (localChanged && !mine.empty && !row.deleted) {
          // Op twee plekken gewijzigd: dit apparaat wint, de andere versie gaat naar Vangnet.
          try { await window.WorkplaceStore.saveVersion(row.id, `${row.title || "Zonder titel"} (ander apparaat)`, JSON.stringify({ ...row.data, id: row.id })); } catch (error) { /* geen vangnet beschikbaar */ }
          state.docs[row.id] = { hash: known ? known.hash : "", at: row.updated_at };
          W().notify?.(`"${row.title || "Zonder titel"}" is ook op een ander apparaat aangepast. Die versie staat in Vangnet > oude versies.`);
          continue;
        }
        if (localChanged && !mine.empty && row.deleted) continue; // lokaal bewerkt: niet weggooien, wordt weer omhooggezet
        toApply.push(row);
      }
    }
    if (toApply.length) {
      const result = W().applyRemote(toApply);
      const after = new Map(W().syncDocs().map(doc => [doc.id, doc]));
      for (const row of toApply) {
        if (result[row.id] === "busy") { busy = true; continue; }
        if (result[row.id] === "invalid") {
          // Niet als "gezien" markeren: volgende keer opnieuw proberen (bijv. na een app-update).
          const tries = (invalidTries.get(row.id) || 0) + 1;
          invalidTries.set(row.id, tries);
          if (tries < 3) busy = true; else skipped++;
          continue;
        }
        if (row.deleted) { delete state.docs[row.id]; continue; }
        const doc = after.get(row.id);
        state.docs[row.id] = { hash: doc ? hash(doc.json) : "", at: row.updated_at };
      }
    }
    // Bij "bezig" (je schrijft of typt in dat blad) later nog eens proberen: lastPull dan niet verschuiven.
    if (!busy) state.lastPull = newest;
    saveState();
    return toApply.length;
  }

  // ---- regie ----
  let running = false, again = false, dirtyTimer = null, failures = 0;
  async function run(reason = "") {
    if (!W() || typeof W().syncDocs !== "function") return;
    if (running) { again = true; return; }
    running = true;
    try {
      try { await window.WorkplaceConnections.freshSession(localStorage); }
      catch (error) { show("login", "🔑 Log in bij WerkHub (op Vandaag) voor sync"); return; }
      if (!navigator.onLine) { show("offline", "📴 Offline: bewaard op dit apparaat, gaat later mee"); return; }
      show("busy", "☁️ Synchroniseren…");
      const pulled = await pull();
      await push();
      failures = 0;
      lastOk = Date.now();
      if (skipped) show("error", `⚠️ ${skipped} document${skipped === 1 ? "" : "en"} kon niet geladen worden: herlaad de app (nieuwe versie)`);
      else show("ok", `☁️ Alles bewaard · ${clock()}`);
      if (pulled && reason !== "start") W().notify?.(`${pulled} wijziging${pulled === 1 ? "" : "en"} van je andere apparaat binnengehaald.`);
    } catch (error) {
      failures++;
      if (error.status === 404 || /werkplek_documents|kind_check|deleted/i.test(error.message || "")) show("error", "⚠️ Cloud nog niet ingesteld (WERKPLEK-CLOUD-MIGRATIE.sql)");
      else show("error", `⚠️ Sync mislukt, probeer opnieuw (${error.message || error})`);
      console.warn("Werkplek-sync:", error);
    } finally {
      running = false;
      if (again) { again = false; setTimeout(() => run("again"), 500); }
    }
  }

  function markDirty() {
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => run("dirty"), 2000);
    if (lastOk) show("busy", "☁️ Wijziging bewaren…");
  }

  window.WorkplaceSync = { run, markDirty, pull, push, hash, state: () => state, reset() {
    // Alles opnieuw vergelijken met de cloud (niets wordt weggegooid; lokale wijzigingen gaan omhoog).
    for (const id of Object.keys(state.docs)) state.docs[id] = { ...state.docs[id], at: "" };
    state.lastPull = "1970-01-01T00:00:00Z";
    state.version = SYNC_VERSION;
    invalidTries.clear();
    skipped = 0;
    saveState();
  } };

  $("cloud-status")?.addEventListener("click", () => run("klik"));
  $("sync-reset")?.addEventListener("click", () => { window.WorkplaceSync.reset(); run("opnieuw"); W().notify?.("Alles wordt opnieuw met de cloud vergeleken…"); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run("zichtbaar"); else run("verborgen"); });
  window.addEventListener("online", () => run("online"));
  window.addEventListener("offline", () => show("offline", "📴 Offline: bewaard op dit apparaat, gaat later mee"));
  setInterval(() => { if (document.visibilityState === "visible") run("interval"); }, PULL_EVERY);
  // Wachten tot de werkmap geladen is (app.js start asynchroon).
  const start = () => (W() && typeof W().syncDocs === "function") ? run("start") : setTimeout(start, 300);
  setTimeout(start, 300);
})();
