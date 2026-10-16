(function () {
  "use strict";
  // Wat nu: je WerkHub-taken in drie bakken (Eisenhower).
  // Urgent = moet zsm, Belangrijk = inplannen in je agenda, Wel doen = subtaken voor tussendoor.
  // Vinkje = klaar in WerkHub en weg uit de lijst. Geen timer.
  const $ = id => document.getElementById(id);
  const card = $("nu-card");
  if (!card) return;
  const H = () => window.WorkplaceWerkhub;
  const say = text => { $("nu-status").textContent = text; };
  const notify = (text, label, action) => window.WorkplaceWriting?.notify ? window.WorkplaceWriting.notify(text, label, action) : say(text);
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  // Zelfde regel als WerkHub: zonder gekozen prioriteit is een taak met deadline binnen 2 dagen urgent.
  function bucket(task) {
    if (task.taaktype === "subtaak") return "wel";
    if (task.prioriteit === "urgent" || task.prioriteit === "belangrijk") return task.prioriteit;
    const soon = iso(new Date(Date.now() + 2 * 864e5));
    return task.deadline && task.deadline <= soon ? "urgent" : "belangrijk";
  }

  function deadlineText(deadline) {
    if (!deadline) return "";
    const days = Math.round((new Date(deadline + "T12:00:00") - new Date(iso(new Date()) + "T12:00:00")) / 864e5);
    if (days < 0) return `${-days} ${days === -1 ? "dag" : "dagen"} te laat`;
    if (days === 0) return "vandaag";
    if (days === 1) return "morgen";
    return new Date(deadline + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  }

  function calendarLink(task) {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", task.titel);
    url.searchParams.set("details", "Ingepland vanuit de Werkplek (WerkHub-taak).");
    url.searchParams.set("ctz", "Europe/Amsterdam");
    return url.href;
  }

  function row(task) {
    const li = document.createElement("li");
    const check = Object.assign(document.createElement("button"), { type: "button", className: "prio-check", title: "Klaar", ariaLabel: `Klaar: ${task.titel}` });
    check.addEventListener("click", () => done(task, li));
    const title = Object.assign(document.createElement("span"), { className: "prio-title", textContent: task.titel });
    const when = deadlineText(task.deadline);
    if (when) title.append(Object.assign(document.createElement("small"), { textContent: when }));
    li.append(check, title);
    if (bucket(task) === "belangrijk") {
      li.append(Object.assign(document.createElement("a"), { className: "prio-plan", href: calendarLink(task), target: "_blank", rel: "noopener noreferrer", textContent: "📅 Plan" }));
    }
    return li;
  }

  let tasks = [];
  function render() {
    const order = (a, b) => (a.deadline || "9999") < (b.deadline || "9999") ? -1 : (a.deadline || "9999") > (b.deadline || "9999") ? 1 : 0;
    const open = tasks.filter(task => task.status !== "wacht_op");
    for (const key of ["urgent", "belangrijk", "wel"]) {
      const list = $(`prio-${key}`);
      const items = open.filter(task => bucket(task) === key).sort(order);
      list.replaceChildren(...(items.length ? items.map(row) : [Object.assign(document.createElement("li"), {
        className: "prio-leeg", textContent: key === "urgent" ? "Niks urgents. Lekker." : key === "belangrijk" ? "Niks om in te plannen." : "Geen klusjes voor tussendoor."
      })]));
    }
    const waiting = tasks.filter(task => task.status === "wacht_op");
    $("prio-wacht").hidden = !waiting.length;
    $("prio-wacht").textContent = waiting.length ? `⏳ Wacht op iemand: ${waiting.map(task => task.titel).join(" · ")}` : "";
  }

  async function done(task, li) {
    li.classList.add("gone");
    try {
      await H().setTaskStatus(task.id, "klaar");
      setTimeout(() => { tasks = tasks.filter(item => item.id !== task.id); render(); }, 250);
      notify(`✓ Klaar: ${task.titel}`, "Ongedaan", async () => {
        try { await H().setTaskStatus(task.id, task.status === "wacht_op" ? "wacht_op" : "backlog"); await load(); }
        catch (error) { notify(error.message || String(error)); }
      });
    } catch (error) {
      li.classList.remove("gone");
      say(`Afvinken mislukt: ${error.message || error}`);
    }
  }

  async function load() {
    try { window.WorkplaceConnections.session(localStorage); }
    catch (error) { tasks = []; render(); say("Log in bij WerkHub (hieronder) voor je taken."); return; }
    try {
      tasks = await H().openTasks();
      render();
      say("");
    } catch (error) {
      say(`Taken laden mislukt: ${error.message || error}`);
    }
  }

  $("nu-refresh").addEventListener("click", () => { load(); window.WorkplaceAgenda?.load(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  setInterval(load, 3 * 60000);
  render();
  setTimeout(load, 50);
  window.WorkplaceNu = { load, bucket };
})();
