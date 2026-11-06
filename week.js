(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const plusDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

  // ---- Vandaag: WerkHub, AI Hub of allebei onder elkaar ----
  // Eerder stonden ze altijd naast elkaar en waren ze op een iPad allebei te smal.
  // De keuze blijft per apparaat bewaard; de AI Hub laadt pas als je hem echt kiest.
  const HUB_KEY = "remy-ipad-hub-keuze";
  const AI_HUB_URL = "https://remyster.github.io/ai-hub-remy/";
  function showHub(choice) {
    if (!["werkhub", "aihub", "beide"].includes(choice)) choice = "werkhub";
    $("hub-panel-werkhub").hidden = choice === "aihub";
    $("hub-panel-aihub").hidden = choice === "werkhub";
    if (choice !== "werkhub") {
      const frame = $("hub-frame");
      if (frame && !frame.getAttribute("src")) frame.src = AI_HUB_URL;
    }
    document.querySelectorAll("[data-hub]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.hub === choice)));
    try { localStorage.setItem(HUB_KEY, choice); } catch (error) { /* alleen gemak */ }
  }
  document.querySelectorAll("[data-hub]").forEach(button => button.addEventListener("click", () => showHub(button.dataset.hub)));
  let savedHub = "werkhub";
  try { savedHub = localStorage.getItem(HUB_KEY) || "werkhub"; } catch (error) { /* standaard WerkHub */ }
  showHub(savedHub);

  // ---- Week: de komende 7 dagen, afspraken en WerkHub-taken per dag ----
  // Vervangt de oude tab "AI Hub & projecten", die alleen een link bevatte.
  // Belangrijk betekent sinds WerkHub v30 "staat ingepland"; een belangrijke taak zonder
  // datum is dus precies wat je hier wilt zien, en staat daarom bovenaan.
  const list = $("week-list");
  if (!list) return;
  const status = $("week-status");
  const DAYS = 7;
  const bucket = task => window.WorkplaceNu?.bucket ? window.WorkplaceNu.bucket(task) : (task.taaktype === "subtaak" ? "wel" : "belangrijk");
  const ICON = { urgent: "🔥", belangrijk: "📌", delegeren: "🤝", vast: "🔁", wel: "🧩" };
  const time = date => date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  let loadedAt = 0;

  function calendarLink(task) {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", task.titel);
    url.searchParams.set("details", "Ingepland vanuit de Werkplek (WerkHub-taak).");
    url.searchParams.set("ctz", "Europe/Amsterdam");
    return url.href;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function taskRow(task, note) {
    const row = el("div", `week-item week-taak week-${bucket(task)}`);
    row.append(el("time", "", task.begin_tijd ? task.begin_tijd.slice(0, 5) : ICON[bucket(task)]));
    const what = el("div", "", task.titel);
    const meta = [note, task.herhaling && task.herhaling !== "eenmalig" ? "🔁 vaste taak" : "", task.status === "wacht_op" ? "⏳ wacht op iemand" : ""].filter(Boolean).join(" · ");
    if (meta) what.append(el("small", "", meta));
    row.append(what);
    return row;
  }

  function eventRow(item) {
    const start = item.allDay ? new Date(`${item.start}T00:00:00`) : new Date(item.start);
    const end = item.allDay ? new Date(`${item.end}T00:00:00`) : new Date(item.end);
    const now = Date.now();
    const row = el("div", "week-item week-afspraak" + (!item.allDay && start.getTime() <= now && end.getTime() > now ? " now" : ""));
    row.append(el("time", "", item.allDay ? "hele dag" : `${time(start)}–${time(end)}`));
    const what = el("div", "", item.title);
    const meta = [item.location, item.calendar].filter(Boolean).join(" · ");
    if (meta) what.append(el("small", "", meta));
    row.append(what);
    return { row, start };
  }

  function render(tasks, events) {
    const today = new Date();
    const todayKey = iso(today);

    const ongepland = tasks.filter(task => bucket(task) === "belangrijk" && !task.deadline && task.taaktype !== "subtaak" && task.status !== "wacht_op");
    $("week-ongepland-kaart").hidden = !ongepland.length;
    $("week-ongepland").replaceChildren(...ongepland.map(task => {
      const li = el("li");
      li.append(el("span", "", task.titel));
      const plan = el("a", "prio-plan", "📅 Plan");
      Object.assign(plan, { href: calendarLink(task), target: "_blank", rel: "noopener noreferrer" });
      li.append(plan);
      return li;
    }));

    const sections = [];
    const late = tasks.filter(task => task.deadline && task.deadline < todayKey && task.taaktype !== "subtaak");
    if (late.length) {
      const section = el("section", "week-dag week-te-laat");
      section.append(el("h4", "", "⚠️ Te laat"));
      late.forEach(task => section.append(taskRow(task, new Date(`${task.deadline}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }))));
      sections.push(section);
    }

    for (let i = 0; i < DAYS; i++) {
      const day = plusDays(today, i);
      const key = iso(day);
      const section = el("section", "week-dag" + (i === 0 ? " vandaag" : ""));
      const title = i === 0 ? "Vandaag" : i === 1 ? "Morgen" : day.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      section.append(el("h4", "", title));

      const dayEvents = events.filter(item => (item.allDay ? item.start : iso(new Date(item.start))) === key).map(eventRow);
      const dayTasks = tasks.filter(task => task.deadline === key && task.taaktype !== "subtaak");
      // Getimede afspraken en taken door elkaar op tijd; hele-dag en ongetimed bovenaan.
      const timed = [
        ...dayEvents.map(e => ({ at: e.start.getHours() * 60 + e.start.getMinutes(), node: e.row })),
        ...dayTasks.map(task => ({ at: task.begin_tijd ? Number(task.begin_tijd.slice(0, 2)) * 60 + Number(task.begin_tijd.slice(3, 5)) : -1, node: taskRow(task) }))
      ].sort((a, b) => a.at - b.at);
      timed.forEach(entry => section.append(entry.node));
      tasks.filter(task => task.taaktype === "subtaak" && task.belangrijk_vanaf === key)
        .forEach(task => section.append(taskRow(task, "⏰ subtaak wordt vandaag belangrijk")));
      if (section.children.length === 1) section.append(el("p", "week-vrij", "Niks gepland."));
      sections.push(section);
    }
    list.replaceChildren(...sections);
  }

  async function load() {
    let tasks = [];
    let events = [];
    const problems = [];
    status.textContent = "Week laden...";
    try { window.WorkplaceConnections.session(localStorage); }
    catch (error) { status.textContent = "Log in bij WerkHub (op Vandaag) om je week te zien."; list.replaceChildren(); return; }
    const [taskResult, agendaResult] = await Promise.allSettled([
      window.WorkplaceWerkhub.openTasks(),
      window.WorkplaceAgenda?.fetchItems ? window.WorkplaceAgenda.fetchItems(DAYS) : Promise.reject(new Error("agenda niet geladen"))
    ]);
    if (taskResult.status === "fulfilled") tasks = taskResult.value;
    else problems.push(`taken: ${taskResult.reason?.message || taskResult.reason}`);
    if (agendaResult.status === "fulfilled") {
      events = agendaResult.value.items;
      if (agendaResult.value.errors?.length) problems.push(`agenda: ${agendaResult.value.errors.join("; ")}`);
    } else problems.push(`agenda: ${agendaResult.reason?.message || agendaResult.reason}`);
    render(tasks, events);
    loadedAt = Date.now();
    const stamp = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    status.textContent = `Bijgewerkt om ${stamp}.` + (problems.length ? ` Let op: ${problems.join(" · ")}` : "");
  }

  $("week-refresh").addEventListener("click", load);
  // Pas laden als je de tab opent, en niet vaker dan eens per 5 minuten vanzelf.
  document.addEventListener("werkplek-tab", event => {
    if (event.detail === "hubs" && Date.now() - loadedAt > 5 * 60000) load();
  });
  window.WorkplaceWeek = { load, render, showHub };
})();
