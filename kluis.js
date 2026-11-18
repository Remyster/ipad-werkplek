(function () {
  "use strict";
  // 🔐 Kluis van de Werkplek: wachtwoorden die echt geheim blijven.
  //
  // Twee sloten:
  //  1. Versleuteld op dit apparaat (AES-256-GCM). De sleutel wordt afgeleid van je code met
  //     PBKDF2-SHA256, 600.000 rondes. Code en sleutel verlaten het apparaat nooit; in de
  //     database (werkplek_kluis_*) staat alleen onleesbare inhoud, ook de namen.
  //  2. Die tabellen mogen alleen door jouw WerkHub-account gelezen worden (RLS eigenaar_only).
  //
  // Opbouw: een willekeurige datasleutel, twee keer ingepakt: met je code en met een herstelcode
  // die de app zelf maakt (±100 bits). Elke code opent dezelfde kluis.
  // Los van de Kluis in de AI Hub: eigen tabellen, eigen code.
  const $ = id => document.getElementById(id);
  if (!$("kluis")) return;
  const ITER = 600000;
  const LOCK_AFTER = 5 * 60 * 1000;     // na 5 min niks doen op slot
  const HIDDEN_LOCK = 60 * 1000;        // app weggeklikt: na 1 min op slot
  const CLIPBOARD_CLEAR = 30 * 1000;    // gekopieerd wachtwoord na 30 s van het klembord
  const FAIL_KEY = "remy-ipad-kluis-fails";
  const H = () => window.WorkplaceWerkhub;

  // ---------- crypto (los te testen) ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { const bytes = new Uint8Array(buf); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const random = n => crypto.getRandomValues(new Uint8Array(n));

  async function deriveKey(code, saltB64, iterations = ITER) {
    const base = await crypto.subtle.importKey("raw", enc.encode(code.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, value) {
    const iv = random(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
    return { iv: b64(iv), ciphertext: b64(ct) };
  }
  async function open(key, iv, ciphertext) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ciphertext));
    return JSON.parse(dec.decode(plain));
  }
  // Herstelcode: 20 tekens uit 32 goed leesbare tekens (geen 0/O/1/I/L), in groepjes van 5.
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function recoveryCode() {
    const out = [];
    while (out.length < 20) { const b = random(1)[0]; if (b < 248) out.push(ALPHABET[b % 31]); }
    return out.join("").match(/.{5}/g).join("-");
  }
  const normalizeRecovery = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function generatePassword(length = 20) {
    const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#$%&*+-=?@_"];
    const all = sets.join("");
    const pick = s => { while (true) { const b = random(1)[0]; if (b < Math.floor(256 / s.length) * s.length) return s[b % s.length]; } };
    const chars = sets.map(pick);
    while (chars.length < length) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) { const j = random(1)[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join("");
  }

  // Nieuwe kluis: datasleutel maken en twee keer inpakken.
  async function createVault(code, recovery) {
    const raw = random(32);
    const dataKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    const meta = { iter: String(ITER), salt_a: b64(random(16)), salt_b: b64(random(16)) };
    const wrapA = await seal(await deriveKey(code, meta.salt_a), { k: b64(raw) });
    const wrapB = await seal(await deriveKey(normalizeRecovery(recovery), meta.salt_b), { k: b64(raw) });
    const check = await seal(dataKey, { ok: "KLUIS_OK" });
    Object.assign(meta, { wrap_a_iv: wrapA.iv, wrap_a_ct: wrapA.ciphertext, wrap_b_iv: wrapB.iv, wrap_b_ct: wrapB.ciphertext, check_iv: check.iv, check_ct: check.ciphertext });
    raw.fill(0);
    return { meta, dataKey };
  }
  async function unwrap(meta, secret, which) {
    const iterations = Number(meta.iter) || ITER;
    try {
      const wrapKey = await deriveKey(secret, meta[`salt_${which}`], iterations);
      const { k } = await open(wrapKey, meta[`wrap_${which}_iv`], meta[`wrap_${which}_ct`]);
      const raw = unb64(k);
      const dataKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      raw.fill(0);
      const check = await open(dataKey, meta.check_iv, meta.check_ct);
      return check && check.ok === "KLUIS_OK" ? dataKey : null;
    } catch (error) { return null; }
  }
  async function unlockWith(meta, input) {
    return (await unwrap(meta, input, "a")) || (await unwrap(meta, normalizeRecovery(input), "b"));
  }
  const cryptoApi = { deriveKey, seal, open, createVault, unlockWith, recoveryCode, normalizeRecovery, generatePassword };

  // ---------- staat ----------
  let meta = null, dataKey = null, items = [], lockTimer = null, hiddenTimer = null, editing = null, pendingSetup = null;
  const say = (text, tone = "") => { const el = $("kluis-status"); el.textContent = text; el.dataset.tone = tone; };

  async function loadMeta() {
    const rows = await H().call("werkplek_kluis_meta?select=key,value");
    meta = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
    return meta.salt_a ? meta : null;
  }

  function show(view) {
    for (const id of ["kluis-login", "kluis-setup", "kluis-recovery", "kluis-open"]) $(id).hidden = id !== view;
  }

  async function start() {
    if (dataKey) { show("kluis-open"); return; }
    say("");
    try {
      const c = window.WorkplaceConnections;
      await (typeof c.freshSession === "function" ? c.freshSession(localStorage) : c.session(localStorage));
    } catch (error) {
      show("kluis-login");
      $("kluis-login-text").textContent = "Log eerst in bij WerkHub (op Vandaag). De kluis staat achter je WerkHub-account.";
      $("kluis-unlock-form").hidden = true;
      return;
    }
    try {
      const found = await loadMeta();
      $("kluis-unlock-form").hidden = !found;
      if (found) { show("kluis-login"); $("kluis-login-text").textContent = "Vul je code of je herstelcode in."; $("kluis-code").focus(); }
      else show("kluis-setup");
    } catch (error) {
      show("kluis-login");
      $("kluis-unlock-form").hidden = true;
      $("kluis-login-text").textContent = /does not exist|schema cache|42P01|PGRST205/i.test(error.message || "")
        ? "De kluis is nog niet aangemaakt in de database (WERKPLEK-KLUIS-MIGRATIE.sql)."
        : `Kluis niet bereikbaar: ${error.message || error}`;
    }
  }

  // ---------- instellen ----------
  async function setup(event) {
    event.preventDefault();
    const code = $("kluis-new-code").value, again = $("kluis-new-code2").value;
    if (code.length < 8) { say("Kies een code van minstens 8 tekens. Een zinnetje werkt goed, bijv. drie woorden.", "error"); return; }
    if (/^(\d)\1+$|^(0123|1234|2345|3456|4567|5678|6789)/.test(code) || /^\d{8}$/.test(code)) { say("Alleen cijfers is te makkelijk te raden. Doe er letters of een woord bij.", "error"); return; }
    if (code !== again) { say("De twee codes zijn niet hetzelfde.", "error"); return; }
    pendingSetup = { code, recovery: recoveryCode() };
    $("kluis-recovery-code").textContent = pendingSetup.recovery;
    $("kluis-recovery-ok").checked = false;
    $("kluis-new-code").value = $("kluis-new-code2").value = "";
    say("");
    show("kluis-recovery");
  }
  async function finishSetup() {
    if (!pendingSetup) return;
    if (!$("kluis-recovery-ok").checked) { say("Vink eerst aan dat je de herstelcode hebt opgeschreven.", "error"); return; }
    $("kluis-recovery-done").disabled = true;
    say("Kluis maken… (even geduld, het slot is bewust zwaar)");
    try {
      if (await loadMeta()) throw new Error("Er bestaat al een kluis. Herlaad en open hem met je code.");
      const created = await createVault(pendingSetup.code, pendingSetup.recovery);
      const rows = Object.entries(created.meta).map(([key, value]) => ({ key, value }));
      await H().call("werkplek_kluis_meta", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
      meta = created.meta;
      dataKey = created.dataKey;
      pendingSetup = null;
      $("kluis-recovery-code").textContent = "";
      items = [];
      openVault();
      say("✓ Kluis klaar. Alles wat je hier zet, staat alleen versleuteld in de cloud.", "ok");
    } catch (error) {
      say(`Kluis maken mislukt: ${error.message || error}`, "error");
    } finally { $("kluis-recovery-done").disabled = false; }
  }

  // ---------- openen / slot ----------
  async function unlock(event) {
    event.preventDefault();
    const input = $("kluis-code").value;
    if (!input) return;
    const fails = Number(localStorage.getItem(FAIL_KEY) || 0);
    const waitUntil = Number(localStorage.getItem(FAIL_KEY + "-until") || 0);
    if (Date.now() < waitUntil) { say(`Te vaak fout. Wacht nog ${Math.ceil((waitUntil - Date.now()) / 1000)} s.`, "error"); return; }
    $("kluis-unlock").disabled = true;
    say("Openen…");
    try {
      if (!meta) await loadMeta();
      const key = await unlockWith(meta, input);
      if (!key) {
        const next = fails + 1;
        localStorage.setItem(FAIL_KEY, String(next));
        if (next >= 5) localStorage.setItem(FAIL_KEY + "-until", String(Date.now() + 30000 * (next - 4)));
        say(next >= 3 ? `Verkeerde code (${next}×). Vergeten? Je herstelcode werkt in hetzelfde veld.` : "Verkeerde code.", "error");
        return;
      }
      localStorage.removeItem(FAIL_KEY);
      localStorage.removeItem(FAIL_KEY + "-until");
      dataKey = key;
      $("kluis-code").value = "";
      say("");
      await loadItems();
      openVault();
    } catch (error) {
      say(`Openen mislukt: ${error.message || error}`, "error");
    } finally { $("kluis-unlock").disabled = false; }
  }

  function openVault() {
    show("kluis-open");
    render();
    poke();
  }

  function lock(reason = "") {
    clearTimeout(lockTimer);
    clearTimeout(hiddenTimer);
    if (!dataKey && !items.length) return;
    dataKey = null;
    items = [];
    editing = null;
    $("kluis-list").replaceChildren();
    $("kluis-edit").hidden = true;
    for (const id of ["kluis-f-naam", "kluis-f-gebruiker", "kluis-f-wachtwoord", "kluis-f-url", "kluis-f-notitie", "kluis-search"]) $(id).value = "";
    if (!$("kluis").hidden) start();
    if (reason) say(reason);
  }
  function poke() {
    clearTimeout(lockTimer);
    if (dataKey) lockTimer = setTimeout(() => lock("🔒 Op slot gegaan na 5 minuten niks doen."), LOCK_AFTER);
  }

  // ---------- items ----------
  async function loadItems() {
    const rows = await H().call("werkplek_kluis_items?select=id,iv,ciphertext,updated_at&order=created_at.desc");
    const out = [];
    let broken = 0;
    for (const row of rows || []) {
      try { out.push({ id: row.id, ...(await open(dataKey, row.iv, row.ciphertext)) }); } catch (error) { broken++; }
    }
    items = out;
    if (broken) say(`${broken} item(s) konden niet worden geopend.`, "error");
  }

  const norm = value => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function render() {
    const query = norm($("kluis-search").value.trim());
    const list = $("kluis-list");
    const found = items.filter(item => !query || norm(`${item.naam} ${item.gebruiker} ${item.url}`).includes(query))
      .sort((a, b) => String(a.naam).localeCompare(String(b.naam), "nl"));
    $("kluis-count").textContent = `${items.length} ${items.length === 1 ? "wachtwoord" : "wachtwoorden"}`;
    if (!found.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty",
        textContent: items.length ? "Niets gevonden." : "Nog leeg. Tik op ＋ Nieuw om je eerste wachtwoord te bewaren." }));
      return;
    }
    list.replaceChildren(...found.map(item => {
      const row = document.createElement("article");
      row.className = "kluis-item";
      const head = document.createElement("div");
      head.className = "kluis-item-head";
      head.append(Object.assign(document.createElement("strong"), { textContent: item.naam || "(zonder naam)" }));
      if (item.gebruiker) head.append(Object.assign(document.createElement("small"), { textContent: item.gebruiker }));
      const secret = Object.assign(document.createElement("code"), { className: "kluis-secret", textContent: "••••••••••" });
      const actions = document.createElement("div");
      actions.className = "kluis-actions";
      const button = (label, title, run) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: label, title }); b.addEventListener("click", () => { poke(); run(b); }); return b; };
      actions.append(
        button("👁", "Laten zien / verbergen", () => { secret.textContent = secret.textContent.startsWith("•") ? item.wachtwoord || "" : "••••••••••"; }),
        button("📋 Wachtwoord", "Kopieer wachtwoord (na 30 s weer weg van het klembord)", () => copy(item.wachtwoord, "Wachtwoord")),
        ...(item.gebruiker ? [button("📋 Naam", "Kopieer gebruikersnaam", () => copy(item.gebruiker, "Gebruikersnaam"))] : []),
        ...(safeUrl(item.url) ? [button("↗", "Website openen", () => window.open(safeUrl(item.url), "_blank", "noopener"))] : []),
        button("✏️", "Bewerken", () => edit(item)),
        button("🗑", "Verwijderen", () => remove(item))
      );
      row.append(head, secret, actions);
      if (item.notitie) row.append(Object.assign(document.createElement("p"), { className: "kluis-note", textContent: item.notitie }));
      return row;
    }));
  }
  const safeUrl = value => { const v = String(value || "").trim(); if (!v) return ""; const u = /^https?:\/\//i.test(v) ? v : `https://${v}`; try { const p = new URL(u); return p.protocol === "https:" || p.protocol === "http:" ? p.href : ""; } catch (error) { return ""; } };

  let clipTimer = null;
  async function copy(value, label) {
    if (!value) { say(`${label} is leeg.`); return; }
    try {
      await navigator.clipboard.writeText(value);
      say(`📋 ${label} gekopieerd. Over 30 s haal ik hem weer van het klembord.`, "ok");
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => { navigator.clipboard.writeText("").catch(() => {}); }, CLIPBOARD_CLEAR);
    } catch (error) { say("Kopiëren lukte niet. Tik op 👁 en neem hem over.", "error"); }
  }

  function edit(item = null) {
    editing = item;
    $("kluis-edit").hidden = false;
    $("kluis-edit-title").textContent = item ? "Wachtwoord bewerken" : "Nieuw wachtwoord";
    $("kluis-f-naam").value = item?.naam || "";
    $("kluis-f-gebruiker").value = item?.gebruiker || "";
    $("kluis-f-wachtwoord").value = item?.wachtwoord || "";
    $("kluis-f-url").value = item?.url || "";
    $("kluis-f-notitie").value = item?.notitie || "";
    $("kluis-f-wachtwoord").type = "password";
    $("kluis-f-naam").focus();
  }
  async function save(event) {
    event.preventDefault();
    if (!dataKey) return;
    const value = {
      naam: $("kluis-f-naam").value.trim().slice(0, 200), gebruiker: $("kluis-f-gebruiker").value.trim().slice(0, 300),
      wachtwoord: $("kluis-f-wachtwoord").value.slice(0, 1000), url: $("kluis-f-url").value.trim().slice(0, 500),
      notitie: $("kluis-f-notitie").value.slice(0, 5000)
    };
    if (!value.naam) { say("Geef het een naam, bijv. de website of het systeem.", "error"); return; }
    $("kluis-save").disabled = true;
    try {
      const sealed = await seal(dataKey, value);
      if (editing) {
        await H().call(`werkplek_kluis_items?id=eq.${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ...sealed, updated_at: new Date().toISOString() }) });
        Object.assign(editing, value);
      } else {
        const rows = await H().call("werkplek_kluis_items?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([sealed]) });
        items.unshift({ id: rows[0].id, ...value });
      }
      editing = null;
      $("kluis-edit").hidden = true;
      for (const id of ["kluis-f-naam", "kluis-f-gebruiker", "kluis-f-wachtwoord", "kluis-f-url", "kluis-f-notitie"]) $(id).value = "";
      render();
      say("✓ Versleuteld opgeslagen.", "ok");
    } catch (error) {
      say(`Opslaan mislukt: ${error.message || error}`, "error");
    } finally { $("kluis-save").disabled = false; }
  }
  async function remove(item) {
    if (!window.confirm(`"${item.naam}" uit je kluis verwijderen? Dit kan niet ongedaan.`)) return;
    try {
      await H().call(`werkplek_kluis_items?id=eq.${encodeURIComponent(item.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      items = items.filter(entry => entry !== item);
      render();
      say(`${item.naam} verwijderd.`);
    } catch (error) { say(`Verwijderen mislukt: ${error.message || error}`, "error"); }
  }

  // ---------- bedrading ----------
  $("kluis-setup-form").addEventListener("submit", setup);
  $("kluis-recovery-done").addEventListener("click", finishSetup);
  $("kluis-recovery-copy").addEventListener("click", () => { if (pendingSetup) navigator.clipboard.writeText(pendingSetup.recovery).then(() => say("Herstelcode gekopieerd. Plak hem ergens veilig en wis hem daarna van je klembord."), () => {}); });
  $("kluis-unlock-form").addEventListener("submit", unlock);
  $("kluis-lock").addEventListener("click", () => lock("🔒 Kluis op slot."));
  $("kluis-new").addEventListener("click", () => { poke(); edit(null); });
  $("kluis-cancel").addEventListener("click", () => { editing = null; $("kluis-edit").hidden = true; });
  $("kluis-edit-form").addEventListener("submit", save);
  $("kluis-generate").addEventListener("click", () => { $("kluis-f-wachtwoord").value = generatePassword(20); $("kluis-f-wachtwoord").type = "text"; poke(); });
  $("kluis-reveal").addEventListener("click", () => { const f = $("kluis-f-wachtwoord"); f.type = f.type === "password" ? "text" : "password"; });
  $("kluis-search").addEventListener("input", () => { poke(); render(); });
  $("kluis").addEventListener("pointerdown", poke);
  $("kluis").addEventListener("keydown", poke);
  // Ander tabblad = meteen op slot. App weggeklikt = na 1 minuut op slot.
  document.addEventListener("werkplek-tab", event => { if (event.detail === "kluis") start(); else lock(); });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(hiddenTimer);
    if (document.visibilityState === "hidden" && dataKey) hiddenTimer = setTimeout(() => lock("🔒 Op slot gegaan terwijl de app op de achtergrond stond."), HIDDEN_LOCK);
  });
  window.addEventListener("pagehide", () => lock());

  window.WorkplaceKluis = { start, lock, crypto: cryptoApi };
})();
