// ---- File: map.js ----

console.log("Map JS loaded");

// --- Mapbox Token Check (Good Practice) ---
// Check if MAPBOX_ACCESS_TOKEN is defined
if (typeof MAPBOX_ACCESS_TOKEN === 'undefined') {
    console.error("Mapbox Access Token is undefined!");
    alert("Error: Mapbox Access Token is undefined. Map functionality will be limited.");
    // Set a default empty token to prevent errors
    window.MAPBOX_ACCESS_TOKEN = '';
} else if (!MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN === "YOUR_MAPBOX_ACCESS_TOKEN") {
    console.error("Mapbox Access Token is not set or is a placeholder!");
    alert("Error: Mapbox Access Token is missing or invalid. Map functionality will be limited.");
}
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN || '';


// --- Global State ---
let currentAoiGeoJson = null; // Store the *processed* AOI (after 'Finish Drawing')
let segmentedGeoJson = null;
let draw = null; // Initialize draw to null
let isAoiClosed = false; // Track if the *processed* AOI is closed
let featureExistsOnMap = false; // Track if a feature is present in the Draw tool

// --- DOM Elements ---
const finishBtn = document.getElementById('finish-drawing-btn');
const closeLoopBtn = document.getElementById('close-loop-btn');
const segmentBtn = document.getElementById('segment-aoi-btn');
const restartBtn = document.getElementById('restart-drawing-btn');

const gridAreaInput = document.getElementById('grid-area');
const bufferKmInput = document.getElementById('buffer-km');

const statsDiv = document.getElementById('stats');
const messagesDiv = document.getElementById('messages');
const downloadLinkDiv = document.getElementById('download-link');

const showOriginalChk = document.getElementById('show-original-chk');
const showSegmentedChk = document.getElementById('show-segmented-chk');

// UI Step Containers
const stepDrawDiv = document.getElementById('step-draw');
const stepFinishDiv = document.getElementById('step-finish');
const stepSegmentDiv = document.getElementById('step-segment');

// --- Map Layer IDs ---
const ORIGINAL_AOI_LAYER_ID = 'original-aoi-layer';
const ORIGINAL_AOI_SOURCE_ID = 'original-aoi-source';
const SEGMENTED_GRID_LAYER_ID = 'segmented-grid-layer';
const SEGMENTED_GRID_SOURCE_ID = 'segmented-grid-source';

// --- Helper Functions ---

function displayMessage(text, type = 'info') { // type: 'info', 'success', 'error'
    // Sanitize potentially long/HTML error messages slightly
    const safeText = text.length > 500 ? text.substring(0, 500) + '...' : text;
    messagesDiv.innerHTML = `<p class="${type}">${safeText}</p>`;
    if (type === 'error') console.error("Message Displayed (Error):", text); // Log original long error
    else console.log("Message Displayed:", text);
}

function displayStats(stats) {
    // Use dl/dt/dd structure
    const statsDl = document.createElement('dl');

    const dtPoints = document.createElement('dt');
    dtPoints.textContent = 'Points:';
    const ddPoints = document.createElement('dd');
    ddPoints.textContent = stats.num_points;
    statsDl.appendChild(dtPoints);
    statsDl.appendChild(ddPoints);

    const dtArea = document.createElement('dt');
    dtArea.textContent = 'Area:';
    const ddArea = document.createElement('dd');
    // Add note if area is 0 because it's open or too few points
    if (stats.area_sqkm > 0) {
         ddArea.textContent = `${stats.area_sqkm} km²`;
    } else if (stats.is_closed && stats.num_points < 4) {
         ddArea.textContent = `0 km² (Requires >= 4 points)`;
    } else if (!stats.is_closed) {
         ddArea.textContent = `0 km² (Open loop)`;
    } else {
         ddArea.textContent = `0 km²`; // Default fallback
    }
    statsDl.appendChild(dtArea);
    statsDl.appendChild(ddArea);

    const dtClosed = document.createElement('dt');
    dtClosed.textContent = 'Closed Loop:';
    const ddClosed = document.createElement('dd');
    ddClosed.textContent = stats.is_closed ? 'Yes' : 'No';
    statsDl.appendChild(dtClosed);
    statsDl.appendChild(ddClosed);

    // Replace the entire content of statsDiv
    statsDiv.innerHTML = ''; // Clear previous content
    statsDiv.appendChild(statsDl);

    // Fly to centroid logic remains the same
    if (stats.centroid && stats.centroid.lon !== null && stats.centroid.lat !== null && map) {
         map.flyTo({ center: [stats.centroid.lon, stats.centroid.lat], zoom: 10 });
    }
}

