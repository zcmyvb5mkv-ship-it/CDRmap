const map = L.map('map').setView([55.9533, -3.1883], 13);

const arcgisStreets = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  }
).addTo(map);

const arcgisImagery = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  }
);

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});

L.control.layers(
  {
    'ArcGIS Streets': arcgisStreets,
    'ArcGIS Imagery': arcgisImagery,
    OpenStreetMap: osm,
    CartoDB: carto
  },
  {}
).addTo(map);

const pointsLayer = L.layerGroup().addTo(map);
const raysLayer = L.layerGroup().addTo(map);

const csvFile = document.getElementById('csvFile');
const dropZone = document.getElementById('dropZone');
const landingPage = document.getElementById('landingPage');
const mapPage = document.getElementById('mapPage');
const logPage = document.getElementById('logPage');

const toLandingBtn = document.getElementById('toLandingBtn');
const toMapBtn = document.getElementById('toMapBtn');
const toLogBtn = document.getElementById('toLogBtn');
const landingToMapBtn = document.getElementById('landingToMapBtn');
const landingToLogBtn = document.getElementById('landingToLogBtn');
const logToMapBtn = document.getElementById('logToMapBtn');
const logToLandingBtn = document.getElementById('logToLandingBtn');
const clearAllNotesBtn = document.getElementById('clearAllNotesBtn');

const lastNoteTime = document.getElementById('lastNoteTime');
const fullLogContainer = document.getElementById('fullLogContainer');

const vizMode = document.getElementById('vizMode');
const rayLengthInput = document.getElementById('rayLength');
const circleRadiusInput = document.getElementById('circleRadius');
const rayLengthControl = document.getElementById('rayLengthControl');
const circleRadiusControl = document.getElementById('circleRadiusControl');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');
const selectedPointMeta = document.getElementById('selectedPointMeta');
const pointNote = document.getElementById('pointNote');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const collapsedHud = document.getElementById('collapsedHud');
const hudTimeSlider = document.getElementById('hudTimeSlider');
const hudPointNote = document.getElementById('hudPointNote');
const hudSaveNoteBtn = document.getElementById('hudSaveNoteBtn');
const legendItems = document.getElementById('legendItems');
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const datasetLegend = document.getElementById('datasetLegend');
const toggleLegendBtn = document.getElementById('toggleLegendBtn');

let datasets = [];
let timer = null;
let activeDatasetId = null;

const datasetColors = ['#60a5fa', '#ef4444', '#22c55e', '#f59e0b', '#a78bfa', '#14b8a6'];

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs');

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const idxTime = headers.findIndex(h => ['time', 'date', 'datetime', 'timestamp'].includes(h));
  const idxE = headers.findIndex(h => h === 'easting' || h === 'eastings');
  const idxN = headers.findIndex(h => h === 'northing' || h === 'northings');
  const idxA = headers.findIndex(h => h === 'azimuth');

  if ([idxTime, idxE, idxN, idxA].some(i => i === -1)) {
    throw new Error('CSV missing required headers: time/date, easting, northing, azimuth');
  }

  const parsed = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < headers.length) continue;

    const timeRaw = cols[idxTime];
    const easting = Number(cols[idxE]);
    const northing = Number(cols[idxN]);
    const azimuth = Number(cols[idxA]);

    if (!timeRaw || Number.isNaN(easting) || Number.isNaN(northing) || Number.isNaN(azimuth)) continue;

    const [lon, lat] = proj4('EPSG:27700', 'EPSG:4326', [easting, northing]);
    const t = new Date(timeRaw);

    if (Number.isNaN(t.getTime())) continue;

    parsed.push({ time: t, timeRaw, easting, northing, azimuth, lat, lon });
  }

  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}

function normalizeBearing(b) {
  let v = b % 360;
  if (v < 0) v += 360;
  return v;
}

function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6378137;
  const brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const dr = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) +
    Math.cos(lat1) * Math.sin(dr) * Math.cos(brng)
  );

  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(dr) * Math.cos(lat1),
    Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

function splitDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: value, time: '' };
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 19)
  };
}

function formatPointTimeDate(value) {
  const dt = splitDateTime(value);
  return `${dt.time}, ${dt.date}`;
}

function noteKey(datasetId, idx, timeRaw) {
  return `${datasetId}__${idx}__${timeRaw}`;
}

function updateVizControlsVisibility() {
  if (vizMode.value === 'line') {
    rayLengthControl.style.display = 'grid';
    circleRadiusControl.style.display = 'none';
  } else {
    rayLengthControl.style.display = 'none';
    circleRadiusControl.style.display = 'grid';
  }
}

function getMaxRows() {
  return datasets.reduce((max, ds) => Math.max(max, ds.rows.length), 0);
}

function getActiveDataset() {
  return datasets.find(d => d.id === activeDatasetId) || datasets[0] || null;
}

function buildLegend() {
  legendItems.innerHTML = '';
  datasets.forEach(ds => {
    const row = document.createElement('label');
    row.className = 'legend-item';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = ds.visible;
    toggle.addEventListener('change', () => {
      ds.visible = toggle.checked;
      renderIndex(Number(timeSlider.value));
      updateSelectedMeta();
    });

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = ds.color;

    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = ds.name;
    name.title = ds.name;
    name.addEventListener('click', () => {
      activeDatasetId = ds.id;
      updateSelectedMeta();
      const i = Number(timeSlider.value);
      const rowData = ds.rows[i];
      pointNote.value = rowData ? (ds.notes[noteKey(ds.id, i, rowData.timeRaw)] || '') : '';
    });

    row.appendChild(toggle);
    row.appendChild(swatch);
    row.appendChild(name);
    legendItems.appendChild(row);
  });
}

function getReportEntries() {
  const entries = [];
  datasets.forEach(ds => {
    ds.rows.forEach((r, idx) => {
      const note = ds.notes[noteKey(ds.id, idx, r.timeRaw)] || '';
      if (note.trim()) entries.push({ dataset: ds.name, idx, r, note });
    });
  });
  return entries.sort((a, b) => a.r.time - b.r.time);
}

function renderFullLog() {
  if (!fullLogContainer) return;
  const entries = getReportEntries();

  if (!entries.length) {
    fullLogContainer.innerHTML = '<p class="hint">No notes saved yet. Save notes from the map page to populate this log.</p>';
    return;
  }

  let html = '<table class="full-log-table"><thead><tr><th>Dataset</th><th>#</th><th>Date</th><th>Time</th><th>Observed Note</th></tr></thead><tbody>';
  entries.forEach(({ dataset, idx, r, note }) => {
    const dt = splitDateTime(r.timeRaw);
    const safeHtml = note.replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>');
    html += `<tr><td>${dataset}</td><td>${idx + 1}</td><td>${dt.date}</td><td>${dt.time}</td><td><div class="note-full-text">${safeHtml}</div></td></tr>`;
  });
  html += '</tbody></table>';
  fullLogContainer.innerHTML = html;
}

function updateSelectedMeta() {
  const i = Number(timeSlider.value);
  const active = getActiveDataset();
  if (!active || !active.rows[i]) {
    selectedPointMeta.textContent = 'No point selected';
    pointNote.value = '';
    if (hudPointNote) hudPointNote.value = '';
    return;
  }
  const r = active.rows[i];
  selectedPointMeta.textContent = formatPointTimeDate(r.timeRaw);
  const currentNote = active.notes[noteKey(active.id, i, r.timeRaw)] || '';
  pointNote.value = currentNote;
  if (hudPointNote) hudPointNote.value = currentNote;
}

