(function () {
  "use strict";
  const HUB = "https://remyster.github.io/solo-leveling/";
  const DATABASE = "https://mdslvdrsggpksqrbtwci.supabase.co";

  function session(storage) {
    const raw = storage.getItem("werkhub_auth");
    if (!raw) throw new Error("Geen WerkHub-login in deze browser. Open WerkHub in dezelfde Safari-browser, log daar in en probeer opnieuw. Een beginscherm-app kan aparte opslag hebben.");
    const value = JSON.parse(raw);
    if (!value || typeof value.access_token !== "string" || !value.access_token ||
        typeof value.expires_at !== "number" || value.expires_at * 1000 <= Date.now() + 30000) {
      throw new Error("WerkHub-login ontbreekt of is verlopen. Open WerkHub om je login te vernieuwen.");
    }
    return value.access_token;
  }

  function publicConfig(html) {
    const url = html.match(/const\s+SB_URL\s*=\s*['"]([^'"]+)['"]/);
    const key = html.match(/const\s+SB_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (!url || url[1] !== DATABASE || !key) throw new Error("WerkHub-configuratie is veranderd. De koppeling moet worden bijgewerkt.");
    if (!key[1].startsWith("sb_publishable_")) {
      const parts = key[1].split(".");
      if (parts.length !== 3) throw new Error("WerkHub bevat geen herkenbare publieke clientsleutel.");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") throw new Error("Niet-publieke WerkHub-sleutels worden geweigerd.");
    }
    return { url: DATABASE, key: key[1] };
  }

  function tasks(value) {
    if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== "string" ||
        typeof item.titel !== "string" || typeof item.status !== "string" ||
        (item.deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(item.deadline)) ||
        (item.project !== null && typeof item.project !== "string"))) {
      throw new Error("WerkHub gaf een onverwacht taakformaat. Er worden geen taken getoond.");
    }
    return value;
  }

  async function loadTasks(storage, request = fetch) {
    const token = session(storage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const source = await request(HUB, { cache: "no-store", credentials: "omit", signal: controller.signal });
      if (!source.ok) throw new Error(`WerkHub-configuratie laden mislukt (HTTP ${source.status}).`);
      const config = publicConfig(await source.text());
      const response = await request(`${config.url}/rest/v1/work_tasks?select=id,titel,status,deadline,project&status=neq.klaar&order=deadline.asc.nullslast&limit=100`, {
        method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: { apikey: config.key, Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) throw new Error("WerkHub-login is verlopen. Open WerkHub en log opnieuw in.");
      if (response.status === 403) throw new Error("Geen toegang tot WerkHub-taken. Controleer de databaserechten.");
      if (!response.ok) throw new Error(`WerkHub-taken laden mislukt (HTTP ${response.status}).`);
      return tasks(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  window.WorkplaceConnections = { session, publicConfig, tasks, loadTasks };
  const button = document.getElementById("load-tasks");
  if (!button) return;
  const status = document.getElementById("task-status");
  const list = document.getElementById("task-list");
  let generation = 0;
  const clear = () => {
    generation++;
    list.replaceChildren();
    status.textContent = "Taken verborgen. Klik opnieuw op laden om actuele taken te zien.";
  };
  document.getElementById("hide-tasks").addEventListener("click", clear);
  window.addEventListener("pagehide", clear);
  window.addEventListener("storage", event => {
    if (event.key === "werkhub_auth" || event.key === null) clear();
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    const current = ++generation;
    list.replaceChildren();
    status.textContent = "WerkHub-taken laden...";
    try {
      const initialSession = localStorage.getItem("werkhub_auth");
      const rows = await loadTasks(localStorage);
      if (generation !== current) return;
      if (localStorage.getItem("werkhub_auth") !== initialSession) throw new Error("WerkHub-login is gewijzigd tijdens laden. Probeer opnieuw.");
      for (const task of rows) {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = task.titel;
        const meta = document.createElement("p");
        const labels = { bezig: "Mee bezig", wacht_op: "Wacht op", backlog: "Nog doen", klaar: "Klaar" };
        meta.textContent = [labels[task.status] || task.status, task.project, task.deadline].filter(Boolean).join(" | ");
        item.append(title, meta);
        list.append(item);
      }
      status.textContent = rows.length ? `${rows.length} open taken geladen (maximaal 100). Alleen lezen; niet offline bewaard.` : "Geen open taken gevonden.";
    } catch (error) {
      if (generation !== current) return;
      list.replaceChildren();
      status.textContent = error.name === "AbortError" ? "Laden duurt te lang. Controleer je internetverbinding." : error.message;
      console.error("Werkplek: WerkHub-koppeling mislukt:", error.name);
    } finally {
      button.disabled = false;
    }
  });
  const frame = document.getElementById("hub-frame");
  document.getElementById("open-hub-panel").addEventListener("click", () => {
    frame.hidden = false;
    frame.src = "https://remyster.github.io/ai-hub-remy/";
    document.getElementById("hub-panel-status").textContent = "AI Hub wordt geopend. Werkt de ingebouwde weergave niet, gebruik Open AI Hub. De hub gebruikt zijn eigen opslag en diensten.";
  });
  document.getElementById("close-hub-panel").addEventListener("click", () => {
    frame.hidden = true;
    frame.removeAttribute("src");
    document.getElementById("hub-panel-status").textContent = "Ingebouwde AI Hub gesloten.";
  });
})();
