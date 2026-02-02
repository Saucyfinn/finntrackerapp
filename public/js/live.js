/* public/js/live.js - Live Tracking UI (compatible with current API Worker) */
(function () {
  const statusEl = document.getElementById("connectionStatus");
  const raceSelect = document.getElementById("raceSelect");
  const followSelect = document.getElementById("followSelect");
  const boatsList = document.getElementById("boatsList");

  const POLL_SECONDS = 3;          // UI refresh rate
  const WITHIN_SECONDS = 86400;    // include last 24h by default

  let pollTimer = null;

  function setStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = ok ? "green" : "red";
  }

  function populateRaceDropdown(races) {
    if (!raceSelect) return;
    raceSelect.innerHTML = "";

    // races: [{raceId,title,fleets:[{id,name}]}]
    for (const r of races) {
      // If the backend already provides individual race IDs (AUSNATS-2026-R01 etc),
      // just list them directly.
      const opt = document.createElement("option");
      opt.value = r.raceId;
      opt.textContent = r.title || r.raceId;
      raceSelect.appendChild(opt);
    }

    if (raceSelect.options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no races found)";
      raceSelect.appendChild(opt);
    }
  }

  function populateFollowDropdown(boats) {
    if (!followSelect) return;
    const current = followSelect.value;
    followSelect.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "-- All boats --";
    followSelect.appendChild(allOpt);

    for (const b of boats) {
      const opt = document.createElement("option");
      opt.value = b.boatId;
      opt.textContent = b.boatName || b.boatId;
      followSelect.appendChild(opt);
    }

    // preserve selection if still present
    const stillThere = Array.from(followSelect.options).some(o => o.value === current);
    followSelect.value = stillThere ? current : "";
  }

  function renderBoatsList(boats) {
    if (!boatsList) return;

    if (!boats.length) {
      boatsList.textContent = "(no boats returned)";
      return;
    }

    const now = Date.now();
    const lines = boats
      .slice()
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .map(b => {
        const ageSec = b.lastSeen ? Math.round((now - b.lastSeen) / 1000) : null;
        const ageTxt = (ageSec == null) ? "?" : `${ageSec}s ago`;
        const lat = (typeof b.lat === "number") ? b.lat.toFixed(5) : "—";
        const lng = (typeof b.lng === "number") ? b.lng.toFixed(5) : "—";
        const hdg = (typeof b.heading === "number") ? Math.round(b.heading) : "—";
        const sog = (typeof b.speed === "number") ? b.speed.toFixed(1) : "—";
        return `${b.boatId}  ${b.boatName || ""}  @ ${lat}, ${lng}  hdg:${hdg}  sog:${sog}  (${ageTxt})`;
      });

    boatsList.textContent = lines.join("\n");
  }

  async function loadRaces() {
    try {
      const races = await window.FinnAPI.getRaces();
      populateRaceDropdown(races);

      // If URL has ?raceId=... preselect it
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("raceId");
      if (wanted) raceSelect.value = wanted;

      setStatus("Races loaded", true);
    } catch (e) {
      console.error(e);
      setStatus("Failed to load races", false);
    }
  }

  async function refreshBoatsOnce() {
    const raceId = raceSelect.value;
    if (!raceId) return;

    try {
      const boats = await window.FinnAPI.getLiveBoats(raceId, WITHIN_SECONDS);

      // Update map markers (map.js expects lat/lng/heading/boatId)
      if (window.FinnMap && typeof window.FinnMap.updateBoats === "function") {
        window.FinnMap.updateBoats(boats);
      }

      populateFollowDropdown(boats);
      renderBoatsList(boats);

      setStatus(`Loaded ${boats.length} boats`, true);

      // If "follow" set, keep centering
      const followId = followSelect.value;
      if (followId && window.FinnMap && typeof window.FinnMap.followBoat === "function") {
        window.FinnMap.followBoat(followId);
      }
    } catch (e) {
      console.error(e);
      setStatus("Failed to fetch boats (check CORS / route / API base)", false);
      if (boatsList) boatsList.textContent = String(e.message || e);
    }
  }

  function startPolling() {
    stopPolling();
    refreshBoatsOnce();
    pollTimer = setInterval(refreshBoatsOnce, POLL_SECONDS * 1000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // Wire up UI
  document.getElementById("loadRaceBtn")?.addEventListener("click", () => {
    startPolling();
  });

  followSelect?.addEventListener("change", () => {
    const id = followSelect.value;
    if (!window.FinnMap) return;
    if (!id) {
      window.FinnMap.resetView?.();
    } else {
      window.FinnMap.followBoat?.(id);
    }
  });

  document.getElementById("followBtn")?.addEventListener("click", () => {
    const id = followSelect.value;
    if (id && window.FinnMap?.followBoat) window.FinnMap.followBoat(id);
  });

  document.getElementById("resetViewBtn")?.addEventListener("click", () => {
    window.FinnMap?.resetView?.();
  });

  // Boot
  window.addEventListener("DOMContentLoaded", async () => {
    setStatus("Loading races…", false);
    await loadRaces();

    // Auto-start if URL has ?autorun=1
    const params = new URLSearchParams(window.location.search);
    if (params.get("autorun") === "1") startPolling();
  });
})();