function makeConePolygon(lat, lon, centerBearing, radiusM, halfAngle = 30, steps = 16) {
  const start = normalizeBearing(centerBearing - halfAngle);
  const end = normalizeBearing(centerBearing + halfAngle);

  let sweep = end - start;
  if (sweep < 0) sweep += 360;

  const points = [[lat, lon]];
  for (let s = 0; s <= steps; s++) {
    const b = normalizeBearing(start + (sweep * s) / steps);
    points.push(destinationPoint(lat, lon, b, radiusM));
  }
  points.push([lat, lon]);
  return points;
}

function renderIndex(i) {
  pointsLayer.clearLayers();
  raysLayer.clearLayers();

  const rayLength = Number(rayLengthInput.value) || 100;
  const circleRadius = Number(circleRadiusInput.value) || 100;

  datasets.forEach(ds => {
    if (!ds.visible) return;

    ds.rows.forEach((p, idx) => {
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: idx === i ? 7 : 4,
        color: ds.color,
        fillColor: ds.color,
        fillOpacity: idx === i ? 0.95 : 0.7,
        weight: idx === i ? 2 : 1
      }).bindPopup(
        `<b>${ds.name} | #${idx + 1}</b><br>` +
        `Time: ${p.timeRaw}<br>` +
        `OSGB36: ${p.easting}E ${p.northing}N<br>` +
        `Azimuth: ${p.azimuth}°`
      );
      marker.addTo(pointsLayer);
    });

    const r = ds.rows[i];
    if (!r) return;

    if (vizMode.value === 'line') {
      const cone = makeConePolygon(r.lat, r.lon, r.azimuth, rayLength, 30, 18);
      L.polygon(cone, {
        color: ds.color,
        weight: 2,
        fillColor: ds.color,
        fillOpacity: 0.18
      }).addTo(raysLayer);
    } else {
      L.circle([r.lat, r.lon], {
        radius: circleRadius,
        color: ds.color,
        weight: 2,
        fillColor: ds.color,
        fillOpacity: 0.12
      }).addTo(raysLayer);
    }
  });

  const maxRows = getMaxRows();
  timeLabel.textContent = maxRows ? `Index ${i + 1}/${maxRows}` : 'No data loaded';
  updateSelectedMeta();
}

function fitMap() {
  const latLngs = [];
  datasets.forEach(ds => ds.rows.forEach(r => latLngs.push([r.lat, r.lon])));
  if (!latLngs.length) return false;

  const validLatLngs = latLngs.filter(([lat, lon]) =>
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );

  if (!validLatLngs.length) {
    console.warn('fitMap: no valid lat/lon values from uploaded points');
    return false;
  }

  const bounds = L.latLngBounds(validLatLngs);
  if (!bounds.isValid()) {
    console.warn('fitMap: computed bounds are invalid');
    return false;
  }

  try {
    map.fitBounds(bounds.pad(0.25), { maxZoom: 17, animate: false });
  } catch (e) {
    console.warn('fitMap: fitBounds failed', e);
    return false;
  }

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latSpan = Math.abs(ne.lat - sw.lat);
  const lonSpan = Math.abs(ne.lng - sw.lng);

  if (latSpan < 0.0005 && lonSpan < 0.0005) {
    map.setView(bounds.getCenter(), 17, { animate: false });
  }

  return true;
}

function setTabActiveState(page) {
  const tabMap = {
    landing: [toLandingBtn],
    map: [toMapBtn],
    log: [toLogBtn]
  };

  const allTabs = [toLandingBtn, toMapBtn, toLogBtn].filter(Boolean);
  allTabs.forEach(btn => btn.classList.remove('active-tab'));
  (tabMap[page] || []).forEach(btn => btn && btn.classList.add('active-tab'));
}

function setActivePage(page) {
  if (!landingPage || !mapPage || !logPage) return;

  [landingPage, mapPage, logPage].forEach(el => el.classList.remove('active'));

  if (page === 'map') {
    mapPage.classList.add('active');
    setTimeout(() => map.invalidateSize(), 80);
  } else if (page === 'log') {
    logPage.classList.add('active');
    renderFullLog();
  } else {
    landingPage.classList.add('active');
  }

  setTabActiveState(page);
}

