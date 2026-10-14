(function () {
  "use strict";
  let dbPromise;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("werkplek-pdf-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(new Error("PDF-opslag openen mislukt.")); };
      request.onblocked = () => { dbPromise = null; reject(new Error("PDF-opslag geblokkeerd. Sluit andere Werkplek-tabs.")); };
    });
    return dbPromise;
  }

  async function transaction(mode, run) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const request = run(tx.objectStore("files"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(new Error("PDF-opslag mislukt. Controleer vrije opslagruimte."));
      tx.onabort = () => reject(new Error("PDF-opslag afgebroken."));
    });
  }
  const get = id => transaction("readonly", store => store.get(id));
  const put = (id, value) => transaction("readwrite", store => store.put(value, id));
  const remove = id => transaction("readwrite", store => store.delete(id));

  async function importFile(file) {
    if (!(file instanceof Blob) || file.size > 20 * 1024 * 1024) throw new Error("Kies een PDF van maximaal 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF-")) throw new Error("Dit bestand is geen PDF.");
    const pdfjs = await import("./vendor/package/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/package/legacy/build/pdf.worker.mjs";
    const task = pdfjs.getDocument({
      data: bytes, isEvalSupported: false, cMapUrl: "./vendor/package/cmaps/", cMapPacked: true,
      standardFontDataUrl: "./vendor/package/standard_fonts/", wasmUrl: "./vendor/package/wasm/",
      iccUrl: "./vendor/package/iccs/", useSystemFonts: true
    });
    let pdf;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 50) throw new Error("Deze PDF-versie ondersteunt maximaal 50 pagina's per bestand.");
      const pages = [];
      let top = 0;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const original = page.getViewport({ scale: 1 });
        if (!Number.isFinite(original.width) || original.width <= 0 || original.height / original.width > 5) throw new Error("PDF-pagina heeft een niet-ondersteund formaat.");
        const viewport = page.getViewport({ scale: 800 / original.width });
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const image = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PDF-pagina omzetten mislukt.")), "image/png"));
        pages.push({ image, width: 800, height: canvas.height, top });
        top += canvas.height + 24;
      }
      const id = crypto.randomUUID();
      const name = typeof file.name === "string" ? file.name : "document.pdf";
      await put(id, { original: file, name, pages });
      return { id, name, pages: pages.map(({ width, height, top }) => ({ width, height, top })) };
    } finally {
      await task.destroy();
    }
  }

  async function images(id) {
    const file = await get(id);
    if (!file) throw new Error("PDF-bestand ontbreekt in deze browser. De penstreken blijven bewaard.");
    const result = [];
    for (const page of file.pages) {
      const url = URL.createObjectURL(page.image);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        result.push({ image, width: page.width, height: page.height, top: page.top });
      } finally { URL.revokeObjectURL(url); }
    }
    return result;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function original(id) {
    const file = await get(id);
    if (!file) throw new Error("Het originele PDF-bestand ontbreekt.");
    download(file.original, file.name);
  }

  async function backup(data) {
    const attachments = {};
    const encode = blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("PDF-back-up lezen mislukt."));
      reader.readAsDataURL(blob);
    });
    for (const doc of data.documents) {
      if (!doc.pdf || attachments[doc.pdf.id]) continue;
      const file = await get(doc.pdf.id);
      if (!file) throw new Error("Back-up afgebroken: een PDF-bestand ontbreekt.");
      attachments[doc.pdf.id] = { name: file.name, original: await encode(file.original),
        pages: await Promise.all(file.pages.map(async page => ({ ...page, image: await encode(page.image) }))) };
    }
    return { ...data, attachments };
  }

  function dataBlob(value, expectedType) {
    if (typeof value !== "string" || value.length > 160 * 1024 * 1024) throw new Error("Een bestand in de back-up is ongeldig of te groot.");
    const match = value.match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!match || match[1] !== expectedType) throw new Error(`Back-upbestand heeft niet het verwachte type ${expectedType}.`);
    let binary;
    try { binary = atob(match[2].replace(/\s/g, "")); }
    catch (error) { throw new Error("Een bestand in de back-up heeft ongeldige base64-gegevens."); }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: expectedType });
  }

  async function restore(backup, validate) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup) || typeof validate !== "function") {
      throw new Error("De gekozen back-up heeft een onbekend formaat.");
    }
    const snapshot = JSON.parse(JSON.stringify(backup));
    const attachments = snapshot.attachments;
    delete snapshot.attachments;
    validate(snapshot);
    const restored = new Set();
    for (const doc of snapshot.documents) {
      if (!doc.pdf || restored.has(doc.pdf.id)) continue;
      const asset = attachments?.[doc.pdf.id];
      if (!asset || typeof asset.name !== "string" || asset.name.length > 255 ||
          !Array.isArray(asset.pages) || asset.pages.length !== doc.pdf.pages.length) {
        throw new Error(`PDF ${doc.pdf.name} ontbreekt of is onvolledig in de back-up.`);
      }
      const original = dataBlob(asset.original, "application/pdf");
      const header = new TextDecoder().decode(new Uint8Array(await original.slice(0, 5).arrayBuffer()));
      if (header !== "%PDF-") throw new Error(`Het origineel van ${doc.pdf.name} is geen geldige PDF.`);
      const pages = asset.pages.map((page, index) => {
        const reference = doc.pdf.pages[index];
        if (!page || page.width !== reference.width || page.height !== reference.height || page.top !== reference.top) {
          throw new Error(`PDF-pagina van ${doc.pdf.name} past niet bij de back-upgegevens.`);
        }
        return { width: page.width, height: page.height, top: page.top, image: dataBlob(page.image, "image/png") };
      });
      await put(doc.pdf.id, { original, name: asset.name, pages });
      restored.add(doc.pdf.id);
    }
    return snapshot;
  }
  window.WorkplacePdf = { importFile, images, original, backup, restore, remove, download };
})();
