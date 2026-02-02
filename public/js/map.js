/* public/js/map.js
 * Leaflet map + Finn markers.
 * Accepts boats in either form:
 *   - flattened: { boatId, lat, lng, heading }
 *   - nested:    { boatId, telemetry: { lat, lon, heading/cog, t } }
 */
(function () {
  if (!window.L) {
    console.error("Leaflet (window.L) not found. Did you include leaflet.js?");
    return;
  }

  let map = null;
  let currentRaceId = null;

  const markers = new Map(); // boatId -> marker
  let followBoatId = null;
  let hasFit = false;

  function normalizeBoat(b) {
    const t = (b && b.telemetry) ? b.telemetry : b;
    const lat = t && typeof t.lat !== "undefined" ? Number(t.lat) : null;
    const lng = t
      ? (typeof t.lng !== "undefined" ? Number(t.lng) : (typeof t.lon !== "undefined" ? Number(t.lon) : null))
      : null;

    const heading = t && (t.heading ?? t.cog ?? t.course ?? 0);
    const ts = t && (t.t ?? t.timestamp ?? t.ts ?? null);

    return {
      boatId: b.boatId || b.id || b.deviceId || b.tid,
      boatName: b.boatName || b.name || b.boatId || b.id,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
      timestamp: typeof ts === "number" ? ts : null,
      raw: b
    };
  }

  function finnDivIcon(headingDeg) {
    const deg = Number.isFinite(Number(headingDeg)) ? Number(headingDeg) : 0;
    const html = `
      <div class="finn-marker" style="transform: rotate(${deg}deg);">
        ⛵
      </div>`;
    return L.divIcon({
      className: "finn-div-icon",
      html,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  function init(mapElId = "map") {
    if (map) return map;

    map = L.map(mapElId, { zoomControl: true }).setView([-43.53, 172.63], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    // minimal CSS fallback if you don't have style.css
    const style = document.createElement("style");
    style.textContent = `
      .finn-div-icon { background: transparent; border: none; }
      .finn-marker { font-size: 18px; line-height: 18px; transform-origin: 50% 50%; }
    `;
    document.head.appendChild(style);

    return map;
  }

  function setRace(raceId) {
    currentRaceId = raceId;
    followBoatId = null;
    hasFit = false;

    // clear markers
    for (const m of markers.values()) {
      try { m.remove(); } catch {}
    }
    markers.clear();
  }

  function updateBoats(raceId, boatsObjOrArray) {
    if (!map) init("map");
    if (raceId && raceId !== currentRaceId) setRace(raceId);

    const list = Array.isArray(boatsObjOrArray)
      ? boatsObjOrArray
      : (boatsObjOrArray && boatsObjOrArray.boats ? boatsObjOrArray.boats : []);

    const live = [];
    const seen = new Set();

    for (const raw of list) {
      const b = normalizeBoat(raw);
      if (!b.boatId || b.lat === null || b.lng === null) continue;

      seen.add(b.boatId);
      live.push(b);

      const icon = finnDivIcon(b.heading);

      if (!markers.has(b.boatId)) {
        const marker = L.marker([b.lat, b.lng], { icon }).addTo(map);
        marker.bindPopup(`<b>${escapeHtml(b.boatName || b.boatId)}</b>`);
        markers.set(b.boatId, marker);
      } else {
        const marker = markers.get(b.boatId);
        marker.setLatLng([b.lat, b.lng]);
        marker.setIcon(icon);
      }
    }

    // remove missing boats
    for (const [boatId, marker] of Array.from(markers.entries())) {
      if (!seen.has(boatId)) {
        try { marker.remove(); } catch {}
        markers.delete(boatId);
      }
    }

    // fit once
    if (!hasFit && live.length > 0) {
      const bounds = L.latLngBounds(live.map(b => [b.lat, b.lng]));
      map.fitBounds(bounds.pad(0.2));
      hasFit = true;
    }

    // follow
    if (followBoatId && markers.has(followBoatId)) {
      const m = markers.get(followBoatId);
      map.panTo(m.getLatLng(), { animate: true });
    }

    // newest first
    live.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return live;
  }

  function setFollow(boatId) {
    followBoatId = boatId || null;
  }

  function followBoat(boatId) {
    setFollow(boatId);
    if (boatId && markers.has(boatId)) {
      const m = markers.get(boatId);
      map.panTo(m.getLatLng(), { animate: true });
    }
  }

  function resetView() {
    hasFit = false;
    followBoatId = null;
    if (map) map.setView([-43.53, 172.63], 10);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  window.FinnMap = { init, setRace, updateBoats, setFollow, followBoat, resetView };
})();