function setLoadedState(loaded) {
  timeSlider.disabled = !loaded;
  if (hudTimeSlider) hudTimeSlider.disabled = !loaded;
  saveNoteBtn.disabled = !loaded;
  if (hudSaveNoteBtn) hudSaveNoteBtn.disabled = !loaded;
}

function setLastSavedNoteTime(timeRaw) {
  if (!lastNoteTime) return;
  if (!timeRaw) {
    lastNoteTime.textContent = 'No note saved yet';
    return;
  }
  lastNoteTime.textContent = `Last saved: ${formatPointTimeDate(timeRaw)}`;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  clearInterval(timer);

  try {
    const parsedDatasets = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) continue;
      parsedDatasets.push({
        id: `ds_${i + 1}`,
        name: file.name.replace(/\.csv$/i, ''),
        color: datasetColors[i % datasetColors.length],
        rows,
        visible: true,
        notes: {}
      });
    }

    if (!parsedDatasets.length) throw new Error('No valid rows found in uploaded files.');

    datasets = parsedDatasets;
    activeDatasetId = datasets[0].id;
    setLastSavedNoteTime('');

    const maxRows = getMaxRows();
    timeSlider.min = 0;
    timeSlider.max = Math.max(0, maxRows - 1);
    timeSlider.value = 0;
    if (hudTimeSlider) {
      hudTimeSlider.min = timeSlider.min;
      hudTimeSlider.max = timeSlider.max;
      hudTimeSlider.value = timeSlider.value;
    }

    buildLegend();
    setLoadedState(true);
    renderIndex(0);
    setActivePage('map');

    requestAnimationFrame(() => {
      map.invalidateSize(false);
      const fitted = fitMap();
      if (!fitted && datasets[0] && datasets[0].rows[0]) {
        const p = datasets[0].rows[0];
        map.setView([p.lat, p.lon], 15, { animate: false });
      }

      const currentZoom = map.getZoom();
      const targetZoom = Math.max(1, currentZoom - 2);
      if (Number.isFinite(currentZoom) && targetZoom < currentZoom) {
        map.setZoom(targetZoom, { animate: false });
      }

      focusActiveNoteInput();
    });

    renderFullLog();
  } catch (err) {
    datasets = [];
    activeDatasetId = null;
    setLoadedState(false);
    if (hudTimeSlider) {
      hudTimeSlider.min = 0;
      hudTimeSlider.max = 0;
      hudTimeSlider.value = 0;
    }
    pointsLayer.clearLayers();
    raysLayer.clearLayers();
    legendItems.innerHTML = '';
    timeLabel.textContent = `Error: ${err.message}`;
    selectedPointMeta.textContent = 'No point selected';
    pointNote.value = '';
    setLastSavedNoteTime('');
  }
}

csvFile.addEventListener('change', async (e) => {
  await handleFiles(e.target.files || []);
});

if (dropZone) {
  ['dragenter', 'dragover'].forEach((evtName) => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach((evtName) => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (evtName !== 'drop') dropZone.classList.remove('is-dragover');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    dropZone.classList.remove('is-dragover');
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    await handleFiles(files || []);
  });
}

timeSlider.addEventListener('input', () => {
  if (!datasets.length) return;
  if (hudTimeSlider) hudTimeSlider.value = timeSlider.value;
  renderIndex(Number(timeSlider.value));
});

if (hudTimeSlider) {
  hudTimeSlider.addEventListener('input', () => {
    if (!datasets.length) return;
    timeSlider.value = hudTimeSlider.value;
    renderIndex(Number(hudTimeSlider.value));
  });
}

rayLengthInput.addEventListener('change', () => {
  if (!datasets.length) return;
  renderIndex(Number(timeSlider.value));
});

circleRadiusInput.addEventListener('change', () => {
  if (!datasets.length) return;
  renderIndex(Number(timeSlider.value));
});