function clearMapLayersAndData() {
    console.log("Clearing map layers and resetting data...");
    if (map) {
        if (map.getLayer(ORIGINAL_AOI_LAYER_ID)) map.removeLayer(ORIGINAL_AOI_LAYER_ID);
        if (map.getSource(ORIGINAL_AOI_SOURCE_ID)) map.removeSource(ORIGINAL_AOI_SOURCE_ID);
        if (map.getLayer(SEGMENTED_GRID_LAYER_ID)) map.removeLayer(SEGMENTED_GRID_LAYER_ID);
        if (map.getSource(SEGMENTED_GRID_SOURCE_ID)) map.removeSource(SEGMENTED_GRID_SOURCE_ID);
    } else {
        console.warn("clearMapLayersAndData called before map was initialized.");
    }

    currentAoiGeoJson = null;
    segmentedGeoJson = null;
    isAoiClosed = false;
    featureExistsOnMap = false;

    downloadLinkDiv.innerHTML = '';
    statsDiv.innerHTML = '<pre>Not calculated yet.</pre>';
    showOriginalChk.checked = true;
    showSegmentedChk.checked = true;
    gridAreaInput.value = 20;
    bufferKmInput.value = 0;

    if (draw) {
        try {
            console.log("Calling draw.deleteAll()");
            draw.deleteAll();
        } catch (err) {
             console.error("Error calling draw.deleteAll():", err);
        }
    } else {
        console.warn("clearMapLayersAndData called before draw was initialized.");
    }
    console.log("Clearing complete.");
}

function addOrUpdateGeoJsonLayer(sourceId, layerId, geoJsonData, paintOptions, layerType = 'line', isVisible = true) {
    if (!map || !geoJsonData) {
         console.warn(`addOrUpdateGeoJsonLayer (${sourceId}/${layerId}): Map not ready or no GeoJSON data.`);
        return;
    }
     if (!map.isStyleLoaded()) {
         console.warn(`addOrUpdateGeoJsonLayer (${sourceId}/${layerId}): Style not loaded yet. Aborting.`);
         // Consider adding a retry mechanism if this happens frequently
         return;
     }

    try {
        const source = map.getSource(sourceId);
        if (source) {
            source.setData(geoJsonData);
            // console.log(`Updated data for source: ${sourceId}`);
        } else {
            map.addSource(sourceId, {
                'type': 'geojson',
                'data': geoJsonData
            });
            // console.log(`Added source: ${sourceId}`);
        }

        if (!map.getLayer(layerId)) {
            map.addLayer({
                'id': layerId,
                'type': layerType,
                'source': sourceId,
                'layout': {
                    'visibility': isVisible ? 'visible' : 'none'
                },
                'paint': paintOptions
            });
            // console.log(`Added layer: ${layerId}`);
        } else {
            map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
            // console.log(`Set visibility for layer ${layerId} to ${isVisible ? 'visible' : 'none'}`);
            // Update paint properties if needed (optional, depends on use case)
            // Object.keys(paintOptions).forEach(key => {
            //     map.setPaintProperty(layerId, key, paintOptions[key]);
            // });
        }
    } catch (error) {
        console.error(`Error in addOrUpdateGeoJsonLayer (${sourceId}/${layerId}):`, error);
         if (error.message && error.message.includes("Style is not done loading")) {
             console.warn("Attempted to add layer/source before style loaded. Check map.isStyleLoaded().");
         }
         displayMessage(`Map error adding layer ${layerId}. Check console.`, 'error');
    }
}


