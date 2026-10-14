(function () {
  "use strict";
  const CLIENT_ID_KEY = "remy-ipad-drive-client-id";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const DRIVE_API = "https://www.googleapis.com/drive/v3";
  const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const FOLDER_NAME = "Remy iPad Werkplek";
  const MAX_BACKUP_BYTES = 120 * 1024 * 1024;
  let accessToken = "";
  let accessTokenExpiresAt = 0;
  let folderId = "";
  let gisPromise;

  function validateClientId(value) {
    const id = String(value || "").trim();
    if (!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(id) || id.length > 200) {
      throw new Error("Vul een geldige Google OAuth client-ID in die eindigt op .apps.googleusercontent.com.");
    }
    return id;
  }

  function queryLiteral(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  async function responseJson(response, message) {
    const text = await response.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch (error) {
        if (response.ok) throw new Error(`${message}: Google gaf een onleesbaar antwoord.`);
      }
    }
    if (!response.ok) {
      const reason = payload.error?.message;
      throw new Error(`${message} (HTTP ${response.status})${reason ? `: ${reason}` : "."}`);
    }
    return payload;
  }

  function headers(token, extra = {}) {
    if (!token) throw new Error("Google Drive is niet gekoppeld.");
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  async function findOrCreateFolder(token, request = fetch) {
    const query = `name = '${queryLiteral(FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `${DRIVE_API}/files?${new URLSearchParams({
      q: query, spaces: "drive", fields: "files(id,name)", pageSize: "10"
    })}`;
    const found = await responseJson(await request(url, {
      method: "GET", headers: headers(token), cache: "no-store"
    }), "Google Drive-map zoeken mislukt");
    if (Array.isArray(found.files) && found.files.length) return found.files[0].id;
    const created = await responseJson(await request(`${DRIVE_API}/files?fields=id,name`, {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    }), "Google Drive-map maken mislukt");
    if (typeof created.id !== "string" || !created.id) throw new Error("Google Drive gaf geen map-ID terug.");
    return created.id;
  }

  async function uploadBackup(token, parentId, backup, request = fetch, now = new Date()) {
    if (!backup || typeof backup !== "object") throw new Error("De lokale back-up is ongeldig.");
    const json = JSON.stringify(backup);
    const file = new Blob([json], { type: "application/json" });
    if (file.size > MAX_BACKUP_BYTES) throw new Error("De back-up is groter dan 120 MB. Download hem lokaal en verplaats hem handmatig naar Drive.");
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const name = `iPad Werkplek backup ${stamp}.json`;
    const metadata = JSON.stringify({
      name, parents: [parentId], mimeType: "application/json",
      appProperties: { source: "remy-ipad-werkplek", format: "1" }
    });
    const boundary = `werkplek_${crypto.randomUUID().replace(/-/g, "")}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      file,
      `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    const uploaded = await responseJson(await request(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,webViewLink`, {
      method: "POST", headers: headers(token, { "Content-Type": `multipart/related; boundary=${boundary}` }), body
    }), "Google Drive-back-up uploaden mislukt");
    if (typeof uploaded.id !== "string" || !uploaded.id) throw new Error("Google Drive gaf geen bestand-ID terug.");
    return uploaded;
  }

  async function listBackups(token, parentId, request = fetch) {
    const query = `'${queryLiteral(parentId)}' in parents and trashed = false and mimeType = 'application/json' and appProperties has { key='source' and value='remy-ipad-werkplek' }`;
    const url = `${DRIVE_API}/files?${new URLSearchParams({
      q: query, spaces: "drive", fields: "files(id,name,modifiedTime,size)", orderBy: "modifiedTime desc", pageSize: "100"
    })}`;
    const payload = await responseJson(await request(url, {
      method: "GET", headers: headers(token), cache: "no-store"
    }), "Google Drive-back-ups laden mislukt");
    if (!Array.isArray(payload.files)) throw new Error("Google Drive gaf geen geldige back-uplijst terug.");
    return payload.files.filter(file => file && typeof file.id === "string" && typeof file.name === "string");
  }

  async function downloadBackup(token, fileId, request = fetch) {
    if (!/^[a-zA-Z0-9_-]{5,200}$/.test(fileId)) throw new Error("Ongeldige Google Drive-bestands-ID.");
    const response = await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: "GET", headers: headers(token), cache: "no-store"
    });
    if (!response.ok) {
      await responseJson(response, "Google Drive-back-up downloaden mislukt");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BACKUP_BYTES) throw new Error("De gekozen Drive-back-up is groter dan 120 MB.");
    const text = await response.text();
    if (text.length > MAX_BACKUP_BYTES) throw new Error("De gekozen Drive-back-up is groter dan 120 MB.");
    try { return JSON.parse(text); }
    catch (error) { throw new Error("De gekozen Drive-back-up bevat geen geldige Werkplek-gegevens."); }
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error("Google Identity Services is niet beschikbaar."));
      script.onerror = () => reject(new Error("Google-login laden mislukt. Controleer de internetverbinding en contentblokkering."));
      document.head.append(script);
    });
    return gisPromise;
  }

  async function authorize(clientId) {
    if (accessToken && Date.now() < accessTokenExpiresAt - 60000) return accessToken;
    await loadGoogleIdentity();
    const result = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: validateClientId(clientId),
        scope: DRIVE_SCOPE,
        callback: response => response?.access_token ? resolve(response) :
          reject(new Error(response?.error_description || "Google Drive-toestemming is niet verleend.")),
        error_callback: () => reject(new Error("Google Drive-login is gesloten of geblokkeerd."))
      });
      client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
    accessToken = result.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
    return accessToken;
  }

  window.WorkplaceDrive = {
    validateClientId, queryLiteral, findOrCreateFolder, uploadBackup, listBackups, downloadBackup
  };

  const clientInput = document.getElementById("drive-client-id");
  if (!clientInput) return;
  const status = document.getElementById("drive-status");
  const connectButton = document.getElementById("drive-connect");
  const backupButton = document.getElementById("drive-backup");
  const refreshButton = document.getElementById("drive-refresh");
  const restoreButton = document.getElementById("drive-restore");
  const backups = document.getElementById("drive-backups");
  const folderLink = document.getElementById("drive-folder-link");
  clientInput.value = localStorage.getItem(CLIENT_ID_KEY) || window.WorkplaceConfig?.googleDriveClientId || "";

  function showError(error) {
    status.textContent = error.message || String(error);
    console.error("Werkplek: Google Drive:", error.message || error);
  }

  async function connect() {
    const clientId = validateClientId(clientInput.value);
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    status.textContent = "Google Drive koppelen...";
    const token = await authorize(clientId);
    folderId = await findOrCreateFolder(token);
    backupButton.disabled = false;
    refreshButton.disabled = false;
    folderLink.href = `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
    folderLink.hidden = false;
    status.textContent = "Google Drive gekoppeld. Back-ups komen zichtbaar in de map Remy iPad Werkplek.";
    return token;
  }

  async function refresh() {
    const token = await connect();
    status.textContent = "Drive-back-ups laden...";
    const files = await listBackups(token, folderId);
    backups.replaceChildren(...files.map(file => {
      const option = document.createElement("option");
      option.value = file.id;
      const date = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("nl-NL") : "";
      option.textContent = [file.name, date].filter(Boolean).join(" - ");
      return option;
    }));
    restoreButton.disabled = !files.length;
    status.textContent = files.length ? `${files.length} Drive-back-up(s) gevonden.` : "Nog geen Werkplek-back-up in Google Drive.";
  }

  connectButton.addEventListener("click", async () => {
    connectButton.disabled = true;
    try { await connect(); await refresh(); }
    catch (error) { showError(error); }
    finally { connectButton.disabled = false; }
  });
  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    try { await refresh(); }
    catch (error) { showError(error); }
    finally { refreshButton.disabled = false; }
  });
  backupButton.addEventListener("click", async () => {
    backupButton.disabled = true;
    try {
      const token = await connect();
      status.textContent = "Lokale gegevens en PDF's voorbereiden...";
      const backup = await window.WorkplaceWriting.createBackup();
      status.textContent = "Back-up naar Google Drive uploaden...";
      const file = await uploadBackup(token, folderId, backup);
      status.textContent = `${file.name} staat in Google Drive en is ook op je pc zichtbaar.`;
      await refresh();
    } catch (error) { showError(error); }
    finally { backupButton.disabled = false; }
  });
  restoreButton.addEventListener("click", async () => {
    const fileId = backups.value;
    if (!fileId || !window.confirm("De gekozen Drive-back-up terugzetten? De huidige lokale Werkplek wordt vervangen. Download bij twijfel eerst een lokale back-up.")) return;
    restoreButton.disabled = true;
    try {
      const token = await connect();
      status.textContent = "Drive-back-up downloaden en controleren...";
      const backup = await downloadBackup(token, fileId);
      await window.WorkplaceWriting.restoreBackup(backup);
    } catch (error) {
      showError(error);
      restoreButton.disabled = false;
    }
  });
})();