vizMode.addEventListener('change', () => {
  updateVizControlsVisibility();
  if (!datasets.length) return;
  renderIndex(Number(timeSlider.value));
});

function focusActiveNoteInput() {
  setTimeout(() => {
    const useHud = sidebar && sidebar.classList.contains('collapsed') && hudPointNote;
    const target = useHud ? hudPointNote : pointNote;
    if (!target) return;
    target.focus({ preventScroll: true });
    const v = target.value || '';
    try { target.setSelectionRange(v.length, v.length); } catch (_) {}
  }, 0);
}

function saveCurrentNote(noteValue) {
  if (!datasets.length) return false;
  const i = Number(timeSlider.value);
  const active = getActiveDataset();
  if (!active || !active.rows[i]) return false;
  const r = active.rows[i];
  const trimmed = (noteValue || '').trim();
  active.notes[noteKey(active.id, i, r.timeRaw)] = trimmed;
  pointNote.value = trimmed;
  if (hudPointNote) hudPointNote.value = trimmed;
  setLastSavedNoteTime(r.timeRaw);
  renderFullLog();
  return true;
}

function moveToNextTimelinePoint() {
  if (!datasets.length) return;
  const maxRows = getMaxRows();
  if (maxRows <= 1) return;

  const current = Number(timeSlider.value);
  const next = Math.min(current + 1, maxRows - 1);
  if (next === current) return;

  timeSlider.value = String(next);
  if (hudTimeSlider) hudTimeSlider.value = String(next);
  renderIndex(next);
}

saveNoteBtn.addEventListener('click', () => {
  saveCurrentNote(pointNote.value);
});

if (hudSaveNoteBtn) {
  hudSaveNoteBtn.addEventListener('click', () => {
    saveCurrentNote(hudPointNote ? hudPointNote.value : '');
  });
}

pointNote.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saveCurrentNote(pointNote.value);
    moveToNextTimelinePoint();
  }
});

if (hudPointNote) {
  hudPointNote.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveCurrentNote(hudPointNote.value);
      moveToNextTimelinePoint();
    }
  });
}

toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  if (collapsedHud) collapsedHud.setAttribute('aria-hidden', isCollapsed ? 'false' : 'true');
  toggleSidebarBtn.textContent = isCollapsed ? '▶' : '◀';
  focusActiveNoteInput();
});

toggleLegendBtn.addEventListener('click', () => {
  datasetLegend.classList.toggle('collapsed');
  toggleLegendBtn.textContent = datasetLegend.classList.contains('collapsed') ? '◂' : '▸';
});

if (toLandingBtn) toLandingBtn.addEventListener('click', () => setActivePage('landing'));
if (toMapBtn) toMapBtn.addEventListener('click', () => setActivePage('map'));
if (toLogBtn) toLogBtn.addEventListener('click', () => setActivePage('log'));

if (landingToMapBtn) landingToMapBtn.addEventListener('click', () => setActivePage('map'));
if (landingToLogBtn) landingToLogBtn.addEventListener('click', () => setActivePage('log'));

if (logToMapBtn) logToMapBtn.addEventListener('click', () => setActivePage('map'));
if (logToLandingBtn) logToLandingBtn.addEventListener('click', () => setActivePage('landing'));

if (clearAllNotesBtn) {
  clearAllNotesBtn.addEventListener('click', () => {
    datasets.forEach((ds) => {
      ds.notes = {};
    });
    pointNote.value = '';
    if (hudPointNote) hudPointNote.value = '';
    setLastSavedNoteTime('');
    renderFullLog();
    updateSelectedMeta();
  });
}

updateVizControlsVisibility();
if (collapsedHud) collapsedHud.setAttribute('aria-hidden', 'true');
if (hudTimeSlider) {
  hudTimeSlider.min = timeSlider.min;
  hudTimeSlider.max = timeSlider.max;
  hudTimeSlider.value = timeSlider.value;
}
setLastSavedNoteTime('');
setActivePage('landing');
focusActiveNoteInput();