// --- UI State Management ---
function updateUIState(state) {
    console.log("Updating UI State to:", state);
    stepDrawDiv.style.display = 'none';
    stepFinishDiv.style.display = 'none';
    stepSegmentDiv.style.display = 'none';

    finishBtn.disabled = true;
    closeLoopBtn.disabled = true;
    segmentBtn.disabled = true;
    restartBtn.disabled = true;

    if (featureExistsOnMap || currentAoiGeoJson) {
        restartBtn.disabled = false;
    }

    switch (state) {
        case 'initial':
            stepDrawDiv.style.display = 'block';
            // displayMessage("Click the Line tool (top-right) to draw your AoI.", 'info'); // Moved message to HTML
            clearMapLayersAndData(); // Clear everything on restart/initial load
            // The MapboxDraw control should be set to 'draw_line_string' by default in its constructor
            break;

        case 'draw_complete':
            stepDrawDiv.style.display = 'block';
            finishBtn.disabled = false;
            restartBtn.disabled = false;
            displayMessage("Drawing exists on map. Click 'Finish Drawing & Calculate Stats' below or edit the drawing.", 'info');
            break;

        case 'finished_open':
            stepFinishDiv.style.display = 'block';
            closeLoopBtn.style.display = 'block';
            // Enable close loop only if > 2 points exist
            closeLoopBtn.disabled = !(currentAoiGeoJson && currentAoiGeoJson.features[0].geometry.coordinates.length >= 3);
            restartBtn.disabled = false;
            displayMessage("AoI processed (Open Loop). Close the loop or restart.", 'info');
            break;

        case 'finished_closed':
            stepFinishDiv.style.display = 'block';
            closeLoopBtn.style.display = 'none';
            stepSegmentDiv.style.display = 'block';
            segmentBtn.disabled = false;
            restartBtn.disabled = false;
            if (currentAoiGeoJson && currentAoiGeoJson.features[0].geometry.coordinates.length < 4) {
                 displayMessage("AoI processed (Closed Loop), but needs >= 4 points (first=last) for valid area/segmentation. Restart if needed.", 'error');
                 segmentBtn.disabled = true;
            } else {
                 displayMessage("AoI processed (Closed Loop). Configure and run segmentation, or restart.", 'success');
            }
            break;

         case 'processing':
            if (stepDrawDiv.style.display === 'block') { // If finish was clicked
                stepDrawDiv.style.display = 'block';
                finishBtn.disabled = true;
            } else { // If close loop was clicked
                 stepFinishDiv.style.display = 'block';
                 closeLoopBtn.disabled = true;
            }
             restartBtn.disabled = true;
            displayMessage("Processing AoI...", 'info');
            break;

        case 'segmenting':
             stepFinishDiv.style.display = 'block';
             stepSegmentDiv.style.display = 'block';
             segmentBtn.disabled = true;
             restartBtn.disabled = true;
             displayMessage("Segmenting AoI...", 'info');
             break;

        case 'segmented':
            stepFinishDiv.style.display = 'block';
            stepSegmentDiv.style.display = 'block';
            segmentBtn.disabled = false;
            restartBtn.disabled = false;
            // Message is set by the segment function
            break;

        default:
            console.error("Unknown UI State:", state);
             // Fallback to initial state
             updateUIState('initial');
    }
}


// ******** START: MAP INITIALIZATION ********
let map;

