(function () {
  "use strict";
  // Gemaksslot met een zelfgekozen pincode. Er staat geen code in deze (publieke) repo:
  // alleen een gezouten PBKDF2-hash, lokaal (zodat het slot offline werkt) en in
  // werkplek_kluis_meta onder SLOT_KEY (alleen jouw account kan die rij lezen), zodat
  // dezelfde pincode op al je apparaten werkt.
  // Regel bij verschil: de laatst gekozen pincode wint (veld `at`). Andere apparaten nemen
  // hem over bij de eerstvolgende keer dat ze ingelogd zijn.
  const SESSION_KEY = "remy-ipad-workplace-unlocked";
  const LOCAL_KEY = "remy-ipad-slot-v2";
  const SLOT_KEY = "slot_pin";
  const ITERATIONS = 150000;
  const $ = id => document.getElementById(id);
  const lock = $("app-lock");
  const form = $("app-lock-form");
  const input = $("app-lock-pin");
  const error = $("app-lock-error");
  const title = $("app-lock-title");
  const uitleg = $("app-lock-uitleg");
  const knop = form.querySelector("button[type=submit]");

  let modus = "open";       // open | kies | herhaal
  let eersteKeuze = "";

  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  const unhex = s => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));

  async function afleiden(pin, saltHex, iterations) {
    const basis = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations }, basis, 256);
    return hex(bits);
  }

  async function maakSlot(pin) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { v: 1, salt, iter: ITERATIONS, hash: await afleiden(pin, salt, ITERATIONS), at: new Date().toISOString() };
  }

  function geldig(slot) {
    return slot && typeof slot.salt === "string" && typeof slot.hash === "string" && Number(slot.iter) > 0;
  }

  function leesLokaal() {
    try { const s = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); return geldig(s) ? s : null; } catch (e) { return null; }
  }
  function schrijfLokaal(slot) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(slot)); } catch (e) { /* privévenster: dan alleen deze sessie */ } }

  const werkhub = () => window.WorkplaceWerkhub;
  async function leesCloud() {
    const H = werkhub();
    if (!H || typeof H.call !== "function") return null;
    try {
      const rows = await H.call(`werkplek_kluis_meta?key=eq.${SLOT_KEY}&select=value`);
      const waarde = Array.isArray(rows) && rows[0] ? JSON.parse(rows[0].value) : null;
      return geldig(waarde) ? waarde : null;
    } catch (e) { return undefined; } // undefined = niet bereikbaar / niet ingelogd, null = er staat niets
  }
  async function schrijfCloud(slot) {
    const H = werkhub();
    if (!H || typeof H.call !== "function") return false;
    try {
      await H.call("werkplek_kluis_meta?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ key: SLOT_KEY, value: JSON.stringify(slot), updated_at: new Date().toISOString() }])
      });
      return true;
    } catch (e) { return false; }
  }

  // Na ontgrendelen of bij het starten: lokaal en cloud gelijktrekken, zonder dat je iets merkt.
  async function gelijktrekken() {
    const cloud = await leesCloud();
    if (cloud === undefined) return;          // geen verbinding of niet ingelogd: later opnieuw
    const lokaal = leesLokaal();
    if (!lokaal) { if (cloud) schrijfLokaal(cloud); return; }
    if (!cloud) { await schrijfCloud(lokaal); return; }  // eerste apparaat met een pincode: delen
    if (cloud.hash === lokaal.hash && cloud.salt === lokaal.salt) return;
    if (String(lokaal.at || "") > String(cloud.at || "")) await schrijfCloud(lokaal); // hier net gewijzigd
    else schrijfLokaal(cloud);                                                         // elders gewijzigd
  }

  function toon(nieuweModus) {
    modus = nieuweModus;
    input.value = "";
    error.textContent = "";
    if (modus === "open") {
      title.textContent = "Werkplek openen";
      uitleg.textContent = "Voer je pincode in.";
      knop.textContent = "Open Werkplek";
    } else if (modus === "kies") {
      title.textContent = "Kies een pincode";
      uitleg.textContent = "4 tot 8 cijfers. Dezelfde pincode werkt daarna op al je apparaten waar je bij WerkHub bent ingelogd.";
      knop.textContent = "Verder";
    } else {
      title.textContent = "Nog een keer";
      uitleg.textContent = "Typ dezelfde pincode nog eens ter controle.";
      knop.textContent = "Pincode bewaren";
    }
    lock.hidden = false;
    document.body.classList.add("locked");
    setTimeout(() => input.focus(), 0);
  }

  function unlock() {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) { /* geen sessionStorage */ }
    lock.hidden = true;
    document.body.classList.remove("locked");
    setTimeout(gelijktrekken, 3000); // even wachten tot de WerkHub-koppeling geladen is
  }

  async function verwerk() {
    const waarde = input.value.trim();
    if (!/^\d{4,8}$/.test(waarde)) { error.textContent = "Gebruik 4 tot 8 cijfers."; input.value = ""; input.focus(); return; }
    knop.disabled = true;
    try {
      if (modus === "open") {
        let slot = leesLokaal();
        let goed = slot && (await afleiden(waarde, slot.salt, Number(slot.iter))) === slot.hash;
        if (!goed) {
          // Misschien is de pincode op een ander apparaat gewijzigd: kijk één keer in de cloud.
          const cloud = await leesCloud();
          if (cloud && (!slot || cloud.hash !== slot.hash)) {
            goed = (await afleiden(waarde, cloud.salt, Number(cloud.iter))) === cloud.hash;
            if (goed) schrijfLokaal(cloud);
          }
        }
        if (goed) return unlock();
        error.textContent = "Pincode klopt niet.";
        input.value = "";
        input.focus();
      } else if (modus === "kies") {
        eersteKeuze = waarde;
        toon("herhaal");
      } else {
        if (waarde !== eersteKeuze) { eersteKeuze = ""; toon("kies"); error.textContent = "De twee pincodes waren niet gelijk. Kies opnieuw."; return; }
        const slot = await maakSlot(waarde);
        schrijfLokaal(slot);
        eersteKeuze = "";
        unlock();
        schrijfCloud(slot); // mag mislukken: gelijktrekken() probeert het later nog eens
      }
    } finally {
      knop.disabled = false;
    }
  }

  form.addEventListener("submit", event => { event.preventDefault(); verwerk(); });

  async function start() {
    document.body.classList.add("locked");
    let alOpen = false;
    try { alOpen = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { /* geen sessionStorage */ }
    if (alOpen && leesLokaal()) { unlock(); return; }
    if (leesLokaal()) { toon("open"); return; }
    // Nog geen pincode op dit apparaat: als je al ingelogd bent, de gedeelde pincode ophalen.
    title.textContent = "Even kijken…";
    uitleg.textContent = "Pincode van je andere apparaten ophalen.";
    const cloud = await new Promise(r => setTimeout(r, 300)).then(leesCloud);
    if (cloud) { schrijfLokaal(cloud); toon("open"); return; }
    toon("kies");
  }

  window.WorkplaceLock = Object.freeze({
    /** Nieuwe pincode kiezen; werkt daarna overal waar je bent ingelogd. */
    change() { toon("kies"); },
    lock() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* */ } toon(leesLokaal() ? "open" : "kies"); }
  });
  start();
})();
