/* SEIZOENEN — dezelfde seizoenen, datums en kleuren als de AI Hub (index.html, blok SEIZOENEN)
   en NotitieHub (Seizoen.kt). Wijzig je hier iets, doe het daar ook: samen zijn ze één geheel.

   Gebruik: <script src="./seizoen.js" data-app="werkhub" data-titel="header.top h1" data-voor=".gearbtn" defer></script>
   - data-app     voorvoegsel voor de localStorage-sleutels (per app, per apparaat)
   - data-titel   het element waar het teken en de aftelling bij komen
   - data-voor    (optioneel) kind van de titel waarvóór ze komen, anders achteraan

   Gedaan voor een licht thema: een kleurband bovenaan, zachte gloed op de achtergrond, een
   teken achter de titel, een aftelling naar de feestdag en één keer per dag een kort effect.
   Knoppen en huisstijl blijven zoals ze zijn. Tik op het teken of de aftelling om te kiezen. */
(function () {
  "use strict";
  const script = document.currentScript;
  const APP = (script && script.dataset.app) || "app";
  const TITEL = (script && script.dataset.titel) || "header h1";
  const VOOR = script && script.dataset.voor;
  const KEY = APP + "_seizoen_v1", DAGKEY = APP + "_seizoen_effect_dag";

  const S = {
    sinterklaas: { naam: "Sinterklaas", teken: "🎁", effect: "pepernoten", feest: [12, 5], pal: ["232,71,63", "242,193,78", "79,143,232", "167,123,232", "76,195,138", "242,140,56"], aftel: n => n === 0 ? "Pakjesavond!" : `nog ${n} ${n === 1 ? "nachtje" : "nachtjes"} tot pakjesavond` },
    kerst:       { naam: "Kerst",       teken: "🎄", effect: "sneeuw",     feest: [12, 25], pal: ["76,184,106", "232,74,74", "242,193,78", "95,200,232", "194,65,107", "200,214,222"], aftel: n => n === 0 ? "Fijne kerst!" : `nog ${n} ${n === 1 ? "dag" : "dagen"} tot kerst` },
    oudjaar:     { naam: "Oud & nieuw", teken: "🎆", effect: "glitter",    feest: [12, 31], pal: ["242,193,78", "232,90,168", "90,139,240", "157,123,240", "170,182,196", "242,154,74"], aftel: n => n === 0 ? "Oudejaarsavond!" : `nog ${n} ${n === 1 ? "dag" : "dagen"} tot oudjaar` },
    winter:      { naam: "Winter",      teken: "❄️", effect: "sneeuw",     pal: ["143,208,242", "180,156,240", "126,224,200", "90,139,240", "242,168,200", "176,196,214"] },
    lente:       { naam: "Lente",       teken: "🌷", effect: "bloesem",    pal: ["242,154,184", "142,212,106", "242,212,90", "185,156,240", "124,196,242", "245,168,122"] },
    koningsdag:  { naam: "Koningsdag",  teken: "👑", effect: "oranje",     feest: [4, 27], pal: ["245,154,46", "232,74,74", "79,127,232", "242,193,78", "108,196,138", "200,200,200"], aftel: n => n === 0 ? "Fijne Koningsdag!" : `nog ${n} ${n === 1 ? "dag" : "dagen"} tot Koningsdag` },
    zomer:       { naam: "Zomer",       teken: "☀️", effect: null,         pal: ["245,197,66", "63,207,196", "242,122,106", "79,163,232", "240,106,142", "168,216,74"] },
    herfst:      { naam: "Herfst",      teken: "🍂", effect: "blaadjes",   pal: ["232,135,58", "201,87,58", "217,174,58", "176,74,90", "140,168,90", "160,104,62"] }
  };

  function seizoenVoor(d) {
    const m = d.getMonth() + 1, md = m * 100 + d.getDate();
    if (md >= 1114 && md <= 1205) return "sinterklaas";
    if (md >= 1206 && md <= 1226) return "kerst";
    if (md >= 1227 || md <= 101) return "oudjaar";
    if (md >= 426 && md <= 427) return "koningsdag";
    if (m <= 2) return "winter";
    if (m <= 5) return "lente";
    if (m <= 8) return "zomer";
    return "herfst";
  }
  const lees = () => { try { return Object.assign({ keuze: "auto", effect: true }, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return { keuze: "auto", effect: true }; } };
  const bewaar = st => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* privévenster */ } };
  const actief = st => (st.keuze !== "auto" && S[st.keuze]) ? st.keuze : seizoenVoor(new Date());
  function dagenTot(maand, dag) {
    const nu = new Date(); nu.setHours(0, 0, 0, 0);
    let doel = new Date(nu.getFullYear(), maand - 1, dag);
    if (doel < nu) doel = new Date(nu.getFullYear() + 1, maand - 1, dag);
    return Math.round((doel - nu) / 864e5);
  }

  const css = document.createElement("style");
  css.id = "seizoen-css";
  css.textContent = `
html[data-seizoen]::before{content:"";position:fixed;left:0;right:0;top:0;height:4px;z-index:10000;pointer-events:none;
  background:linear-gradient(90deg,rgb(var(--s1)),rgb(var(--s2)),rgb(var(--s3)),rgb(var(--s4)),rgb(var(--s5)),rgb(var(--s6)))}
html[data-seizoen] body{background-image:
  radial-gradient(900px 500px at 0% 0%,rgba(var(--s1),.10),transparent 60%),
  radial-gradient(800px 480px at 100% 10%,rgba(var(--s3),.09),transparent 60%),
  radial-gradient(900px 600px at 50% 100%,rgba(var(--s4),.07),transparent 65%);background-attachment:fixed}
.seizoen-teken{display:inline-block;margin-left:.35em;font-size:.9em;cursor:pointer;background:none;border:0;padding:0;line-height:1;min-height:0}
.seizoen-chip{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:3px 10px;border-radius:999px;cursor:pointer;
  font:600 12px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;white-space:nowrap;vertical-align:middle;min-height:0;
  flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;
  color:color-mix(in srgb,rgb(var(--s1)) 55%,#1a1a1a);background:rgba(var(--s1),.14);border:1px solid rgba(var(--s1),.45)}
@media (max-width:520px){.seizoen-chip{font-size:11px;padding:2px 8px;margin-left:6px}}
#seizoen-doek{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9998;transition:opacity 1.2s}
#seizoen-paneel{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;background:rgba(20,30,40,.35);padding:16px}
#seizoen-paneel.open{display:flex}
#seizoen-paneel .sp-kaart{background:#fff;color:#1a2733;border-radius:16px;padding:16px;width:min(340px,100%);box-shadow:0 16px 50px rgba(0,0,0,.25);font:14px/1.4 system-ui,-apple-system,sans-serif}
#seizoen-paneel h3{margin:0 0 10px;font-size:16px}
#seizoen-paneel .sp-keuze{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px;margin:0 0 4px;border-radius:10px;border:1px solid #e2e6ea;background:#fff;color:#1a2733;font:inherit;cursor:pointer;min-height:0;justify-content:flex-start}
#seizoen-paneel .sp-keuze.actief{border-color:#1a2733;font-weight:700}
#seizoen-paneel .stip{width:14px;height:14px;border-radius:50%;flex:none}
#seizoen-paneel label{display:flex;gap:8px;align-items:center;margin:10px 0 12px}
#seizoen-paneel .sp-dicht{width:100%;padding:10px;border-radius:10px;border:0;background:#1a2733;color:#fff;font:inherit;cursor:pointer}`;
  document.head.appendChild(css);

  function pasToe() {
    const st = lees(), key = actief(st), z = S[key], root = document.documentElement;
    root.setAttribute("data-seizoen", key);
    z.pal.forEach((c, i) => root.style.setProperty("--s" + (i + 1), c));
    const titel = document.querySelector(TITEL);
    if (titel) {
      const anker = VOOR ? titel.querySelector(VOOR) : null;
      const zet = el => { if (anker) titel.insertBefore(el, anker); else titel.appendChild(el); };
      let t = titel.querySelector(".seizoen-teken");
      if (!t) { t = document.createElement("button"); t.type = "button"; t.className = "seizoen-teken"; t.addEventListener("click", open); zet(t); }
      t.textContent = z.teken; t.title = z.naam + " — tik om te kiezen"; t.setAttribute("aria-label", "Seizoen: " + z.naam);
      let chip = titel.querySelector(".seizoen-chip");
      if (z.feest) {
        if (!chip) { chip = document.createElement("button"); chip.type = "button"; chip.className = "seizoen-chip"; chip.addEventListener("click", open); zet(chip); }
        chip.textContent = z.aftel(dagenTot(z.feest[0], z.feest[1])); chip.title = chip.textContent;
      } else if (chip) chip.remove();
    }
    return { st, z };
  }

  const EFFECTKLEUR = { sneeuw: ["#9FC6DE", "#B9CFE0", "#7FB0D4"], blaadjes: ["#E8873A", "#C9573A", "#D9AE3A", "#A0683E"], bloesem: ["#F29AB8", "#E9A6BA", "#F5B8CC"],
    pepernoten: ["#8A5A35", "#A0693F", "#6E4529"], glitter: ["#E0A93A", "#E85AA8", "#5A8BF0", "#9D7BF0"], oranje: ["#F59A2E", "#E8732A", "#F5B85A"] };
  function effect(soort) {
    if (!soort || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const oud = document.getElementById("seizoen-doek"); if (oud) oud.remove();
    const doek = document.createElement("canvas"); doek.id = "seizoen-doek"; doek.setAttribute("aria-hidden", "true");
    document.body.appendChild(doek);
    const ctx = doek.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maat = () => { doek.width = innerWidth * dpr; doek.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    maat(); addEventListener("resize", maat);
    const kl = EFFECTKLEUR[soort] || EFFECTKLEUR.sneeuw, N = soort === "glitter" || soort === "oranje" ? 40 : 26;
    const d = Array.from({ length: N }, () => ({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * .8,
      r: soort === "sneeuw" ? 2 + Math.random() * 2.5 : soort === "pepernoten" ? 3 + Math.random() * 2.5 : 4 + Math.random() * 4,
      vy: .5 + Math.random() * 1.1, vx: -.3 + Math.random() * .6, hoek: Math.random() * 6.28, draai: -.04 + Math.random() * .08,
      kleur: kl[Math.floor(Math.random() * kl.length)], fase: Math.random() * 6.28 }));
    const start = performance.now(), DUUR = 9000;
    let vorige = start;
    function stap(nu) {
      if (!doek.isConnected) return;
      const dt = Math.min((nu - vorige) / 16.7, 3); vorige = nu;
      if (!document.hidden) {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of d) {
          p.fase += .02; p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.fase) * .4) * dt; p.hoek += p.draai * dt;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.hoek); ctx.fillStyle = p.kleur; ctx.globalAlpha = .8;
          if (soort === "sneeuw" || soort === "pepernoten") { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.28); ctx.fill(); }
          else if (soort === "blaadjes" || soort === "bloesem") { ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .55, 0, 0, 6.28); ctx.fill(); }
          else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
          ctx.restore();
        }
      }
      if (nu - start > DUUR && !doek.dataset.weg) { doek.dataset.weg = "1"; doek.style.opacity = "0"; setTimeout(() => { doek.remove(); removeEventListener("resize", maat); }, 1300); return; }
      requestAnimationFrame(stap);
    }
    requestAnimationFrame(stap);
  }

  let paneel = null;
  function tekenPaneel() {
    const st = lees(), nu = seizoenVoor(new Date());
    const regels = [["auto", `Automatisch (nu: ${S[nu].teken} ${S[nu].naam})`, S[nu].pal[0]]].concat(Object.entries(S).map(([k, z]) => [k, `${z.teken} ${z.naam}`, z.pal[0]]));
    const lijst = paneel.querySelector(".sp-lijst"); lijst.textContent = "";
    for (const [k, label, kleur] of regels) {
      const b = document.createElement("button"); b.type = "button"; b.className = "sp-keuze" + (st.keuze === k ? " actief" : "");
      const stip = document.createElement("span"); stip.className = "stip"; stip.style.background = `rgb(${kleur})`;
      b.append(stip, document.createTextNode(label));
      b.addEventListener("click", () => kies(k));
      lijst.appendChild(b);
    }
    paneel.querySelector("input").checked = !!st.effect;
  }
  function open() {
    if (!paneel) {
      paneel = document.createElement("div"); paneel.id = "seizoen-paneel";
      paneel.innerHTML = '<div class="sp-kaart" role="dialog" aria-label="Seizoen kiezen"><h3>🎨 Seizoen</h3><div class="sp-lijst"></div>' +
        '<label><input type="checkbox"> Kort effect bij openen (eens per dag)</label><button type="button" class="sp-dicht">Klaar</button></div>';
      paneel.addEventListener("click", e => { if (e.target === paneel) sluit(); });
      paneel.querySelector(".sp-dicht").addEventListener("click", sluit);
      paneel.querySelector("input").addEventListener("change", e => { const st = lees(); st.effect = e.target.checked; bewaar(st); });
      document.body.appendChild(paneel);
    }
    tekenPaneel(); paneel.classList.add("open");
  }
  function sluit() { if (paneel) paneel.classList.remove("open"); }
  function kies(k) { const st = lees(); st.keuze = k; bewaar(st); const r = pasToe(); if (paneel) tekenPaneel(); if (st.effect) effect(r.z.effect); }

  // Niet tijdens een slotscherm afspelen (iPad Werkplek verbergt dan alles behalve het slot).
  function naOntgrendelen(fn) {
    if (!document.body.classList.contains("locked")) return fn();
    const mo = new MutationObserver(() => { if (!document.body.classList.contains("locked")) { mo.disconnect(); fn(); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function start() {
    const r = pasToe();
    const vandaag = new Date().toDateString();
    let gezien = null; try { gezien = localStorage.getItem(DAGKEY); } catch (e) { /* */ }
    if (r.st.effect && gezien !== vandaag && r.z.effect) {
      naOntgrendelen(() => {
        try { localStorage.setItem(DAGKEY, vandaag); } catch (e) { /* */ }
        setTimeout(() => effect(r.z.effect), 600);
      });
    }
    setInterval(pasToe, 60 * 60 * 1000);
  }
  window.Seizoen = Object.freeze({ voor: seizoenVoor, open, kies });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