try {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12', // *** CHANGED: Standard streets style ***
        center: [-74.5, 40],
        zoom: 9
    });

    // ******** MAP EVENT LISTENERS ********

    map.on('load', () => {
        console.log("Map 'load' event fired.");

        // Initialize Draw control *after* map loads
        try {
            console.log("Initializing MapboxDraw...");
            draw = new MapboxDraw({
                displayControlsDefault: false,
                controls: {
                    line_string: true, // Only show line string tool
                    trash: true       // Show trash tool
                },
                defaultMode: 'draw_line_string', // Start in drawing mode
            });
            console.log("MapboxDraw object created:", draw);

            console.log("Adding Draw control to map...");
            map.addControl(draw, 'top-right'); // Explicitly place controls
            console.log("Draw control added.");

            console.log("Adding Navigation control to map...");
            map.addControl(new mapboxgl.NavigationControl(), 'top-right');
            console.log("Navigation control added.");

        } catch (err) {
            console.error("Error initializing or adding Mapbox Draw/Nav controls:", err);
            displayMessage("Error setting up map drawing tools. Check console.", "error");
            // If draw failed, the app won't work, so maybe halt or show critical error
            return; // Stop further execution in load handler if controls fail
        }


        // --- Draw Event Listeners ---
        map.on('draw.create', (e) => {
            console.log("draw.create event:", e);
            if (e.features.length > 0) {
                featureExistsOnMap = true;
                currentAoiGeoJson = null;
                segmentedGeoJson = null;
                isAoiClosed = false;
                if (map.getLayer(ORIGINAL_AOI_LAYER_ID)) map.removeLayer(ORIGINAL_AOI_LAYER_ID);
                if (map.getSource(ORIGINAL_AOI_SOURCE_ID)) map.removeSource(ORIGINAL_AOI_SOURCE_ID);
                if (map.getLayer(SEGMENTED_GRID_LAYER_ID)) map.removeLayer(SEGMENTED_GRID_LAYER_ID);
                if (map.getSource(SEGMENTED_GRID_SOURCE_ID)) map.removeSource(SEGMENTED_GRID_SOURCE_ID);
                downloadLinkDiv.innerHTML = '';
                statsDiv.innerHTML = '<pre>Not calculated yet.</pre>';
                updateUIState('draw_complete');
            } else {
                 featureExistsOnMap = false;
                 updateUIState('initial');
            }
        });

        map.on('draw.delete', () => {
            console.log("draw.delete event");
            featureExistsOnMap = false;
            currentAoiGeoJson = null;
            segmentedGeoJson = null;
            isAoiClosed = false;
            if (map.getLayer(ORIGINAL_AOI_LAYER_ID)) map.removeLayer(ORIGINAL_AOI_LAYER_ID);
            if (map.getSource(ORIGINAL_AOI_SOURCE_ID)) map.removeSource(ORIGINAL_AOI_SOURCE_ID);
            if (map.getLayer(SEGMENTED_GRID_LAYER_ID)) map.removeLayer(SEGMENTED_GRID_LAYER_ID);
            if (map.getSource(SEGMENTED_GRID_SOURCE_ID)) map.removeSource(SEGMENTED_GRID_SOURCE_ID);
            downloadLinkDiv.innerHTML = '';
            statsDiv.innerHTML = '<pre>Not calculated yet.</pre>';
            updateUIState('initial');
            displayMessage("Drawing deleted. Draw a new AoI.", 'info');
        });

        map.on('draw.update', (e) => {
            console.log("draw.update event:", e);
            if (e.features.length > 0 && (e.action === 'change_coordinates' || e.action === 'move')) {
                featureExistsOnMap = true;
                currentAoiGeoJson = null; // Invalidate previous results
                isAoiClosed = false;
                segmentedGeoJson = null;

                if (map.getLayer(ORIGINAL_AOI_LAYER_ID)) map.removeLayer(ORIGINAL_AOI_LAYER_ID);
                if (map.getSource(ORIGINAL_AOI_SOURCE_ID)) map.removeSource(ORIGINAL_AOI_SOURCE_ID);
                if (map.getLayer(SEGMENTED_GRID_LAYER_ID)) map.removeLayer(SEGMENTED_GRID_LAYER_ID);
                if (map.getSource(SEGMENTED_GRID_SOURCE_ID)) map.removeSource(SEGMENTED_GRID_SOURCE_ID);
                downloadLinkDiv.innerHTML = '';
                statsDiv.innerHTML = '<pre>Not calculated yet.</pre>';

                console.log("Drawing updated. Resetting processed state.");
                updateUIState('draw_complete');
                displayMessage("Drawing updated. Click 'Finish Drawing & Calculate Stats' again.", 'info');
            } else if (e.features.length === 0) {
                featureExistsOnMap = false;
                 // If update results in no features (e.g. deleting all points), draw.delete should handle it
                 // but adding a fallback here:
                 updateUIState('initial');
            }
        });

        map.on('draw.modechange', (e) => {
            console.log("draw.modechange event, mode:", e.mode);
             const data = draw.getAll();
             // Logic based on mode change might be complex, ensure it aligns with create/delete/update events
            if (data.features.length > 0) {
                 featureExistsOnMap = true;
                 // If a feature exists and we are not processing, ensure 'Finish' is possible
                 if (!currentAoiGeoJson && (e.mode === 'simple_select' || e.mode === 'direct_select')) {
                    updateUIState('draw_complete');
                 }
            } else {
                 featureExistsOnMap = false;
                 // If mode changes and there are no features, go back to initial
                 // (This can happen if user clicks trash then clicks line tool again)
                 if (e.mode === 'draw_line_string' && !currentAoiGeoJson) {
                     updateUIState('initial');
                 }
            }
        });

        map.on('draw.selectionchange', (e) => {
            console.log("draw.selectionchange", e);
             // Generally, selection change shouldn't drastically change the state
             // unless combined with other actions handled by create/delete/update.
            if (e.features.length > 0) {
                featureExistsOnMap = true;
                if (!currentAoiGeoJson) {
                     updateUIState('draw_complete'); // Ensure Finish is available if feature selected
                }
            } else {
                 // Feature deselected
                 const data = draw.getAll();
                 if (data.features.length > 0) {
                     featureExistsOnMap = true;
                     if (!currentAoiGeoJson) {
                        // Stay in 'draw_complete' even if deselected, as feature still exists
                        updateUIState('draw_complete');
                     }
                 } else {
                      featureExistsOnMap = false;
                      // If deselection means no features left (e.g. after delete), state is handled by draw.delete
                 }
            }
        });

        // Set initial UI state *after* map and controls are ready
        console.log("Map loaded and Draw controls ready. Setting initial UI state.");
        updateUIState('initial');

    }); // --- End of map.on('load') ---

    map.on('error', (e) => {
        console.error('Mapbox GL Error:', e.error ? e.error.message : e);
        displayMessage(`Map error: ${e.error ? e.error.message : 'Unknown error'}. Check console or reload.`, 'error');
    });

} catch (error) {
    console.error("Failed to initialize Mapbox GL:", error);
    document.getElementById('map').innerHTML = '<p style="padding: 20px; color: red; font-weight: bold;">CRITICAL: Error initializing map. Please check the console and ensure your Mapbox token is valid and reachable.</p>';
    document.querySelector('.controls').style.display = 'none';
}

