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

  function items() {
    const all = $("wb-all").checked;
    const query = norm($("wb-search").value.trim());
    const seen = recent();
    return W().libraryList()
      .filter(item => all || item.folderTitle === FOLDER)
      .filter(item => !query || norm(item.name).includes(query))
      .sort((a, b) => (seen[b.id] || 0) - (seen[a.id] || 0) || (b.addedAt || 0) - (a.addedAt || 0));
  }

  function render() {
    if (!ready()) return;
    const list = $("wb-list");
    const found = items();
    if (!found.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "smart-empty",
        textContent: $("wb-search").value.trim() ? "Niets gevonden." : "Nog geen werkbeschrijvingen. Tik op ＋ PDF toevoegen." }));
      return;
    }
    const seen = recent();
    list.replaceChildren(...found.map(item => {
      const card = document.createElement("article");
      card.className = "wb-card";
      const open = Object.assign(document.createElement("button"), { type: "button", className: "wb-open", title: "Lezen" });
      open.append(Object.assign(document.createElement("span"), { className: "wb-icon", textContent: "📘" }));
      const text = document.createElement("span");
      text.append(Object.assign(document.createElement("strong"), { textContent: item.name.replace(/\.pdf$/i, "") }));
      const meta = [item.pages ? `${item.pages} pagina's` : "", item.folderTitle && item.folderTitle !== FOLDER ? item.folderTitle : "",
        seen[item.id] ? `gelezen ${new Date(seen[item.id]).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ");
      text.append(Object.assign(document.createElement("small"), { textContent: meta }));
      open.append(text);
      open.addEventListener("click", () => { touch(item.id); L().read(item); setTimeout(render, 500); });
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
        try { await W().libraryAdd(file, folderId, (n, total) => { if (total > 5 && n % 5 === 0) say(`${file.name}: pagina ${n} van ${total}…`); }); added++; }
        catch (error) { failed.push(`${file.name}: ${error.message}`); }
      }
      render();
      say(failed.length ? `Niet gelukt: ${failed.join("; ")}` : `${added} werkbeschrijving${added === 1 ? "" : "en"} toegevoegd. Staat ook op je andere apparaten.`);
    } finally { $("wb-add").disabled = false; }
  }

  $("wb-add").addEventListener("click", () => { $("wb-file").value = ""; $("wb-file").click(); });
  $("wb-file").addEventListener("change", () => { const files = [...$("wb-file").files]; $("wb-file").value = ""; add(files).catch(error => say(error.message)); });
  $("wb-search").addEventListener("input", render);
  $("wb-all").addEventListener("change", render);
  document.addEventListener("library-changed", render);
  document.addEventListener("werkplek-tab", event => { if (event.detail === "werk") { say(""); render(); } });
  window.WorkplaceWerkbeschrijvingen = { render, add };
})();
