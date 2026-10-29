(function () {
  "use strict";
  // PDF-bibliotheek: alle PDF's op één plek, op elk apparaat (lijst via de cloud-sync,
  // bestanden in de privé-bucket werkplek-pdf; een PDF wordt pas gedownload als je hem opent).
  const $ = id => document.getElementById(id);
  const dialog = $("library-dialog");
  if (!dialog) return;
  const W = () => window.WorkplaceWriting;
  const say = text => { $("library-status").textContent = text; };
  const ALL = "__alle__", NONE = "__geen__";
  let local = new Set();

  const sizeLabel = bytes => !bytes ? "" : bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
  const norm = value => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  async function refreshLocal() {
    try { local = new Set((await window.WorkplacePdf.list()).map(file => file.id)); } catch (error) { local = new Set(); }
  }

  function renderFolders() {
    const select = $("library-folder");
    const keep = select.value || ALL;
    const titles = [...new Set([...W().libraryFolders().map(folder => folder.title), ...W().libraryList().map(item => item.folderTitle).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "nl"));
    select.replaceChildren(
      Object.assign(document.createElement("option"), { value: ALL, textContent: "Alle mappen" }),
      ...titles.map(title => Object.assign(document.createElement("option"), { value: title, textContent: title })),
      Object.assign(document.createElement("option"), { value: NONE, textContent: "Zonder map" })
    );
    select.value = [...select.options].some(option => option.value === keep) ? keep : ALL;
  }

  function button(label, title, onClick, extra = "") {
    const element = Object.assign(document.createElement("button"), { type: "button", textContent: label, title, className: extra });
    element.addEventListener("click", onClick);
    return element;
  }

  function folderIdFor(title) {
    if (!title) return null;
    const folder = W().libraryFolders().find(item => item.title === title);
    return folder ? folder.id : W().currentFolderId();
  }

  async function open(item, kind) {
    try {
      say(`${item.name} openen…`);
      await W().openFromLibrary(item.id, kind, folderIdFor(item.folderTitle));
      dialog.close();
    } catch (error) { say(error.message || String(error)); }
  }

  // ---- Lezen: PDF in een apart scherm bovenop alles, met ✕ weer weg ----
  let readerObserver = null;
  async function read(item) {
    try {
      say(`${item.name} openen…`);
      window.WorkplaceWriting?.notify?.(`${item.name.replace(/\.pdf$/i, "")} openen…`, "", null, 4000);
      const pages = await window.WorkplacePdf.images(item.id, item.name); // haalt hem zo nodig uit de cloud
      say("");
      const reader = $("pdf-reader");
      $("pdf-reader-title").textContent = item.name.replace(/\.pdf$/i, "");
      const body = $("pdf-reader-pages");
      readerObserver?.disconnect();
      const urls = new Map();
      readerObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const img = entry.target;
          const page = pages[Number(img.dataset.page)];
          if (entry.isIntersecting && !img.src) {
            const url = URL.createObjectURL(page.blob);
            urls.set(img, url);
            img.src = url;
          } else if (!entry.isIntersecting && img.src && Math.abs(entry.boundingClientRect.top) > 4000) {
            URL.revokeObjectURL(urls.get(img)); urls.delete(img); img.removeAttribute("src");
          }
        }
      }, { root: body, rootMargin: "1500px 0px" });
      body.replaceChildren(...pages.map((page, index) => {
        const img = document.createElement("img");
        img.dataset.page = String(index);
        img.alt = `Pagina ${index + 1}`;
        img.style.aspectRatio = `${page.width} / ${page.height}`;
        readerObserver.observe(img);
        return img;
      }));
      reader.dataset.zoom = "1";
      reader.style.setProperty("--zoom", "1");
      $("pdf-reader-count").textContent = `${pages.length} p.`;
      reader.hidden = false;
      document.body.classList.add("reading");
      body.scrollTop = 0;
      if (dialog.open) dialog.close();
      reader._cleanup = () => { readerObserver?.disconnect(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
    } catch (error) { say(error.message || String(error)); }
  }
  function closeReader() {
    const reader = $("pdf-reader");
    reader.hidden = true;
    document.body.classList.remove("reading");
    reader._cleanup?.();
    $("pdf-reader-pages").replaceChildren();
  }
  function zoom(step) {
    const reader = $("pdf-reader");
    const value = Math.min(3, Math.max(.5, Number(reader.dataset.zoom || 1) + step));
    reader.dataset.zoom = String(value);
    reader.style.setProperty("--zoom", String(value));
  }

  // ---- Alle PDF's ook op dit apparaat zetten (op de achtergrond), zodat ze offline en direct openen ----
  let fetching = false;
  async function downloadAll() {
    if (fetching || !navigator.onLine || !W() || typeof W().libraryList !== "function") return;
    try { window.WorkplaceConnections.session(localStorage); } catch (error) { return; }
    fetching = true;
    try {
      await refreshLocal();
      for (const item of W().libraryList()) {
        if (local.has(item.id)) continue;
        try { await window.WorkplacePdf.cloudFetch(item.id, item.name); local.add(item.id); if (dialog.open) render(); }
        catch (error) { console.warn("Werkplek: PDF ophalen later opnieuw:", item.name, error.message); }
      }
    } finally { fetching = false; }
  }

  async function download(item) {
    try {
      if (!local.has(item.id)) { say(`${item.name} uit de cloud halen…`); await window.WorkplacePdf.cloudFetch(item.id, item.name); await refreshLocal(); }
      await window.WorkplacePdf.original(item.id);
      say("");
      render();
    } catch (error) { say(error.message || String(error)); }
  }

  function remove(item) {
    const used = W().libraryUsage(item.id);
    const note = used.length ? ` ${used.length} schrift/bord met deze PDF blijft gewoon bestaan.` : "";
    if (!window.confirm(`"${item.name}" uit de bibliotheek halen?${note}`)) return;
    try { W().libraryRemove(item.id); say(`${item.name} uit de bibliotheek gehaald.`); }
    catch (error) { say(error.message || String(error)); }
  }

  function render() {
    if (!W() || typeof W().libraryList !== "function") return;
    const query = norm($("library-search").value.trim());
    const folder = $("library-folder").value || ALL;
    const items = W().libraryList()
      .filter(item => folder === ALL || (folder === NONE ? !item.folderTitle : item.folderTitle === folder))
      .filter(item => !query || norm(item.name).includes(query) || norm(item.folderTitle).includes(query))
      .sort((a, b) => b.addedAt - a.addedAt);
    const list = $("library-list");
    if (!items.length) {
      list.replaceChildren(Object.assign(document.createElement("li"), { className: "library-empty",
        textContent: W().libraryList().length ? "Niets gevonden." : "Nog geen PDF's. Tik op ＋ PDF's toevoegen." }));
      return;
    }
    list.replaceChildren(...items.map(item => {
      const li = document.createElement("li");
      li.className = "library-item";
      const info = document.createElement("div");
      info.className = "library-info";
      info.append(Object.assign(document.createElement("strong"), { textContent: item.name.replace(/\.pdf$/i, "") }));
      const meta = [item.pages ? `${item.pages} p.` : "", sizeLabel(item.size), item.folderTitle || "zonder map",
        local.has(item.id) ? "✓ op dit apparaat" : "☁️ in de cloud"].filter(Boolean).join(" · ");
      info.append(Object.assign(document.createElement("small"), { textContent: meta }));
      const used = W().libraryUsage(item.id);
      if (used.length) info.append(Object.assign(document.createElement("small"), { textContent: `Gebruikt in: ${used.map(doc => doc.title || "Zonder titel").join(", ")}` }));
      const actions = document.createElement("div");
      actions.className = "library-actions";
      actions.append(
        button("👁 Lezen", "Lezen in een apart scherm", () => read(item), "library-read"),
        button("📓 Schrift", "Open als schrift", () => open(item, "page")),
        button("⬜ Bord", "Open als whiteboard", () => open(item, "board")),
        button("⬇", "Download origineel", () => download(item)),
        button("🗑", "Uit de bibliotheek halen", () => remove(item), "library-remove")
      );
      li.append(info, actions);
      return li;
    }));
  }

  async function add(files) {
    if (!files.length) return;
    const chosen = $("library-folder").value;
    const folderId = chosen === ALL ? W().currentFolderId() : chosen === NONE ? null : folderIdFor(chosen);
    const failed = [];
    let added = 0;
    $("library-add").disabled = true;
    try {
      for (const [index, file] of files.entries()) {
        const prefix = files.length > 1 ? `PDF ${index + 1} van ${files.length}: ` : "";
        say(`${prefix}${file.name} verwerken…`);
        try {
          await W().libraryAdd(file, folderId, (number, total) => { if (total > 5 && (number === 1 || number % 5 === 0)) say(`${prefix}${file.name}: pagina ${number} van ${total}…`); });
          added++;
        } catch (error) { failed.push(`${file.name}: ${error.message}`); }
      }
      await refreshLocal();
      render();
      say(failed.length ? `Niet gelukt: ${failed.join("; ")}` : `${added} PDF${added === 1 ? "" : "'s"} toegevoegd. Ze staan nu ook op je andere apparaten.`);
    } finally { $("library-add").disabled = false; }
  }

  async function openDialog() {
    renderFolders();
    say("");
    if (!dialog.open) dialog.showModal();
    render();
    await refreshLocal();
    render();
  }

  $("library-close").addEventListener("click", () => dialog.close());
  $("library-search").addEventListener("input", render);
  $("library-folder").addEventListener("change", render);
  $("library-add").addEventListener("click", () => { $("library-file").value = ""; $("library-file").click(); });
  $("library-file").addEventListener("change", () => { const files = [...$("library-file").files]; $("library-file").value = ""; add(files).catch(error => say(error.message)); });
  document.addEventListener("library-changed", () => { if (dialog.open) { renderFolders(); render(); } setTimeout(downloadAll, 3000); });
  $("pdf-reader-close").addEventListener("click", closeReader);
  $("pdf-reader-in").addEventListener("click", () => zoom(.25));
  $("pdf-reader-out").addEventListener("click", () => zoom(-.25));
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("pdf-reader").hidden) closeReader(); });
  setTimeout(downloadAll, 15000);
  setInterval(downloadAll, 10 * 60000);

  window.WorkplaceLibrary = { open: openDialog, render, add, read, closeReader, downloadAll };
})();