// ******** END: MAP INITIALIZATION & LOAD EVENT ********


// --- Button Event Listeners ---

finishBtn.addEventListener('click', async () => {
    console.log("Finish Drawing button clicked.");
    if (!draw) {
        displayMessage("Error: Drawing tool not available.", 'error'); return;
    }
    const data = draw.getAll();
    if (!data || data.features.length === 0 || data.features[0].geometry.type !== 'LineString' || data.features[0].geometry.coordinates.length < 2) {
        displayMessage("No valid drawing (LineString >= 2 points) found.", 'error');
        updateUIState('initial'); // Reset state if no valid drawing
        return;
    }

    const featureToProcess = data.features[0];
    const aoiToProcess = { type: "FeatureCollection", features: [JSON.parse(JSON.stringify(featureToProcess))] };

    console.log("Processing AoI:", JSON.stringify(aoiToProcess));
    updateUIState('processing');
    displayMessage("Processing AoI...", 'info'); // Show processing message immediately

    let response; // Define response outside try block
    let responseBody;
    try {
        response = await fetch('/process_aoi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aoiToProcess)
        });
        console.log("Fetch response status:", response.status, response.statusText);

        responseBody = await response.text(); // Get text first, always
        console.log("Raw Response Body:", responseBody); // Log raw response regardless of status

        if (!response.ok) {
             // Server returned an error status (4xx or 5xx)
             let errorMsg = `Server error: ${response.status} ${response.statusText}`;
             try {
                 // Try to parse IF the content type indicates JSON
                 const contentType = response.headers.get('content-type');
                 if (contentType && contentType.includes('application/json')) {
                     const errorData = JSON.parse(responseBody); // Try parsing JSON error
                     if (errorData && errorData.error) {
                        errorMsg = `Server error: ${errorData.error}`; // Use specific error from JSON
                     }
                 } else if (responseBody) {
                     // If not JSON, include a snippet of the body (likely HTML traceback)
                     errorMsg += ` - Response: ${responseBody.substring(0, 150)}...`;
                 }
             } catch (parseError) {
                 console.warn("Could not parse error response body as JSON:", parseError);
                 // Stick with the basic status error message, maybe add snippet
                 if (responseBody) {
                    errorMsg += ` - Raw Response: ${responseBody.substring(0, 150)}...`;
                 }
             }
             throw new Error(errorMsg); // Throw the constructed error message
        }

        // --- If response.ok is true ---
        // Check if responseBody is undefined or empty before parsing
        if (!responseBody) {
            throw new Error("Empty response received from server");
        }
        const stats = JSON.parse(responseBody); // Now parse the expected successful JSON
        console.log("Stats received:", stats);

        currentAoiGeoJson = aoiToProcess;
        isAoiClosed = stats.is_closed;
        displayStats(stats);

        addOrUpdateGeoJsonLayer(
            ORIGINAL_AOI_SOURCE_ID, ORIGINAL_AOI_LAYER_ID,
            currentAoiGeoJson,
            { 'line-color': '#FF0000', 'line-width': 3 }, 'line',
            showOriginalChk.checked
        );

        if (isAoiClosed) {
             if (currentAoiGeoJson.features[0].geometry.coordinates.length < 4) {
                 updateUIState('finished_closed');
            } else {
                 updateUIState('finished_closed');
            }
        } else {
             if (currentAoiGeoJson.features[0].geometry.coordinates.length < 3) {
                 updateUIState('finished_open');
             } else {
                updateUIState('finished_open');
             }
        }

    } catch (error) {
        console.error("Error in finishBtn click handler (fetch/logic):", error);
        // Display the error message thrown from the !response.ok block or network errors
        displayMessage(`Error processing AoI: ${error.message || 'Unknown fetch error'}`, 'error');
        currentAoiGeoJson = null; // Clear potentially invalid data
        isAoiClosed = false;
        // Revert UI state based on whether drawing still exists
        const currentDrawData = draw ? draw.getAll() : { features: [] };
        if (currentDrawData.features.length > 0) {
            updateUIState('draw_complete'); // Allow user to try finishing again
        } else {
            updateUIState('initial'); // Go back to start if drawing was removed
        }
    }
});


