(function () {
  "use strict";
  // Opslag van de Werkplek: IndexedDB (ruimte voor grote borden) met localStorage als snelle
  // reservekopie zolang die past. Bij opstarten wint de nieuwste van de twee.
  const KEY = "remy-ipad-werkplek-v1";
  const SAVED_AT = "remy-ipad-werkplek-saved-at";
  const DB_NAME = "werkplek-docs-v1";
  let dbPromise = null;
  let pending = null;
  let writing = null;
  let lastError = null;
  const listeners = new Set();

  function openDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is niet beschikbaar in deze browser."));
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(new Error("Werkplek-opslag (IndexedDB) openen mislukt.")); };
    });
    return dbPromise;
  }

  async function idbGet() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("state", "readonly").objectStore("state").get("doc");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error("Werkplek-opslag lezen mislukt."));
    });
  }

  async function idbPut(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(value, "doc");
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Werkplek-opslag schrijven mislukt."));
    });
  }

  function lsSavedAt(storage) {
    try { return Number(storage.getItem(SAVED_AT) || 0); } catch (error) { return 0; }
  }

  // Geeft de JSON-tekst van de nieuwste kopie terug (of null).
  async function load(storage = localStorage) {
    let local = null;
    try { local = storage.getItem(KEY); } catch (error) { local = null; }
    let stored = null;
    try { stored = await idbGet(); }
    catch (error) { if (!local) throw error; }
    if (stored && typeof stored.json === "string" && (!local || stored.savedAt >= lsSavedAt(storage))) return stored.json;
    return local;
  }

  async function flush() {
    while (pending) {
      const value = pending;
      pending = null;
      try {
        await idbPut(value);
        lastError = null;
      } catch (error) {
        lastError = error;
        listeners.forEach(listener => listener(error));
      }
    }
  }

  // Synchroon aanroepbaar: localStorage direct (als het past), IndexedDB meteen erachteraan.
  function save(json, storage = localStorage) {
    const savedAt = Date.now();
    let localOk = false;
    try {
      storage.setItem(KEY, json);
      storage.setItem(SAVED_AT, String(savedAt));
      localOk = true;
    } catch (error) {
      // Te groot voor localStorage: oude kopie weghalen zodat die bij opstarten niet wint.
      try { storage.removeItem(KEY); storage.setItem(SAVED_AT, "0"); } catch (ignore) { /* niets aan te doen */ }
    }
    if (!localOk && !("indexedDB" in window)) throw new Error("Opslag is vol en IndexedDB ontbreekt. Download een back-up.");
    pending = { savedAt, json };
    if (!writing) writing = flush().finally(() => { writing = null; if (pending) save(pending.json, storage); });
    return { localOk };
  }

  async function saveNow(json, storage = localStorage) {
    save(json, storage);
    while (writing) await writing;
    if (lastError) throw lastError;
  }

  function onError(listener) { listeners.add(listener); }

  if (navigator.storage && typeof navigator.storage.persist === "function") {
    navigator.storage.persist().catch(() => {});
  }

  window.WorkplaceStore = { KEY, load, save, saveNow, flush: () => writing || Promise.resolve(), onError };
})();
