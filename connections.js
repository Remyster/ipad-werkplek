(function () {
  "use strict";
  const HUB = "https://remyster.github.io/solo-leveling/";
  const DATABASE = "https://mdslvdrsggpksqrbtwci.supabase.co";

  function session(storage) {
    const raw = storage.getItem("werkhub_auth");
    if (!raw) throw new Error("Geen WerkHub-login in deze browser. Gebruik Log in bij WerkHub binnen deze app, log daar in en klik daarna Laad open taken. Een beginscherm-app kan aparte opslag hebben.");
    let value;
    try { value = JSON.parse(raw); } catch (error) { throw new Error("WerkHub-login is ongeldig. Log opnieuw in via het WerkHub-paneel."); }
    if (!value || typeof value.access_token !== "string" || !value.access_token ||
        typeof value.expires_at !== "number" || value.expires_at * 1000 <= Date.now() + 30000) {
      throw new Error("WerkHub-login ontbreekt of is verlopen. Gebruik Log in bij WerkHub binnen deze app, daarna Laad open taken.");
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
  const workhubFrame = document.getElementById("workhub-frame");
  document.getElementById("login-workhub").addEventListener("click", () => {
    workhubFrame.hidden = false;
    workhubFrame.src = HUB;
    status.textContent = "Log in bij WerkHub in het paneel hieronder. Klik daarna Laad open taken. Ook bij een verlopen login gebruik je dit paneel.";
  });
  document.getElementById("close-workhub").addEventListener("click", () => {
    workhubFrame.hidden = true;
    workhubFrame.removeAttribute("src");
  });
  workhubFrame.hidden = false;
  workhubFrame.src = HUB;
  status.textContent = "WerkHub staat standaard open. Bij een bestaande geldige login worden je open taken automatisch geladen.";
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
  try {
    session(localStorage);
    button.click();
  } catch (error) {
    status.textContent = "WerkHub staat open. Log zo nodig in in het paneel; daarna kun je de taken laden.";
  }
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
  frame.hidden = false;
  frame.src = "https://remyster.github.io/ai-hub-remy/";
  document.getElementById("hub-panel-status").textContent = "AI Hub staat standaard open. Werkt de ingebouwde weergave niet, gebruik Open AI Hub.";

  function calendarUrl(id, second = "") {
    for (const value of [id, ...(second ? [second] : [])]) {
      if (!value || value.length > 300 || !/^[a-zA-Z0-9_.@+-]+$/.test(value) || !value.includes("@")) throw new Error("Vul een geldige agenda-ID in, geen URL of geheime link.");
    }
    const url = new URL("https://calendar.google.com/calendar/embed");
    url.search = new URLSearchParams({ src: id, ctz: "Europe/Amsterdam", mode: "AGENDA", showTitle: "0", showPrint: "0" }).toString();
    if (second) url.searchParams.append("src", second);
    return url.href;
  }
  window.WorkplaceConnections.calendarUrl = calendarUrl;
  const CALENDAR_KEY = "remy-ipad-calendar-settings";
  const calendar = document.getElementById("calendar-frame");
  const calendarFields = ["calendar-name", "calendar-id", "calendar-name-private", "calendar-id-private"];
  function readCalendarSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(CALENDAR_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      return {};
    }
  }
  function saveCalendarSettings() {
    const settings = Object.fromEntries(calendarFields.map(id => [id, document.getElementById(id).value.trim()]));
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(settings));
    return settings;
  }
  const savedCalendar = readCalendarSettings();
  for (const id of calendarFields) document.getElementById(id).value = savedCalendar[id] || "";
  document.getElementById("show-calendar").addEventListener("click", () => {
    try {
      const settings = saveCalendarSettings();
      calendar.src = calendarUrl(settings["calendar-id"], settings["calendar-id-private"]);
      calendar.hidden = false;
      const names = [settings["calendar-name"], settings["calendar-name-private"]].filter(Boolean).join(" en ");
      document.getElementById("calendar-status").textContent = `${names || "Agenda"} opgeslagen en geopend. Een leeg of geblokkeerd paneel vraagt om Google-login/toestemming.`;
    } catch (error) { document.getElementById("calendar-status").textContent = error.message; }
  });
  for (const id of calendarFields) document.getElementById(id).addEventListener("change", saveCalendarSettings);
  document.getElementById("hide-calendar").addEventListener("click", () => {
    calendar.hidden = true;
    calendar.removeAttribute("src");
  });
  if (savedCalendar["calendar-id"]) {
    try {
      calendar.src = calendarUrl(savedCalendar["calendar-id"], savedCalendar["calendar-id-private"]);
      calendar.hidden = false;
      document.getElementById("calendar-status").textContent = `${savedCalendar["calendar-name"] || "Opgeslagen agenda"} automatisch geopend.`;
    } catch (error) {
      document.getElementById("calendar-status").textContent = error.message;
    }
  }
})();
