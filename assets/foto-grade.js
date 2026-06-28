// =============================================================================
// ReMarkt Foto Grading — experimentele wizard (Fase 1 skelet)
// -----------------------------------------------------------------------------
// Geisoleerd van de productie-app. Hergebruikt grading-engine.js (ONDERDELEN,
// getGradingOnderdelen, calculateGrade, getBorderlineAReview) als globals.
// Flow: foto-wizard -> /api/photo-analyze (Claude vision) -> prefill -> grade.
// =============================================================================
(function () {
  "use strict";

  const app = document.getElementById("app");

  // --- Foto-stappen: welke foto, en welke onderdelen die foto voedt ----------
  // (Het AI-model krijgt alle foto's tegelijk; deze mapping stuurt vooral de
  //  medewerker aan en geeft elke foto een label mee voor de AI.)
  const STAPPEN = [
    { titel: "Dicht — bovenkant", sub: "Deksel dicht, van bovenaf. Scherm uit.", dekt: ["bovenkap", "stickers"] },
    { titel: "Onderkant", sub: "Draai om: onderkant en rubber voetjes.", dekt: ["onderkant", "stickers"] },
    { titel: "Open — vooraanzicht", sub: "Open, recht van voren. Toetsenbord + palmrest + bezel.", dekt: ["palmrest", "keyboard", "touchpad", "bezel"] },
    { titel: "Randen & hoeken", sub: "Schuin, zodat alle randen en hoeken zichtbaar zijn.", dekt: ["randen", "scharnieren"] },
    { titel: "Scherm aan — witte achtergrond", sub: "Scherm aan op wit beeld. Keyinprint / whitespot.", dekt: ["lcd"] },
    { titel: "Scherm aan — donker", sub: "Scherm aan op donker beeld. Backlight bleeding.", dekt: ["lcd"] },
  ];

  const state = {
    stap: 0,
    fotos: new Array(STAPPEN.length).fill(null), // dataURL per stap
    stream: null,
    assessments: null,
  };

  // --- Hulp -----------------------------------------------------------------
  function naamVan(id) {
    const o = ONDERDELEN.find((x) => x.id === id);
    return o ? o.naam : id;
  }
  function dataUrlToBase64(dataUrl) {
    const i = dataUrl.indexOf(",");
    return i === -1 ? dataUrl : dataUrl.slice(i + 1);
  }
  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
  }

  // --- Camera + capture ------------------------------------------------------
  async function startCamera(videoEl) {
    stopCamera();
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      videoEl.srcObject = state.stream;
      await videoEl.play();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Teken huidig videoframe naar canvas, geschaald naar max 1280px, als JPEG.
  function frameNaarDataUrl(bron, breedte, hoogte) {
    const max = 1280;
    let w = breedte, h = hoogte;
    if (Math.max(w, h) > max) {
      const f = max / Math.max(w, h);
      w = Math.round(w * f); h = Math.round(h * f);
    }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bron, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.82);
  }

  function bestandNaarDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => resolve(frameNaarDataUrl(img, img.naturalWidth, img.naturalHeight));
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --- Render: wizard-stap ---------------------------------------------------
  function renderStap() {
    const s = STAPPEN[state.stap];
    const reeds = state.fotos[state.stap];

    app.innerHTML = `
      <div class="kaart">
        <div class="stap-balk">
          ${STAPPEN.map((_, i) => `<div class="dot ${i < state.stap ? "done" : ""} ${i === state.stap ? "active" : ""}"></div>`).join("")}
        </div>
        <h2>Stap ${state.stap + 1}/${STAPPEN.length} — ${s.titel}</h2>
        <p class="sub">${s.sub}</p>
        <div id="cam-wrap">
          ${reeds
            ? `<img class="preview" src="${reeds}" alt="foto">`
            : `<video id="video" playsinline muted></video>`}
        </div>
        <div class="chips">Voedt: ${s.dekt.map((id) => `<span class="chip">${naamVan(id)}</span>`).join("")}</div>
        <div class="rij">
          ${reeds
            ? `<button id="opnieuw">Opnieuw</button>`
            : `<button id="maak" class="primary">Foto maken</button>
               <button type="button" id="kies-knop">Kies bestand</button>
               <input type="file" id="kies" accept="image/*" style="display:none">`}
          <button id="vorige" ${state.stap === 0 ? "disabled" : ""}>Vorige</button>
          <button id="volgende" class="primary" ${reeds ? "" : "disabled"}>
            ${state.stap === STAPPEN.length - 1 ? "Analyseren" : "Volgende"}
          </button>
        </div>
      </div>
      <p class="sub">Tip: geen camera op deze laptop? Gebruik "Kies bestand" om een foto te uploaden.</p>
    `;

    if (!reeds) {
      const video = document.getElementById("video");
      startCamera(video).then((ok) => {
        if (!ok) {
          document.getElementById("cam-wrap").innerHTML =
            `<div class="melding">Geen camera beschikbaar. Gebruik "Kies bestand" om te uploaden.</div>`;
        }
      });

      document.getElementById("maak").onclick = () => {
        if (!video || !video.videoWidth) return;
        state.fotos[state.stap] = frameNaarDataUrl(video, video.videoWidth, video.videoHeight);
        stopCamera();
        renderStap();
      };
      const kies = document.getElementById("kies");
      document.getElementById("kies-knop").onclick = () => kies.click();
      kies.onchange = async () => {
        if (kies.files && kies.files[0]) {
          state.fotos[state.stap] = await bestandNaarDataUrl(kies.files[0]);
          stopCamera();
          renderStap();
        }
      };
    } else {
      document.getElementById("opnieuw").onclick = () => {
        state.fotos[state.stap] = null;
        renderStap();
      };
    }

    document.getElementById("vorige").onclick = () => {
      if (state.stap > 0) { stopCamera(); state.stap--; renderStap(); }
    };
    document.getElementById("volgende").onclick = () => {
      stopCamera();
      if (state.stap < STAPPEN.length - 1) { state.stap++; renderStap(); }
      else analyseer();
    };
  }

  // --- Spec uit de engine bouwen (single source of truth) --------------------
  function bouwSpec() {
    return getGradingOnderdelen().map((o) => ({
      id: o.id,
      naam: o.naam,
      hint: o.hint,
      keuzes: o.keuzes.map((k) => ({ letter: k.letter, titel: k.titel, detail: k.detail })),
      triggers: (o.triggers || []).map((t) => ({ id: t.id, label: t.label })),
    }));
  }

  // --- Backend aanroepen -----------------------------------------------------
  async function analyseer() {
    app.innerHTML = `<div class="kaart"><div class="spinner">📷 Foto's worden door de AI beoordeeld…<br><small>Dit duurt enkele seconden.</small></div></div>`;

    const images = [];
    state.fotos.forEach((dataUrl, i) => {
      if (dataUrl) images.push({ media_type: "image/jpeg", data: dataUrlToBase64(dataUrl), label: STAPPEN[i].titel });
    });

    try {
      const res = await fetch("/api/photo-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, spec: bouwSpec() }),
      });
      const json = await res.json();
      if (!json.ok) {
        toonFout(json.error || "Onbekende fout bij analyse.");
        return;
      }
      state.assessments = json.assessments;
      renderResultaat();
    } catch (e) {
      toonFout("Kon de analyse-server niet bereiken. " + e.message);
    }
  }

  function toonFout(msg) {
    app.innerHTML = `
      <div class="kaart">
        <div class="melding fout">${msg}</div>
        <div class="rij"><button id="terug" class="primary">Terug naar foto's</button></div>
      </div>`;
    document.getElementById("terug").onclick = () => { state.stap = STAPPEN.length - 1; renderStap(); };
  }

  // --- Render: AI-prefill (bewerkbaar) + grade -------------------------------
  function zekKlasse(z) { return z >= 0.75 ? "zek-hoog" : z >= 0.5 ? "zek-mid" : "zek-laag"; }

  function renderResultaat() {
    const byId = new Map(state.assessments.map((a) => [a.onderdeel_id, a]));

    const ondHtml = getGradingOnderdelen().map((o) => {
      const a = byId.get(o.id) || { letter: null, triggers: [], zekerheid: 0, onderbouwing: "" };
      const opties = o.keuzes
        .map((k) => `<option value="${k.letter}" ${a.letter === k.letter ? "selected" : ""}>${k.letter} — ${k.titel}</option>`)
        .join("");
      const trigs = (o.triggers || [])
        .map((t) => `<label><input type="checkbox" class="trig" data-ond="${o.id}" value="${t.id}" ${a.triggers.includes(t.id) ? "checked" : ""}> ${t.label}</label>`)
        .join("");
      const zPct = Math.round(a.zekerheid * 100);
      return `
        <div class="ond">
          <div class="ond-kop">
            <strong>${o.naam}</strong>
            <span class="badge ${zekKlasse(a.zekerheid)}">AI-zekerheid ${zPct}%</span>
          </div>
          <select data-ond="${o.id}" class="letter">${opties}</select>
          ${trigs ? `<div class="trigs">${trigs}</div>` : ""}
          ${a.onderbouwing ? `<div class="onderbouwing">“${a.onderbouwing}”</div>` : ""}
        </div>`;
    }).join("");

    app.innerHTML = `
      <div class="kaart">
        <h2>AI-suggesties — controleer & bevestig</h2>
        <p class="sub">De AI heeft op basis van je foto's een conditie per onderdeel voorgesteld. Pas aan waar nodig, bevestig dan.</p>
        ${ondHtml}
        <div class="rij">
          <button id="opnieuw-alles">Opnieuw fotograferen</button>
          <button id="bereken" class="primary">Bereken grade</button>
        </div>
      </div>
      <div id="grade-doel"></div>
    `;

    document.getElementById("bereken").onclick = berekenGrade;
    document.getElementById("opnieuw-alles").onclick = () => { state.stap = 0; state.fotos.fill(null); renderStap(); };
  }

  function huidigeKeuzes() {
    const keuzes = {};
    document.querySelectorAll("select.letter").forEach((sel) => { keuzes[sel.dataset.ond] = sel.value; });
    const triggers = {};
    document.querySelectorAll("input.trig:checked").forEach((cb) => { triggers[cb.value] = true; });
    return { keuzes, triggers };
  }

  // Grade puur uit de oorspronkelijke AI-suggesties (vóór menselijke correctie).
  function aiGradeResult() {
    const keuzes = {}, triggers = {};
    (state.assessments || []).forEach((a) => {
      if (a.letter) keuzes[a.onderdeel_id] = a.letter;
      (a.triggers || []).forEach((t) => { triggers[t] = true; });
    });
    return calculateGrade(keuzes, triggers);
  }

  function berekenGrade() {
    const { keuzes, triggers } = huidigeKeuzes();
    const result = calculateGrade(keuzes, triggers);
    const aiResult = aiGradeResult();
    const review = typeof getBorderlineAReview === "function" ? getBorderlineAReview(result) : null;
    const akkoord = aiResult.eindgrade && aiResult.eindgrade === result.eindgrade;

    const rows = (result.detailRows || [])
      .map((r) => `<tr><td style="padding:4px 8px">${r.naam}</td><td style="padding:4px 8px;text-align:center">${r.keuze}</td><td style="padding:4px 8px">${r.impact}</td><td style="padding:4px 8px;text-align:right">${r.punten}</td></tr>`)
      .join("");

    document.getElementById("grade-doel").innerHTML = `
      <div class="kaart">
        <div class="grade-uit">
          <div class="g">${result.eindgrade || "—"}</div>
          <div class="sub" style="margin-top:6px">Impact-score: ${result.score}</div>
          <div class="sub" style="margin-top:6px">AI stelde voor: <strong>${aiResult.eindgrade || "—"}</strong> · jouw grade: <strong>${result.eindgrade || "—"}</strong> ${akkoord ? "✅ gelijk" : "✏️ aangepast"}</div>
        </div>
        ${review ? `<div class="melding" style="margin-top:12px"><strong>${review.title}.</strong> ${review.text}</div>` : ""}
        <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--rand)">
            <th style="text-align:left;padding:4px 8px">Onderdeel</th>
            <th style="padding:4px 8px">Keuze</th>
            <th style="text-align:left;padding:4px 8px">Impact</th>
            <th style="text-align:right;padding:4px 8px">Punten</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:16px;border-top:1px solid var(--rand);padding-top:14px">
          <input id="note" placeholder="Laptop-model of serienr (optioneel)" style="width:100%;padding:8px;border:1px solid var(--rand);border-radius:8px;margin-bottom:10px">
          <div class="rij">
            <button id="opslaan" class="primary">Opslaan voor test</button>
            <button id="bekijk-log">Bekijk testlog</button>
          </div>
          <div id="log-status" class="sub" style="margin-top:8px"></div>
        </div>
      </div>
      <div id="log-doel"></div>`;

    document.getElementById("opslaan").onclick = () => slaOp(result, aiResult);
    document.getElementById("bekijk-log").onclick = bekijkLog;
    document.getElementById("grade-doel").scrollIntoView({ behavior: "smooth" });
  }

  // --- Testlog: AI-suggestie vs. menselijke eindkeuze opslaan ----------------
  async function slaOp(result, aiResult) {
    const { keuzes, triggers } = huidigeKeuzes();
    const aiBy = new Map((state.assessments || []).map((a) => [a.onderdeel_id, a]));
    const onderdelen = getGradingOnderdelen().map((o) => {
      const ai = aiBy.get(o.id) || {};
      return {
        id: o.id,
        naam: o.naam,
        ai_letter: ai.letter || null,
        ai_triggers: ai.triggers || [],
        ai_zekerheid: ai.zekerheid || 0,
        mens_letter: keuzes[o.id] || null,
        mens_triggers: (o.triggers || []).filter((t) => triggers[t.id]).map((t) => t.id),
      };
    });
    const note = (document.getElementById("note") || {}).value || "";
    const status = document.getElementById("log-status");
    status.textContent = "Opslaan…";
    try {
      const res = await fetch("/api/photo-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, ai_grade: aiResult.eindgrade, mens_grade: result.eindgrade, onderdelen }),
      });
      const json = await res.json();
      status.textContent = json.ok ? "✅ Opgeslagen in testlog." : "Opslaan mislukt: " + (json.error || "onbekend");
    } catch (e) {
      status.textContent = "Opslaan mislukt: " + e.message;
    }
  }

  async function bekijkLog() {
    const doel = document.getElementById("log-doel");
    doel.innerHTML = `<div class="kaart"><div class="spinner">Testlog laden…</div></div>`;
    try {
      const res = await fetch("/api/photo-log");
      const json = await res.json();
      if (!json.ok) {
        doel.innerHTML = `<div class="kaart"><div class="melding fout">${json.error || "Kon testlog niet laden."}</div></div>`;
        return;
      }
      const rows = (json.entries || []).map((e) => {
        const gelijk = e.ai_grade && e.ai_grade === e.mens_grade;
        return `<tr>
          <td style="padding:4px 8px">${(e.ts || "").slice(0, 16).replace("T", " ")}</td>
          <td style="padding:4px 8px">${e.note || "—"}</td>
          <td style="padding:4px 8px;text-align:center">${e.ai_grade || "—"}</td>
          <td style="padding:4px 8px;text-align:center">${e.mens_grade || "—"}</td>
          <td style="padding:4px 8px;text-align:center">${gelijk ? "✅" : "✏️"}</td>
        </tr>`;
      }).join("");
      doel.innerHTML = `
        <div class="kaart">
          <h2>Testlog</h2>
          <p class="sub">${json.total} laptops gelogd · AI-grade gelijk aan mens: <strong>${json.grade_akkoord_pct}%</strong> (${json.grade_akkoord}/${json.total})</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:1px solid var(--rand)">
              <th style="text-align:left;padding:4px 8px">Tijd</th>
              <th style="text-align:left;padding:4px 8px">Notitie</th>
              <th style="padding:4px 8px">AI</th>
              <th style="padding:4px 8px">Mens</th>
              <th style="padding:4px 8px">=</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      doel.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      doel.innerHTML = `<div class="kaart"><div class="melding fout">Kon testlog niet laden: ${e.message}</div></div>`;
    }
  }

  // --- Start -----------------------------------------------------------------
  if (typeof ONDERDELEN === "undefined" || typeof calculateGrade === "undefined") {
    app.innerHTML = `<div class="kaart"><div class="melding fout">grading-engine.js is niet geladen. Controleer de scriptvolgorde in foto-grade.html.</div></div>`;
  } else {
    renderStap();
  }
})();
