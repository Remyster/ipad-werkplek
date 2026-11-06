(function () {
  "use strict";
  // 📘 Werkbeschrijvingen: eigen tabblad voor de PDF's in de map "Werkbeschrijvingen".
  // Gebruikt de PDF-bibliotheek eronder, dus toevoegen, cloud en lezen werken precies zoals daar
  // en alles staat vanzelf op je andere apparaten.
  const $ = id => document.getElementById(id);
  const FOLDER = "Werkbeschrijvingen";
  const RECENT_KEY = "remy-ipad-wb-recent";
  const W = () => window.WorkplaceWriting;
  const L = () => window.WorkplaceLibrary;
  if (!$("werk")) return;
  const say = text => { $("wb-status").textContent = text; };
  const norm = value => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}"); } catch (error) { return {}; } };
  const touch = id => { try { const all = recent(); all[id] = Date.now(); localStorage.setItem(RECENT_KEY, JSON.stringify(all)); } catch (error) { /* alleen gemak */ } };
  const ready = () => W() && typeof W().libraryList === "function";

  // ---- PowerPoint, Word en Excel: in de privé-opslag werkplek-bestanden, openen in de eigen app van het apparaat ----
  const BUCKET = "werkplek-bestanden", PREFIX = "werkbeschrijvingen";
  const OFFICE = { pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "📊", "PowerPoint"],
    ppt: ["application/vnd.ms-powerpoint", "📊", "PowerPoint"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "📝", "Word"],
    doc: ["application/msword", "📝", "Word"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "📗", "Excel"], xls: ["application/vnd.ms-excel", "📗", "Excel"] };
  const OFFICE_CACHE = "remy-ipad-wb-office";
  const extOf = name => (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  let office = (() => { try { return JSON.parse(localStorage.getItem(OFFICE_CACHE) || "[]"); } catch (error) { return []; } })();
  async function storage(path, options = {}) {
    const connections = window.WorkplaceConnections;
    let token;
    try { token = await connections.freshSession(localStorage); } catch (error) { throw new Error("Log eerst in bij WerkHub (op Vandaag), dan kan de Werkplek bij je bestanden in de cloud."); }
    const settings = await connections.config();
    const response = await fetch(`${settings.url}/storage/v1/${path}`, { cache: "no-store", credentials: "omit", ...options,
      headers: { apikey: settings.key, Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`Cloud gaf HTTP ${response.status}.`);
    return { response, settings };
  }
  const objectPath = path => path.split("/").map(encodeURIComponent).join("/");
  async function loadOffice(loud = false) {
    try {
      const { response } = await storage(`object/list/${BUCKET}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: PREFIX, limit: 500, sortBy: { column: "created_at", order: "desc" } }) });
      const rows = await response.json();
      office = (Array.isArray(rows) ? rows : []).filter(row => row.id && OFFICE[extOf(row.name)]).map(row => ({
        id: `office:${row.name}`, path: `${PREFIX}/${row.name}`, name: row.name.replace(/^[^_]+__/, ""), size: row.metadata?.size || 0,
        addedAt: Date.parse(row.created_at) || 0, office: true }));
      try { localStorage.setItem(OFFICE_CACHE, JSON.stringify(office)); } catch (error) { /* alleen gemak */ }
      render();
    } catch (error) { if (loud) say(error.message); }
  }
  async function uploadOffice(file) {
    const ext = extOf(file.name);
    const safe = file.name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").slice(-120);
    const path = `${PREFIX}/${crypto.randomUUID()}__${safe}`;
    await storage(`object/${BUCKET}/${objectPath(path)}`, { method: "POST", headers: { "Content-Type": OFFICE[ext][0] }, body: file });
  }
  // Openen: venster meteen bij de tik openen (anders blokkeert Safari het), daarna het tijdelijke adres erin zetten.
  async function openOffice(item) {
    const win = window.open("", "_blank");
    say(`${item.name} openen…`);
    try {
      const { response, settings } = await storage(`object/sign/${BUCKET}/${objectPath(item.path)}`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
      const signed = (await response.json()).signedURL;
      const url = `${settings.url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
      if (win) { win.location.href = url; say(""); }
      else {
        const link = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener", textContent: `Tik hier om ${item.name} te openen` });
        $("wb-status").replaceChildren(link);
      }
    } catch (error) { win?.close(); say(error.message || String(error)); }
  }
  async function removeOffice(item) {
    if (!window.confirm(`"${item.name}" weghalen uit je werkbeschrijvingen (op al je apparaten)?`)) return;
    try {
      await storage(`object/${BUCKET}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [item.path] }) });
      office = office.filter(entry => entry.path !== item.path);
      try { localStorage.setItem(OFFICE_CACHE, JSON.stringify(office)); } catch (error) { /* alleen gemak */ }
      render();
      say(`${item.name} weggehaald.`);
    } catch (error) { say(error.message || String(error)); }
  }

  function items() {
    const all = $("wb-all").checked;
    const query = norm($("wb-search").value.trim());
    const seen = recent();
    return [...W().libraryList().filter(item => all || item.folderTitle === FOLDER), ...office]
      .filter(item => !query || norm(item.name).includes(query))
      .sort((a, b) => (seen[b.id] || 0) - (seen[a.id] || 0) || (b.addedAt || 0) - (a.addedAt || 0));
  }

  function render() {
    if (!ready()) return;
    const list = $("wb-list");
    const found = items();
    if (!found.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty",
        textContent: $("wb-search").value.trim() ? "Niets gevonden." : "Nog geen werkbeschrijvingen. Tik op ＋ PDF / PowerPoint toevoegen." }));
      return;
    }
    const seen = recent();
    list.replaceChildren(...found.map(item => {
      const card = document.createElement("article");
      card.className = "wb-card";
      const open = Object.assign(document.createElement("button"), { type: "button", className: "wb-open", title: "Lezen" });
      const kind = item.office ? OFFICE[extOf(item.name)] : null;
      open.append(Object.assign(document.createElement("span"), { className: "wb-icon", textContent: kind ? kind[1] : "📘" }));
      const text = document.createElement("span");
      text.append(Object.assign(document.createElement("strong"), { textContent: item.name.replace(/\.pdf$/i, "") }));
      const meta = [kind ? `${kind[2]} · opent in je ${kind[2]}-app` : "", item.pages ? `${item.pages} pagina's` : "", item.folderTitle && item.folderTitle !== FOLDER ? item.folderTitle : "",
        seen[item.id] ? `gelezen ${new Date(seen[item.id]).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ");
      text.append(Object.assign(document.createElement("small"), { textContent: meta }));
      open.append(text);
      open.addEventListener("click", () => { touch(item.id); if (item.office) openOffice(item); else L().read(item); setTimeout(render, 500); });
      if (item.office) {
        const bin = Object.assign(document.createElement("button"), { type: "button", className: "wb-notes", textContent: "🗑", title: "Weghalen" });
        bin.addEventListener("click", () => removeOffice(item));
        card.append(open, bin);
        return card;
      }
      const notes = Object.assign(document.createElement("button"), { type: "button", className: "wb-notes", textContent: "✏️", title: "Open als schrift om erop te schrijven" });
      notes.addEventListener("click", async () => {
        try { touch(item.id); await W().openFromLibrary(item.id, "page", W().ensureFolder(FOLDER)); } catch (error) { say(error.message || String(error)); }
      });
      card.append(open, notes);
      return card;
    }));
  }

  async function add(files) {
    if (!files.length) return;
    const folderId = W().ensureFolder(FOLDER);
    $("wb-add").disabled = true;
    const failed = [];
    let added = 0;
    try {
      for (const [index, file] of files.entries()) {
        say(`${files.length > 1 ? `${index + 1} van ${files.length}: ` : ""}${file.name} verwerken…`);
        try {
          if (OFFICE[extOf(file.name)]) await uploadOffice(file);
          else await W().libraryAdd(file, folderId, (n, total) => { if (total > 5 && n % 5 === 0) say(`${file.name}: pagina ${n} van ${total}…`); });
          added++;
        }
        catch (error) { failed.push(`${file.name}: ${error.message}`); }
      }
      await loadOffice();
      render();
      say(failed.length ? `Niet gelukt: ${failed.join("; ")}` : `${added} werkbeschrijving${added === 1 ? "" : "en"} toegevoegd. Staat ook op je andere apparaten.`);
    } finally { $("wb-add").disabled = false; }
  }

  $("wb-add")?.addEventListener("click", () => { $("wb-file").value = ""; $("wb-file").click(); });
  $("wb-file")?.addEventListener("change", () => { const files = [...$("wb-file").files]; $("wb-file").value = ""; add(files).catch(error => say(error.message)); });
  $("wb-search")?.addEventListener("input", render);
  $("wb-all")?.addEventListener("change", render);
  document.addEventListener("library-changed", render);
  document.addEventListener("werkplek-tab", event => { if (event.detail === "werk") { say(""); render(); loadOffice(); } });
  window.WorkplaceWerkbeschrijvingen = { render, add };
})();
