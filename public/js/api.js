/* public/js/api.js - FinnTrack API with exact worker endpoints */
(function () {
  // API configuration - primary with fallback
  const PRIMARY_API_BASE = "https://api.finntracker.org";
  const FALLBACK_API_BASE = "https://finntrack-api-worker.hvrdfbj65m.workers.dev";

  let currentApiBase = PRIMARY_API_BASE;
  let hasFailed = false;

  // Use config.js setting if available, otherwise use primary
  const configuredBase = window.FINNTRACK_API_BASE;
  if (configuredBase && configuredBase !== PRIMARY_API_BASE) {
    currentApiBase = configuredBase.replace(/\/$/, "");
  }

  async function apiCall(path, options = {}) {
    const url = currentApiBase + path;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Check for API error format
      if (data.ok === false) {
        throw new Error(data.error || data.message || 'API returned error');
      }

      return data;
    } catch (error) {
      // Try fallback if primary fails
      if (currentApiBase === PRIMARY_API_BASE && !hasFailed) {
        console.warn(`Primary API failed, trying fallback: ${error.message}`);
        currentApiBase = FALLBACK_API_BASE;
        hasFailed = true;
        return apiCall(path, options);
      }

      throw error;
    }
  }

  // WebSocket creation with fallback
  function createWebSocket(path) {
    try {
      const wsBase = currentApiBase.replace(/^https?:/, 'wss:');
      const url = wsBase + path;
      console.log('Creating WebSocket:', url);
      return new WebSocket(url);
    } catch (error) {
      // Try fallback
      if (currentApiBase === PRIMARY_API_BASE && !hasFailed) {
        console.warn(`Primary WebSocket failed, trying fallback: ${error.message}`);
        currentApiBase = FALLBACK_API_BASE;
        hasFailed = true;
        return createWebSocket(path);
      }
      throw error;
    }
  }

  // API Interface
  window.FinnAPI = {
    // Get current API base
    getApiBase() {
      return currentApiBase;
    },

    // GET /races → { ok:true, races:[...] }
    async getRaces() {
      const data = await apiCall('/races');
      return data.races || [];
    },

    // GET /fleet/static → { ok:true, fleet:[...] } for boat list metadata
    async getStaticFleet() {
      const data = await apiCall('/fleet/static');
      return data.fleet || [];
    },

    // GET /fleet?raceId=RACE_ID → { ok:true, raceId, fleet:{ boatId: {...latest...} } }
    async getFleet(raceId) {
      if (!raceId) throw new Error('Race ID is required');

      const data = await apiCall(`/fleet?raceId=${encodeURIComponent(raceId)}`);
      return {
        raceId: data.raceId,
        fleet: data.fleet || {}
      };
    },

    // GET /boats?raceId=RACE_ID → { ok:true, boats:[...] }
    async getBoats(raceId) {
      if (!raceId) throw new Error('Race ID is required');

      const data = await apiCall(`/boats?raceId=${encodeURIComponent(raceId)}`);
      return data.boats || [];
    },

    // GET /ws/live?raceId=RACE_ID → websocket that sends snapshot/update messages
    createLiveWebSocket(raceId) {
      if (!raceId) throw new Error('Race ID is required');

      const path = `/ws/live?raceId=${encodeURIComponent(raceId)}`;
      return createWebSocket(path);
    },

    // POST /update for sending boat updates (if needed)
    async sendUpdate(updateData, apiKey) {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      };

      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const data = await apiCall('/update', options);
      return data;
    },

    // Test API connectivity
    async testConnection() {
      try {
        await this.getRaces();
        return { success: true, apiBase: currentApiBase };
      } catch (error) {
        return { success: false, error: error.message, apiBase: currentApiBase };
      }
    },

    // Reset to primary API (for retrying)
    resetToPrimary() {
      currentApiBase = PRIMARY_API_BASE;
      hasFailed = false;
    }
  };

  // Expose for debugging
  window.FINNTRACK_CURRENT_API = currentApiBase;

  console.log('FinnTrack API initialized with base:', currentApiBase);
})();