/* public/js/api.js - FinnTrack API (matches current simple backend) */
(function () {
  window.FINNTRACK_API_BASE = "https://finntrack-api-worker.hvrdfbj65m.workers.dev";

  const API_BASE = String(window.FINNTRACK_API_BASE).replace(/\/$/, "");

  async function jget(path) {
    const url = API_BASE + path;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "omit"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GET ${url} -> ${res.status} ${text}`);
    }
    return res.json();
  }

  async function jpost(path, data) {
    const url = API_BASE + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST ${url} -> ${res.status} ${text}`);
    }
    return res.json();
  }

  function normalizeRacesPayload(data) {
    // Backend returns: { races: [ { id, label, series, raceNo } ] }
    const races = (data && data.races) ? data.races : [];
    return races.map(r => ({
      raceId: r.id || "",
      title: r.label || r.id || "",
      id: r.id || "",
      label: r.label || r.id || "",
      series: r.series || "",
      raceNo: r.raceNo || 1
    })).filter(r => r.raceId);
  }

  window.FinnAPI = {
    apiBase: API_BASE,

    // GET /races - The only endpoint that actually exists
    async getRaces() {
      const data = await jget("/races");
      return normalizeRacesPayload(data);
    },

    // Mock implementation - backend doesn't have this yet
    async getFleet(raceId) {
      console.warn("getFleet: Backend doesn't implement /fleet endpoint yet");
      // Return mock fleet data for testing
      return [
        { boatId: "TEST01", boatName: "Test Boat 1", sailNumber: "01" },
        { boatId: "TEST02", boatName: "Test Boat 2", sailNumber: "02" },
        { boatId: "TEST03", boatName: "Test Boat 3", sailNumber: "03" }
      ];
    },

    // Mock implementation - backend doesn't have this yet
    async getLiveBoats(raceId, withinSeconds = 86400) {
      console.warn("getLiveBoats: Backend doesn't implement /boats endpoint yet");
      // Return mock boat positions for testing
      return [
        {
          boatId: "TEST01",
          boatName: "Test Boat 1",
          lat: -43.530,
          lng: 172.620,
          lon: 172.620,
          heading: 45,
          speed: 5.2,
          timestamp: Date.now() - 30000,
          lastSeen: Date.now() - 30000,
          active: true,
          live: true
        },
        {
          boatId: "TEST02",
          boatName: "Test Boat 2",
          lat: -43.535,
          lng: 172.625,
          lon: 172.625,
          heading: 120,
          speed: 6.1,
          timestamp: Date.now() - 60000,
          lastSeen: Date.now() - 60000,
          active: true,
          live: false
        }
      ];
    },

    // Mock implementation - backend doesn't have WebSocket yet
    openLiveWebSocket(raceId) {
      console.warn("openLiveWebSocket: Backend doesn't implement WebSocket yet");
      // Return a mock WebSocket that doesn't connect
      const mockWS = {
        readyState: WebSocket.CONNECTING,
        addEventListener: () => {},
        removeEventListener: () => {},
        send: () => console.warn("Mock WebSocket: send() called"),
        close: () => console.warn("Mock WebSocket: close() called"),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null
      };

      // Simulate immediate error since we can't connect
      setTimeout(() => {
        if (mockWS.onerror) mockWS.onerror(new Event('error'));
      }, 100);

      return mockWS;
    },

    // POST /update - This actually exists
    async sendUpdate(updateData, key) {
      const qs = key ? `?key=${encodeURIComponent(key)}` : "";
      return jpost(`/update${qs}`, updateData);
    },

    // Test the health endpoint
    async getHealth() {
      return jget("/health");
    },

    // Legacy aliases
    async listRaces() { return this.getRaces(); },
    async listBoats(raceId, withinSeconds) { return this.getLiveBoats(raceId, withinSeconds); }
  };
})();