closeLoopBtn.addEventListener('click', async () => {
    console.log("Close Loop button clicked.");
    if (!currentAoiGeoJson || currentAoiGeoJson.features.length === 0) {
        displayMessage("Error: No processed AoI data found to close.", 'error'); return;
    }

    let aoiToClose = JSON.parse(JSON.stringify(currentAoiGeoJson));
    let feature = aoiToClose.features[0];
    let coords = feature.geometry.coordinates;

    if (coords.length < 3) {
         displayMessage("Cannot close loop: Need at least 3 points.", 'error'); return;
    }
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
         displayMessage("Loop is already closed.", 'info');
         isAoiClosed = true;
         updateUIState('finished_closed');
         return;
    }

    coords.push([...coords[0]]);
    feature.geometry.coordinates = coords;

    console.log("Attempting to re-process closed loop AoI:", JSON.stringify(aoiToClose));
    updateUIState('processing'); // Show processing state
    displayMessage("Closing loop and reprocessing...", 'info');

    let response;
    let responseBody;
    try {
        response = await fetch('/process_aoi', { // Use the same process_aoi endpoint
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aoiToClose)
        });
        console.log("Fetch response status:", response.status, response.statusText);

        responseBody = await response.text();
        console.log("Raw Response Body:", responseBody);

        if (!response.ok) {
            let errorMsg = `Server error: ${response.status} ${response.statusText}`;
             try {
                 const contentType = response.headers.get('content-type');
                 if (contentType && contentType.includes('application/json')) {
                     const errorData = JSON.parse(responseBody);
                     if (errorData && errorData.error) {
                        errorMsg = `Server error: ${errorData.error}`;
                     }
                 } else if (responseBody) {
                     errorMsg += ` - Response: ${responseBody.substring(0, 150)}...`;
                 }
             } catch (parseError) {
                 console.warn("Could not parse error response body as JSON:", parseError);
                 if (responseBody) {
                    errorMsg += ` - Raw Response: ${responseBody.substring(0, 150)}...`;
                 }
             }
             throw new Error(errorMsg);
        }

        // --- If response.ok ---
        // Check if responseBody is undefined or empty before parsing
        if (!responseBody) {
            throw new Error("Empty response received from server");
        }
        const stats = JSON.parse(responseBody);
        console.log("Stats after closing loop:", stats);

        if (!stats.is_closed) {
             // This would be unexpected if the request succeeded
             console.warn("Backend processed closed loop but reported is_closed=false. Check backend logic.");
             // Proceed anyway, but the state might be slightly off
             // Alternatively, throw an error: throw new Error("Server did not confirm loop closure.");
        }

        currentAoiGeoJson = aoiToClose; // Update the main stored AOI
        isAoiClosed = true; // Assume closed now
        displayStats(stats);

        addOrUpdateGeoJsonLayer(
            ORIGINAL_AOI_SOURCE_ID, ORIGINAL_AOI_LAYER_ID,
            currentAoiGeoJson,
            { 'line-color': '#FF0000', 'line-width': 3 }, 'line',
            showOriginalChk.checked
        );

        // Update the MapboxDraw feature visually IF draw still exists
        if (draw) {
             const currentDrawFeatures = draw.getAll();
             if (currentDrawFeatures.features.length > 0) {
                 const featureId = currentDrawFeatures.features[0].id;
                 const updatedDrawFeature = {
                     type: "Feature",
                     properties: currentAoiGeoJson.features[0].properties || {},
                     geometry: currentAoiGeoJson.features[0].geometry,
                     id: featureId
                 };
                 try {
                     console.log("Attempting to update feature in Draw tool:", updatedDrawFeature);
                     draw.set({ type: 'FeatureCollection', features: [updatedDrawFeature] });
                     console.log("Draw tool feature updated visually.");
                 } catch (err) {
                     console.error("Error updating feature geometry in Mapbox Draw:", err);
                     displayMessage("Warning: Could not visually update the drawing on map.", "error");
                 }
             }
        }

        // Check points and move to next state
        if (currentAoiGeoJson.features[0].geometry.coordinates.length < 4) {
             updateUIState('finished_closed'); // Seg button disabled by state logic
        } else {
             updateUIState('finished_closed');
        }

    } catch (error) {
        console.error("Error in closeLoopBtn click handler:", error);
        displayMessage(`Error closing loop: ${error.message || 'Unknown fetch error'}`, 'error');
        // Revert to 'finished_open' state as the closure wasn't successfully processed/confirmed
        updateUIState('finished_open');
    }
});


