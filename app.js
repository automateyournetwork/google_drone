async function init() {
    console.log("Initializing Drone Flight...");
    
    // Define libraries in outer scope of init
    let Map3DElement, DirectionsService, Polyline3DElement, Marker3DElement, Place;

    // --- Debug Logger ---
    const debugConsole = document.getElementById('debug-console');
    function logToScreen(msg, type='INFO') {
        if (!debugConsole) return;
        debugConsole.style.display = 'block';
        const line = document.createElement('div');
        line.style.color = type === 'ERR' ? 'red' : (type === 'WARN' ? 'orange' : 'lime');
        line.textContent = `[${type}] ${msg}`;
        debugConsole.prepend(line);
        console.log(`[${type}] ${msg}`);
    }

    try {
        const maps3dLib = await google.maps.importLibrary('maps3d');
        Map3DElement = maps3dLib.Map3DElement;
        Polyline3DElement = maps3dLib.Polyline3DElement;
        Marker3DElement = maps3dLib.Marker3DElement;
        console.log("Maps 3D Library Loaded");
    } catch (e) {
        console.error("CRITICAL: Failed to load Maps 3D Library", e);
        return; 
    }

    try {
        const routesLib = await google.maps.importLibrary('routes');
        DirectionsService = routesLib.DirectionsService;
        console.log("Routes Library Loaded");
    } catch (e) { console.warn("Routes Lib Missing", e); }

    try {
        const placesLib = await google.maps.importLibrary('places');
        Place = placesLib.Place;
        console.log("Places Library Loaded");
    } catch (e) { console.warn("Places Lib Missing", e); }

    const map = document.querySelector('gmp-map-3d');
    const droneSprite = document.getElementById('drone-sprite');

    // UI Elements
    const elAlt = document.getElementById('val-alt');
    const elHdg = document.getElementById('val-hdg');
    const elLat = document.getElementById('val-lat');
    const elLng = document.getElementById('val-lng');
    const elSpd = document.getElementById('val-spd');
    const elMode = document.getElementById('flight-mode');
    const elSpeedFill = document.getElementById('speed-fill');
    
    // Auto-Pilot Elements
    const startInput = document.getElementById('start-input');
    const destInput = document.getElementById('dest-input');
    const btnFly = document.getElementById('btn-fly');

    // Places Search Elements
    const placeSearchInput = document.getElementById('place-search-input');
    const btnSearchPlaces = document.getElementById('btn-search-places');
    const placesList = document.getElementById('places-list');
    const btnTogglePlaces = document.getElementById('btn-toggle-places');
    const placesPanel = document.getElementById('places-panel');

    // Route Visualization Line
    let routeLine = null;
    let placeMarkers = [];

    // Map Setup
    if (map) {
        map.defaultLabelsDisabled = true;
    } else {
        console.error("Map element not found!");
    }

    // --- Physics State ---
    const physics = {
        lat: 37.7749,
        lng: -122.4194,
        altitude: 500,
        heading: 0,
        tilt: 90, 
        speed: 0,
        targetSpeed: 0,
        targetAltitude: 500,
        rotationVelocity: 0,
        tiltVelocity: 0
    };

    // --- Flight Configuration ---
    const CONFIG = {
        minAltitude: 20, 
        maxAltitude: 5000000, // Space! (5000km)
        maxTilt: 105, 
        minTilt: 0,
        turnSpeed: 2.5,
        lookSpeed: 1.8,
        acceleration: 0.00001,
        maxSpeed: 0.00025,
        friction: 0.90,
        altitudeLerp: 0.12, 
        mouseSensitivity: 0.15
    };

    // --- State Management ---
    let state = {
        isAutoPilot: false,
        path: [], 
        pathIndex: 0
    };

    // --- Input Handling ---
    const keys = {};
    window.addEventListener('keydown', (e) => keys[e.code] = true);
    window.addEventListener('keyup', (e) => keys[e.code] = false);

    // Prevent spacebar scrolling
    window.addEventListener('keydown', (e) => {
        if(e.code === 'Space' && e.target === document.body) e.preventDefault();
    });

    // Scroll Wheel = Altitude (Zoom)
    window.addEventListener('wheel', (e) => {
        // Break the "Space Lock" if we start scrolling manually
        // Sync target first to ensure smooth transition from current altitude
        if (Math.abs(physics.targetAltitude - physics.altitude) > 500) {
            physics.targetAltitude = physics.altitude;
        }

        // Exponential Zoom Factor: The higher you are, the faster you zoom
        const zoomFactor = Math.max(10, physics.altitude * 0.1); 
        const sensitivity = 0.5;

        // Invert deltaY so Scroll Up (negative) decreases altitude (Zooms In)
        const delta = -e.deltaY * sensitivity; 
        
        // Apply with scaling
        if (delta > 0) {
            // Ascending
            physics.targetAltitude += zoomFactor;
        } else {
            // Descending
            physics.targetAltitude -= zoomFactor;
        }
        
        physics.targetAltitude = Math.max(CONFIG.minAltitude, Math.min(CONFIG.maxAltitude, physics.targetAltitude));
    });

    // --- Places Search Logic ---
    
    // Toggle Panel
    btnTogglePlaces.addEventListener('click', () => {
        if (placesPanel.style.height === '40px') {
            placesPanel.style.height = ''; // Restore
            placesPanel.querySelector('.panel-body').style.display = 'flex';
            btnTogglePlaces.textContent = '_';
        } else {
            placesPanel.style.height = '40px';
            placesPanel.querySelector('.panel-body').style.display = 'none';
            btnTogglePlaces.textContent = '□';
        }
    });

    async function performSearch() {
        const query = placeSearchInput.value;
        logToScreen(`Searching: ${query}`);

        if (!query) return;
        if (!Place) {
            logToScreen("Places Library NOT Loaded!", "ERR");
            btnSearchPlaces.textContent = "LIB ERR";
            return;
        }

        btnSearchPlaces.textContent = "SCANNING...";
        
        // clear old markers
        placeMarkers.forEach(m => m.remove());
        placeMarkers = [];
        placesList.innerHTML = '';

        try {
            // Bias search to drone location
            const request = {
                textQuery: query,
                fields: ['displayName', 'location', 'formattedAddress'],
                locationBias: { lat: physics.lat, lng: physics.lng },
                maxResultCount: 10
            };
            
            const { places } = await Place.searchByText(request);

            logToScreen(`Found ${places ? places.length : 0} results.`);
            btnSearchPlaces.textContent = "SCAN";

            if (!places || places.length === 0) {
                placesList.innerHTML = '<div style="color:red; padding:10px;">No Results</div>';
                return;
            }

            places.forEach(place => {
                // 1. Add to List
                const item = document.createElement('div');
                item.className = 'place-item';
                item.innerHTML = `
                    <div class="place-name">${place.displayName}</div>
                    <div class="place-addr">${place.formattedAddress}</div>
                `;
                item.addEventListener('click', () => {
                    logToScreen(`Targeting: ${place.displayName}`);
                    flyToLocation(place.location);
                });
                placesList.appendChild(item);

                // 2. Add 3D Marker
                if (Marker3DElement) {
                    const marker = new Marker3DElement({
                        position: { lat: place.location.lat(), lng: place.location.lng(), altitude: 50 }, 
                        altitudeMode: 'RELATIVE_TO_GROUND',
                        label: place.displayName
                    });
                    map.append(marker);
                    placeMarkers.push(marker);
                    
                    // Marker Click
                    marker.addEventListener('gmp-click', () => {
                        logToScreen(`Targeting: ${place.displayName}`);
                        flyToLocation(place.location);
                    });
                }
            });

        } catch (e) {
            console.error(e);
            logToScreen(`Error: ${e.message}`, "ERR");
            btnSearchPlaces.textContent = "ERR";
        }
    }

    btnSearchPlaces.addEventListener('click', performSearch);
    
    // Helper to fly to a specific coordinate
    function flyToLocation(locationObj) {
        const targetLat = locationObj.lat();
        const targetLng = locationObj.lng();
        
        state.path = [{ lat: targetLat, lng: targetLng }];
        state.pathIndex = 0;
        state.isAutoPilot = true;
        
        // Visual line to target
        if (Polyline3DElement) {
            if (routeLine) routeLine.remove();
            routeLine = new Polyline3DElement({
                coordinates: [
                    { lat: physics.lat, lng: physics.lng, altitude: physics.altitude },
                    { lat: targetLat, lng: targetLng, altitude: 200 }
                ],
                strokeColor: "rgba(255, 0, 0, 0.8)", 
                strokeWidth: 5,
                altitudeMode: 'RELATIVE_TO_GROUND'
            });
            map.append(routeLine);
        }
        
        btnFly.textContent = "FLYING TO TARGET";
    }


    // --- Auto-Pilot Logic ---
    let directionsService;
    if (DirectionsService) {
         directionsService = new DirectionsService();
    }

    btnFly.addEventListener('click', async () => {
        // Toggle Off
        if (state.isAutoPilot) {
            state.isAutoPilot = false;
            btnFly.textContent = "GET DIRECTIONS";
            return;
        }

        if (!directionsService) {
            btnFly.textContent = "N/A (NO API)";
            return;
        }
        
        const destination = destInput.value;
        if (!destination) return;

        // Determine Start
        let origin = { lat: physics.lat, lng: physics.lng };
        const startVal = startInput.value;
        const requestOrigin = startVal ? startVal : origin;

        btnFly.textContent = "CALCULATING...";
        
        directionsService.route({
            origin: requestOrigin,
            destination: destination,
            travelMode: 'DRIVING'
        }, async (result, status) => {
            if (status === 'OK') {
                const route = result.routes[0];
                
                if (startVal) {
                    const startLoc = route.legs[0].start_location;
                    physics.lat = startLoc.lat();
                    physics.lng = startLoc.lng();
                    map.center = { lat: physics.lat, lng: physics.lng, altitude: 500 };
                }

                state.path = route.overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));
                state.pathIndex = 0;
                state.isAutoPilot = true;
                
                try {
                    if (routeLine) routeLine.remove();
                    if (Polyline3DElement) {
                        routeLine = new Polyline3DElement({
                            coordinates: state.path,
                            strokeColor: "rgba(0, 242, 255, 0.8)",
                            strokeWidth: 5,
                            altitudeMode: 'RELATIVE_TO_GROUND'
                        });
                        map.append(routeLine);
                    }
                } catch(e) { console.warn("Line draw failed", e); }

                btnFly.textContent = "STOP AUTO-PILOT";

            } else {
                btnFly.textContent = `ERR: ${status}`;
                logToScreen(`Dir Err: ${status}`, "ERR");
            }
        });
    });


    // --- Main Loop (60 FPS) ---
    function updateFlight() {
        
        // --- 1. HANDLE USER INPUTS (ALWAYS ACTIVE) ---
        
        // Rotation (Arrows) - User can ALWAYS look around
        if (keys['ArrowLeft']) physics.heading -= CONFIG.turnSpeed;
        if (keys['ArrowRight']) physics.heading += CONFIG.turnSpeed;

        // Tilt (Arrows) - User can ALWAYS tilt
        if (keys['ArrowUp']) physics.tilt = Math.min(CONFIG.maxTilt, physics.tilt + CONFIG.lookSpeed);
        if (keys['ArrowDown']) physics.tilt = Math.max(CONFIG.minTilt, physics.tilt - CONFIG.lookSpeed);
        
        // 4. Altitude (W/S) - User can ALWAYS change altitude (Exponential Zoom)
        if (keys['KeyW']) {
            physics.targetAltitude += 2 + (physics.targetAltitude * 0.02);
        }
        if (keys['KeyS']) {
            physics.targetAltitude -= 2 + (physics.targetAltitude * 0.02);
        }
        
        // Instant Altitude Hotkeys
        if (keys['KeyZ']) physics.targetAltitude = CONFIG.maxAltitude; // Orbit
        if (keys['KeyX']) physics.targetAltitude = CONFIG.minAltitude; // Ground
        
        // Apply Altitude Physics
        physics.targetAltitude = Math.max(CONFIG.minAltitude, Math.min(CONFIG.maxAltitude, physics.targetAltitude));
        physics.altitude += (physics.targetAltitude - physics.altitude) * CONFIG.altitudeLerp;


        // --- 2. CALCULATE MOVEMENT ---

        if (state.isAutoPilot) {
            // --- AUTO-PILOT FLIGHT ---
            
            if (state.path.length > 0 && state.pathIndex < state.path.length) {
                const target = state.path[state.pathIndex];
                
                const dLat = target.lat - physics.lat;
                const dLng = target.lng - physics.lng;
                const dist = Math.sqrt(dLat*dLat + dLng*dLng);
                
                // Base Auto-Speed
                let autoSpeed = CONFIG.maxSpeed * 3.0;
                
                // Allow User Boost (Shift)
                if (keys['ShiftLeft']) autoSpeed *= 2.0;

                if (dist < autoSpeed) {
                    state.pathIndex++;
                } else {
                    physics.lat += dLat * (autoSpeed / dist);
                    physics.lng += dLng * (autoSpeed / dist);
                    
                    if (!keys['ArrowLeft'] && !keys['ArrowRight']) {
                        const targetHeading = Math.atan2(dLng, dLat) * (180 / Math.PI);
                        let diff = targetHeading - physics.heading;
                        while (diff > 180) diff -= 360;
                        while (diff < -180) diff += 360;
                        physics.heading += diff * 0.02; 
                    }
                }
            } else {
                state.isAutoPilot = false;
                btnFly.textContent = "ARRIVED";
            }
            
            // Mode Indicator
            elMode.textContent = "MODE: AUTO-PILOT";
            elMode.style.background = "#00ff4c";
            elMode.style.color = "#000";

        } else {
        // --- MANUAL FLIGHT PHYSICS (v3.0 Ace Pilot) ---

        // 1. Thrust (Space = Fwd, Ctrl = Brake/Rev)
        let desiredSpeed = 0;
        if (keys['Space']) {
            desiredSpeed = keys['ShiftLeft'] || keys['ShiftRight'] ? CONFIG.maxSpeed * 4.0 : CONFIG.maxSpeed;
        } else if (keys['ControlLeft'] || keys['ControlRight']) {
            desiredSpeed = -CONFIG.maxSpeed * 0.5; // Reverse
        }
        
        // Smooth Acceleration
        physics.speed = physics.speed + (desiredSpeed - physics.speed) * 0.15;

        // 2. Yaw (A/D) - Turn Left/Right
        if (keys['KeyA']) physics.heading -= CONFIG.turnSpeed;
        if (keys['KeyD']) physics.heading += CONFIG.turnSpeed;

        // 3. Pitch (W/S) - Nose Down / Nose Up
        // W = Nose Down (Tilt closer to 0/Ground)
        // S = Nose Up (Tilt closer to 90/Horizon or 105/Sky)
        // Note: Google Maps Tilt: 0 = Down, 90 = Horizon.
        // So W should DECREASE tilt, S should INCREASE tilt.
        if (keys['KeyW']) physics.tilt = Math.max(CONFIG.minTilt, physics.tilt - CONFIG.lookSpeed);
        if (keys['KeyS']) physics.tilt = Math.min(CONFIG.maxTilt, physics.tilt + CONFIG.lookSpeed);
        
        // 4. Altitude (Z/X Hotkeys)
        if (keys['KeyZ']) physics.targetAltitude = CONFIG.maxAltitude; // Orbit
        if (keys['KeyX']) physics.targetAltitude = CONFIG.minAltitude; // Ground
        
        // Emergency Level (R)
        if (keys['KeyR']) {
            physics.tilt += (90 - physics.tilt) * 0.1;
        }

        // Apply Altitude Physics (Lerp)
        physics.altitude += (physics.targetAltitude - physics.altitude) * CONFIG.altitudeLerp;

        // 5. Move Position
        if (Math.abs(physics.speed) > 0.00000001) {
            const rads = physics.heading * (Math.PI / 180);
            const dLat = Math.cos(rads) * physics.speed;
            // Longitude scaling
            const latScale = Math.cos(physics.lat * (Math.PI / 180));
            const dLng = (Math.sin(rads) * physics.speed) / latScale;

            physics.lat += dLat;
            physics.lng += dLng;
        }
        
        elMode.textContent = "MODE: MANUAL";
        elMode.style.background = "#ff3c00";
        elMode.style.color = "#fff";
        }

        // --- Render to Map ---
        map.center = { lat: physics.lat, lng: physics.lng, altitude: physics.altitude };
        map.heading = physics.heading;
        map.tilt = physics.tilt;

        // --- Render HUD ---
        elAlt.textContent = Math.round(physics.altitude);
        elHdg.textContent = Math.round(((physics.heading % 360) + 360) % 360);
        elLat.textContent = physics.lat.toFixed(6);
        elLng.textContent = physics.lng.toFixed(6);
        
        // Speed Display (Auto or Manual)
        const currentSpeed = state.isAutoPilot ? (CONFIG.maxSpeed * 3.0) : physics.speed;
        const spdPct = (Math.abs(currentSpeed) / CONFIG.maxSpeed) * 30; // Approx scale
        elSpd.textContent = Math.round(Math.abs(currentSpeed) * 1000000);
        elSpeedFill.style.width = `${Math.min(100, spdPct)}%`;

        // --- Drone Sprite FX ---
        let visualRoll = 0;
        let visualPitch = 0;
        
        // Roll based on turning intensity
        if (keys['KeyA']) visualRoll = -25;
        if (keys['KeyD']) visualRoll = 25;
        
        // Pitch based on speed
        if (state.isAutoPilot) {
             visualPitch = 10; 
        } else {
             visualPitch = (physics.speed / CONFIG.maxSpeed) * -15; 
        }
        
        droneSprite.style.transform = `rotate(${visualRoll}deg) translateY(${visualPitch}px)`;

        requestAnimationFrame(updateFlight);
    }

    updateFlight();
}

init();