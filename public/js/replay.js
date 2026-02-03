/* public/js/replay.js - Race Replay with Playback Controls */
(function () {
  // DOM elements
  const statusEl = document.getElementById("connectionStatus");
  const raceSelect = document.getElementById("raceSelect");
  const followSelect = document.getElementById("followSelect");
  const boatsList = document.getElementById("boatsList");
  const status = document.getElementById("status");

  // Playback controls
  const playPauseBtn = document.getElementById("playPauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const resetBtn = document.getElementById("resetBtn");
  const timeSlider = document.getElementById("timeSlider");
  const currentTimeEl = document.getElementById("currentTime");
  const totalTimeEl = document.getElementById("totalTime");
  const speedSlider = document.getElementById("speedSlider");
  const speedDisplay = document.getElementById("speedDisplay");

  // Replay state
  let raceData = [];           // All historical boat positions
  let isPlaying = false;
  let currentIndex = 0;
  let playbackTimer = null;
  let startTime = null;
  let endTime = null;
  let playbackSpeed = 1.0;

  function setStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = ok ? "green" : "red";
  }

  function showStatus(message, type) {
    if (!status) return;
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }

  function formatTime(timestamp) {
    if (!timestamp) return "--:--:--";
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  function formatDuration(ms) {
    if (!ms) return "--:--:--";
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function populateRaceDropdown(races) {
    if (!raceSelect) return;
    raceSelect.innerHTML = "";

    for (const r of races) {
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

    // If URL has ?raceId=... preselect it
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("raceId");
    if (wanted) raceSelect.value = wanted;
  }

  function populateFollowDropdown(boats) {
    if (!followSelect) return;
    const current = followSelect.value;
    followSelect.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "-- All boats --";
    followSelect.appendChild(allOpt);

    // Get unique boat IDs
    const uniqueBoats = new Map();
    for (const b of boats) {
      if (b.boatId && !uniqueBoats.has(b.boatId)) {
        uniqueBoats.set(b.boatId, b.boatName || b.boatId);
      }
    }

    for (const [boatId, boatName] of uniqueBoats) {
      const opt = document.createElement("option");
      opt.value = boatId;
      opt.textContent = boatName;
      followSelect.appendChild(opt);
    }

    // Restore selection if still there
    const stillThere = Array.from(followSelect.options).some(o => o.value === current);
    followSelect.value = stillThere ? current : "";
  }

  function renderBoatsList(boats) {
    if (!boatsList) return;

    if (!boats.length) {
      boatsList.textContent = "(no boat data at current time)";
      return;
    }

    const lines = boats
      .slice()
      .sort((a, b) => (a.boatName || a.boatId || "").localeCompare(b.boatName || b.boatId || ""))
      .map(b => {
        const lat = (typeof b.lat === "number") ? b.lat.toFixed(5) : "—";
        const lng = (typeof b.lng === "number") ? b.lng.toFixed(5) : "—";
        const hdg = (typeof b.heading === "number") ? Math.round(b.heading) : "—";
        const sog = (typeof b.speed === "number") ? b.speed.toFixed(1) : "—";
        const time = formatTime(b.timestamp);
        return `${b.boatId}  ${b.boatName || ""}  @ ${lat}, ${lng}  hdg:${hdg}  sog:${sog}  ${time}`;
      });

    boatsList.textContent = lines.join("\n");
  }

  async function loadRaces() {
    try {
      setStatus("Loading races...", false);
      const races = await window.FinnAPI.getRaces();
      populateRaceDropdown(races);
      setStatus("Races loaded", true);
    } catch (e) {
      console.error(e);
      setStatus("Failed to load races", false);
    }
  }

  async function loadRaceData() {
    const raceId = raceSelect.value;
    if (!raceId) {
      showStatus("Please select a race", "error");
      return;
    }

    try {
      setStatus("Loading race data...", false);
      showStatus("Loading historical data...", "loading");

      // For now, we'll use the live boats endpoint as a demo
      // In a real implementation, this would be a dedicated historical data endpoint
      const boats = await window.FinnAPI.getLiveBoats(raceId);

      if (!boats || boats.length === 0) {
        showStatus("No data found for this race", "error");
        raceData = [];
        return;
      }

      // Convert to time-series format (in real implementation, this would come pre-sorted)
      raceData = boats.map((boat, index) => ({
        ...boat,
        timestamp: boat.timestamp || (Date.now() - (boats.length - index) * 60000) // Mock timestamps
      })).sort((a, b) => a.timestamp - b.timestamp);

      if (raceData.length > 0) {
        startTime = raceData[0].timestamp;
        endTime = raceData[raceData.length - 1].timestamp;

        // Update UI
        timeSlider.min = "0";
        timeSlider.max = (raceData.length - 1).toString();
        timeSlider.value = "0";
        timeSlider.disabled = false;

        playPauseBtn.disabled = false;
        stopBtn.disabled = false;

        totalTimeEl.textContent = formatDuration(endTime - startTime);
        currentTimeEl.textContent = formatTime(startTime);

        populateFollowDropdown(raceData);
        setCurrentIndex(0);

        setStatus(`Loaded ${raceData.length} data points`, true);
        showStatus(`Ready to replay (${raceData.length} data points)`, "success");
      } else {
        showStatus("No valid data points found", "error");
      }

    } catch (e) {
      console.error(e);
      setStatus("Failed to load race data", false);
      showStatus(`Error: ${e.message}`, "error");
    }
  }

  function setCurrentIndex(index) {
    if (!raceData.length) return;

    currentIndex = Math.max(0, Math.min(index, raceData.length - 1));

    // Update time slider
    timeSlider.value = currentIndex.toString();

    // Update time display
    if (raceData[currentIndex]) {
      currentTimeEl.textContent = formatTime(raceData[currentIndex].timestamp);
    }

    // Show boats at current time
    const currentBoats = [raceData[currentIndex]].filter(Boolean);

    // Update map
    if (window.FinnMap && typeof window.FinnMap.updateBoats === "function") {
      window.FinnMap.updateBoats(null, currentBoats);
    }

    renderBoatsList(currentBoats);

    // Handle follow boat
    const followId = followSelect.value;
    if (followId && window.FinnMap && typeof window.FinnMap.followBoat === "function") {
      window.FinnMap.followBoat(followId);
    }
  }

  function togglePlayPause() {
    if (!raceData.length) return;

    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (!raceData.length) return;

    isPlaying = true;
    playPauseBtn.textContent = "⏸️ Pause";

    playbackTimer = setInterval(() => {
      if (currentIndex >= raceData.length - 1) {
        pause();
        return;
      }
      setCurrentIndex(currentIndex + 1);
    }, 1000 / playbackSpeed); // Base interval of 1 second, modified by speed
  }

  function pause() {
    isPlaying = false;
    playPauseBtn.textContent = "▶️ Play";

    if (playbackTimer) {
      clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }

  function stop() {
    pause();
    setCurrentIndex(0);
  }

  function reset() {
    pause();
    setCurrentIndex(0);
    if (window.FinnMap && typeof window.FinnMap.resetView === "function") {
      window.FinnMap.resetView();
    }
  }

  // Event listeners
  document.getElementById("loadRaceBtn")?.addEventListener("click", loadRaceData);

  playPauseBtn?.addEventListener("click", togglePlayPause);
  stopBtn?.addEventListener("click", stop);
  resetBtn?.addEventListener("click", reset);

  timeSlider?.addEventListener("input", (e) => {
    const index = parseInt(e.target.value, 10);
    setCurrentIndex(index);
  });

  speedSlider?.addEventListener("input", (e) => {
    playbackSpeed = parseFloat(e.target.value);
    speedDisplay.textContent = `${playbackSpeed.toFixed(1)}x`;

    // Restart timer with new speed if playing
    if (isPlaying) {
      pause();
      play();
    }
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

  // Initialize
  window.addEventListener("DOMContentLoaded", async () => {
    setStatus("Loading races...", false);
    await loadRaces();

    // Auto-load if URL has raceId
    const params = new URLSearchParams(window.location.search);
    if (params.get("raceId")) {
      setTimeout(loadRaceData, 500);
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName.toLowerCase() === "input" || e.target.tagName.toLowerCase() === "select") {
      return; // Don't interfere with form inputs
    }

    switch (e.key) {
      case " ": // Spacebar
        e.preventDefault();
        togglePlayPause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        setCurrentIndex(currentIndex - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        setCurrentIndex(currentIndex + 1);
        break;
      case "Home":
        e.preventDefault();
        setCurrentIndex(0);
        break;
      case "End":
        e.preventDefault();
        setCurrentIndex(raceData.length - 1);
        break;
    }
  });
})();