restartBtn.addEventListener('click', () => {
    console.log("Restart Drawing button clicked.");
    updateUIState('initial'); // This already calls clearMapLayersAndData
});


segmentBtn.addEventListener('click', async () => {
    console.log("Segment AoI button clicked.");
    if (!currentAoiGeoJson || !isAoiClosed) {
        displayMessage("Cannot segment: Processed AoI is not defined or not closed.", 'error'); return;
    }
     if (currentAoiGeoJson.features[0].geometry.coordinates.length < 4) {
         displayMessage("Cannot segment: Closed AoI needs at least 4 points (first=last).", 'error'); return;
     }

    const gridArea = parseFloat(gridAreaInput.value);
    const bufferKm = parseFloat(bufferKmInput.value);

    if (isNaN(gridArea) || gridArea <= 0) {
        displayMessage("Please enter a valid positive Grid Area.", 'error'); return;
    }
     if (isNaN(bufferKm) || bufferKm < 0) {
        displayMessage("Please enter a valid non-negative Buffer distance.", 'error'); return;
    }

    const payload = {
        aoi: currentAoiGeoJson,
        grid_area_sqkm: gridArea,
        buffer_km: bufferKm
    };

    console.log("Segmenting AoI with payload:", JSON.stringify(payload));
    updateUIState('segmenting');
    displayMessage("Segmenting AoI...", 'info');

    let response;
    let responseBody;
    try {
        response = await fetch('/segment_aoi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log("Fetch response status:", response.status, response.statusText);
        responseBody = await response.text();
        console.log("Raw Response Body:", responseBody);

        if (!response.ok) {
            let errorMsg = `Server error: ${response.status} ${response.statusText}`;
             try {
                 const contentType = response.headers.get('content-type');
                 if (contentType && contentType.includes('application/json')) {
                     const errorData = JSON.parse(responseBody);
                     if (errorData && errorData.error) {
                        errorMsg = `Server error: ${errorData.error}`;
                     }
                 } else if (responseBody) {
                     errorMsg += ` - Response: ${responseBody.substring(0, 150)}...`;
                 }
             } catch (parseError) {
                 console.warn("Could not parse error response body as JSON:", parseError);
                 if (responseBody) {
                    errorMsg += ` - Raw Response: ${responseBody.substring(0, 150)}...`;
                 }
             }
             throw new Error(errorMsg);
        }

        // --- If response.ok ---
        // Check if responseBody is undefined or empty before parsing
        if (!responseBody) {
            throw new Error("Empty response received from server");
        }
        const result = JSON.parse(responseBody);
        console.log("Segmentation result:", result);

        segmentedGeoJson = result.segmented_geojson;
        displayMessage(result.message || "Segmentation complete.", 'success'); // Use backend message

        addOrUpdateGeoJsonLayer(
            SEGMENTED_GRID_SOURCE_ID, SEGMENTED_GRID_LAYER_ID,
            segmentedGeoJson,
            { 'fill-color': '#00FF00', 'fill-opacity': 0.4, 'fill-outline-color': '#006400' },
            'fill',
            showSegmentedChk.checked
        );

        if(result.filename) {
            downloadLinkDiv.innerHTML = `<a href="/download/${result.filename}" download>Download ${result.filename}</a>`;
        } else {
             downloadLinkDiv.innerHTML = '';
             console.warn("Segmentation success but no filename returned from backend.");
        }
        updateUIState('segmented');

    } catch (error) {
        console.error("Error in segmentBtn click handler:", error);
        displayMessage(`Error during segmentation: ${error.message || 'Unknown fetch error'}`, 'error');
        // Clear only segmentation results on error
        if (map && map.getLayer(SEGMENTED_GRID_LAYER_ID)) map.removeLayer(SEGMENTED_GRID_LAYER_ID);
        if (map && map.getSource(SEGMENTED_GRID_SOURCE_ID)) map.removeSource(SEGMENTED_GRID_SOURCE_ID);
        segmentedGeoJson = null;
        downloadLinkDiv.innerHTML = '';
        updateUIState('finished_closed'); // Go back to state where user can try again
    }
});

// --- Checkbox Listeners ---
showOriginalChk.addEventListener('change', (event) => {
    if (map && map.getLayer(ORIGINAL_AOI_LAYER_ID)) {
        map.setLayoutProperty(ORIGINAL_AOI_LAYER_ID, 'visibility', event.target.checked ? 'visible' : 'none');
    }
});

showSegmentedChk.addEventListener('change', (event) => {
     if (map && map.getLayer(SEGMENTED_GRID_LAYER_ID)) {
        map.setLayoutProperty(SEGMENTED_GRID_LAYER_ID, 'visibility', event.target.checked ? 'visible' : 'none');
    }
});

// Initial message update
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        displayMessage("Map and tools initialized", 'info');
    });
}