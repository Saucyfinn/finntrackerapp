/* public/js/live.js - Live boat tracking with WebSocket and polling fallback */
(function () {
  // DOM elements
  const statusBanner = document.getElementById('statusBanner');
  const raceSelect = document.getElementById('raceSelect');
  const followSelect = document.getElementById('followSelect');
  const boatsTable = document.getElementById('boatsTable');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const mapContainer = document.getElementById('map');

  // State
  let currentRaceId = null;
  let websocket = null;
  let pollTimer = null;
  let isConnected = false;
  let followBoatId = null;
  let boats = new Map(); // boatId -> boat data
  let map = null;
  let markers = new Map(); // boatId -> marker

  const POLL_INTERVAL = 2000; // 2 seconds

  // Utility functions
  function showStatus(message, type = 'info') {
    if (!statusBanner) return;

    statusBanner.className = `status-banner ${type}`;
    statusBanner.textContent = message;
    statusBanner.style.display = 'block';

    // Auto-hide success messages
    if (type === 'success') {
      setTimeout(() => {
        if (statusBanner.style.display !== 'none') {
          statusBanner.style.display = 'none';
        }
      }, 3000);
    }
  }

  function hideStatus() {
    if (statusBanner) {
      statusBanner.style.display = 'none';
    }
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  function formatSpeed(speed) {
    if (typeof speed !== 'number') return '—';
    return speed.toFixed(1) + ' kts';
  }

  function formatHeading(heading) {
    if (typeof heading !== 'number') return '—';
    return Math.round(heading) + '°';
  }

  // Map functions
  function initializeMap() {
    if (map || !mapContainer) return;

    map = L.map('map').setView([-43.53, 172.63], 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    console.log('Map initialized');
  }

  function createBoatMarker(boat) {
    if (!map) return null;

    const lat = boat.lat || boat.latitude;
    const lng = boat.lng || boat.longitude || boat.lon;
    const heading = boat.cog || boat.heading || 0;

    if (!lat || !lng) return null;

    // Create a rotated boat icon
    const icon = L.divIcon({
      className: 'boat-marker',
      html: `<div class="boat-icon" style="transform: rotate(${heading}deg);">⛵</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);

    // Popup with boat info
    const speed = formatSpeed(boat.sog || boat.speed);
    const headingStr = formatHeading(boat.cog || boat.heading);
    const time = formatTime(boat.timestamp || boat.t);

    marker.bindPopup(`
      <strong>${boat.name || boat.boatName || boat.boatId}</strong><br>
      Speed: ${speed}<br>
      Heading: ${headingStr}<br>
      Last update: ${time}
    `);

    return marker;
  }

  function updateBoatOnMap(boat) {
    const boatId = boat.boatId || boat.id;
    if (!boatId || !map) return;

    const lat = boat.lat || boat.latitude;
    const lng = boat.lng || boat.longitude || boat.lon;

    if (!lat || !lng) return;

    // Remove existing marker
    if (markers.has(boatId)) {
      map.removeLayer(markers.get(boatId));
    }

    // Create new marker
    const marker = createBoatMarker(boat);
    if (marker) {
      markers.set(boatId, marker);
    }
  }

  function clearMapMarkers() {
    markers.forEach(marker => {
      if (map && marker) {
        map.removeLayer(marker);
      }
    });
    markers.clear();
  }

  function followBoat(boatId) {
    followBoatId = boatId;

    if (boatId && boats.has(boatId) && map) {
      const boat = boats.get(boatId);
      const lat = boat.lat || boat.latitude;
      const lng = boat.lng || boat.longitude || boat.lon;

      if (lat && lng) {
        map.setView([lat, lng], 15, { animate: true });
      }
    }
  }

  function fitMapToBounds() {
    if (!map || boats.size === 0) return;

    const positions = [];
    boats.forEach(boat => {
      const lat = boat.lat || boat.latitude;
      const lng = boat.lng || boat.longitude || boat.lon;
      if (lat && lng) {
        positions.push([lat, lng]);
      }
    });

    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds.pad(0.1));
    }
  }

  // UI functions
  function populateRaceSelect(races) {
    if (!raceSelect) return;

    raceSelect.innerHTML = '';

    if (races.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No races available';
      raceSelect.appendChild(option);
      return;
    }

    races.forEach((race, index) => {
      const option = document.createElement('option');
      option.value = race.id || race.raceId;
      option.textContent = race.name || race.title || race.id || race.raceId;
      raceSelect.appendChild(option);
    });

    // Select first race by default
    if (races.length > 0 && raceSelect.options.length > 0) {
      raceSelect.selectedIndex = 0;
      currentRaceId = raceSelect.value;
    }
  }

  function populateBoatSelect() {
    if (!followSelect) return;

    const currentSelection = followSelect.value;
    followSelect.innerHTML = '';

    // Add "All boats" option
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = '-- All boats --';
    followSelect.appendChild(allOption);

    // Add boat options
    boats.forEach((boat, boatId) => {
      const option = document.createElement('option');
      option.value = boatId;
      option.textContent = boat.name || boat.boatName || boatId;
      followSelect.appendChild(option);
    });

    // Restore selection if still valid
    if (currentSelection && boats.has(currentSelection)) {
      followSelect.value = currentSelection;
    }
  }

  function updateBoatsTable() {
    if (!boatsTable) return;

    // Clear existing rows (except header)
    const tbody = boatsTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '';
    }

    if (boats.size === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="6" style="text-align: center; color: #666;">No boats available</td>';
      tbody.appendChild(row);
      return;
    }

    // Sort boats by name
    const sortedBoats = Array.from(boats.values()).sort((a, b) => {
      const nameA = a.name || a.boatName || a.boatId || '';
      const nameB = b.name || b.boatName || b.boatId || '';
      return nameA.localeCompare(nameB);
    });

    sortedBoats.forEach(boat => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${boat.name || boat.boatName || boat.boatId || '—'}</td>
        <td>${formatSpeed(boat.sog || boat.speed)}</td>
        <td>${formatHeading(boat.cog || boat.heading)}</td>
        <td>${formatTime(boat.timestamp || boat.t)}</td>
        <td>${boat.source || 'live'}</td>
        <td><button onclick="window.LiveTracking.selectBoat('${boat.boatId || boat.id}')">Follow</button></td>
      `;
      tbody.appendChild(row);
    });
  }

  // Data processing
  function processBoatData(data) {
    // Handle different data formats from WebSocket
    if (data.type === 'snapshot' && data.fleet) {
      // Snapshot: { type: "snapshot", fleet: { boatId: {...} } }
      boats.clear();
      Object.entries(data.fleet).forEach(([boatId, boatData]) => {
        boats.set(boatId, { ...boatData, boatId });
        updateBoatOnMap({ ...boatData, boatId });
      });
    } else if (data.type === 'update' && data.boat) {
      // Update: { type: "update", boat: {...} }
      const boat = data.boat;
      const boatId = boat.boatId || boat.id;
      if (boatId) {
        boats.set(boatId, boat);
        updateBoatOnMap(boat);
      }
    } else if (Array.isArray(data)) {
      // Direct array of boats
      boats.clear();
      data.forEach(boat => {
        const boatId = boat.boatId || boat.id;
        if (boatId) {
          boats.set(boatId, boat);
          updateBoatOnMap(boat);
        }
      });
    }

    // Update UI
    populateBoatSelect();
    updateBoatsTable();

    // Handle following
    if (followBoatId && boats.has(followBoatId)) {
      followBoat(followBoatId);
    } else if (boats.size > 0 && !followBoatId) {
      fitMapToBounds();
    }
  }

  // WebSocket handling
  function connectWebSocket() {
    if (!currentRaceId) {
      showStatus('Please select a race first', 'error');
      return;
    }

    try {
      showStatus('Connecting to live updates...', 'info');

      websocket = window.FinnAPI.createLiveWebSocket(currentRaceId);

      websocket.onopen = () => {
        console.log('WebSocket connected');
        isConnected = true;
        showStatus('Connected to live updates', 'success');
        updateConnectionUI();
        stopPolling(); // Stop polling when WebSocket is active
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket data:', data);
          processBoatData(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error, event.data);
          showStatus('Error parsing live data', 'error');
        }
      };

      websocket.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        isConnected = false;
        updateConnectionUI();

        if (event.code !== 1000) {
          showStatus('Live connection lost, switching to polling', 'warning');
          startPolling(); // Fall back to polling
        } else {
          showStatus('Disconnected from live updates', 'info');
        }
        websocket = null;
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        showStatus('WebSocket connection failed, using polling', 'warning');
        isConnected = false;
        updateConnectionUI();
        startPolling(); // Fall back to polling
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      showStatus('WebSocket not available, using polling', 'warning');
      startPolling(); // Fall back to polling
    }
  }

  function disconnectWebSocket() {
    if (websocket) {
      websocket.close(1000, 'User disconnected');
      websocket = null;
    }
    stopPolling();
    isConnected = false;
    updateConnectionUI();
    showStatus('Disconnected', 'info');
  }

  // Polling fallback
  async function pollForData() {
    if (!currentRaceId) return;

    try {
      const fleetData = await window.FinnAPI.getFleet(currentRaceId);
      console.log('Poll data:', fleetData);

      // Convert fleet object to boat array format
      const boatArray = Object.entries(fleetData.fleet || {}).map(([boatId, boatData]) => ({
        ...boatData,
        boatId,
        source: 'polling'
      }));

      processBoatData(boatArray);

      if (!isConnected) {
        showStatus(`Polling: ${boatArray.length} boats`, 'info');
      }

    } catch (error) {
      console.error('Polling error:', error);
      if (!isConnected) {
        showStatus(`Polling failed: ${error.message}`, 'error');
      }
    }
  }

  function startPolling() {
    stopPolling();
    console.log('Starting polling mode');
    pollForData(); // Initial poll
    pollTimer = setInterval(pollForData, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      console.log('Stopped polling');
    }
  }

  // UI state management
  function updateConnectionUI() {
    if (connectBtn) connectBtn.disabled = isConnected;
    if (disconnectBtn) disconnectBtn.disabled = !isConnected;
  }

  // Event handlers
  function onRaceChange() {
    const newRaceId = raceSelect?.value;
    if (newRaceId !== currentRaceId) {
      disconnectWebSocket(); // Clean disconnect
      currentRaceId = newRaceId;
      boats.clear();
      clearMapMarkers();
      updateBoatsTable();
      populateBoatSelect();

      if (currentRaceId) {
        // Auto-connect to new race
        setTimeout(connectWebSocket, 100);
      }
    }
  }

  function onFollowChange() {
    const selectedBoatId = followSelect?.value || null;
    followBoat(selectedBoatId);
  }

  // Initialize
  async function initialize() {
    console.log('Initializing live tracking...');

    // Initialize map
    initializeMap();

    // Load races
    try {
      showStatus('Loading races...', 'info');
      const races = await window.FinnAPI.getRaces();
      console.log('Loaded races:', races);

      populateRaceSelect(races);

      if (races.length > 0) {
        showStatus('Races loaded successfully', 'success');

        // Check URL for race parameter
        const urlParams = new URLSearchParams(window.location.search);
        const urlRaceId = urlParams.get('raceId');

        if (urlRaceId && raceSelect) {
          // Select the race from URL if available
          const option = Array.from(raceSelect.options).find(opt => opt.value === urlRaceId);
          if (option) {
            raceSelect.value = urlRaceId;
            currentRaceId = urlRaceId;
          }
        }

        // Auto-connect if we have a race selected
        if (currentRaceId) {
          setTimeout(connectWebSocket, 500);
        }
      } else {
        showStatus('No races found', 'warning');
      }
    } catch (error) {
      console.error('Failed to load races:', error);
      showStatus(`Failed to load races: ${error.message}`, 'error');
    }

    // Update UI state
    updateConnectionUI();
  }

  // Public API for global access
  window.LiveTracking = {
    selectBoat: (boatId) => {
      if (followSelect) {
        followSelect.value = boatId;
      }
      followBoat(boatId);
    },

    connect: connectWebSocket,
    disconnect: disconnectWebSocket,

    // For debugging
    getBoats: () => Array.from(boats.values()),
    getState: () => ({
      currentRaceId,
      isConnected,
      followBoatId,
      boatCount: boats.size,
      apiBase: window.FinnAPI.getApiBase()
    })
  };

  // Wire up events
  document.addEventListener('DOMContentLoaded', () => {
    // Race selection
    if (raceSelect) {
      raceSelect.addEventListener('change', onRaceChange);
    }

    // Follow selection
    if (followSelect) {
      followSelect.addEventListener('change', onFollowChange);
    }

    // Connect/disconnect buttons
    if (connectBtn) {
      connectBtn.addEventListener('click', connectWebSocket);
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', disconnectWebSocket);
    }

    // Initialize
    initialize();
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    disconnectWebSocket();
  });

})();