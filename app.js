// ================= Elements =================
const $ = (s) => document.querySelector(s);

const input = $('#search-input');
const searchBtn = $('#search-btn');
const hero = $('#hero');
const content = $('#content');
const errorView = $('#error-view');
const emptyView = $('#empty-view');
const retryBtn = $('#retry-btn');
const sugList = $('#suggestions');

const unitsBtn = $('#units-btn');
const unitsMenu = $('#units-menu');
const systemBtn = $('#unit-system');

const card = $('#current-card');
const cityEl = $('#city');
const dateEl = $('#date');
const tempEl = $('#temp');
const mainIcon = $('#main-icon');
const feelsEl = $('#feels');
const humidityEl = $('#humidity');
const windEl = $('#wind');
const precipEl = $('#precip');
const dailyEl = $('#daily');
const hourlyEl = $('#hourly');
const daySelect = $('#day-select');

// ================= Constants & state =================
const METRIC = { temp: 'celsius', wind: 'kmh', precip: 'mm' };
const IMPERIAL = { temp: 'fahrenheit', wind: 'mph', precip: 'inch' };
const WIND_LABEL = { kmh: 'km/h', mph: 'mph' };
const PRECIP_LABEL = { mm: 'mm', inch: 'in' };

let units = { ...METRIC };
try {
  units = { ...METRIC, ...JSON.parse(localStorage.getItem('units')) };
} catch {}

let weather = null;      // last API response
let selectedDay = null;  // "YYYY-MM-DD" shown in the hourly list
let lastPlace = null;    // { latitude, longitude, label }
let retry = null;        // what the Retry button re-runs
let reqId = 0;           // ignores stale weather responses
let sugId = 0;           // ignores stale suggestion responses

// ================= WMO code -> icon =================
function iconFor(code) {
  let name = 'icon-sunny';
  if (code === 0) name = 'icon-sunny';
  else if (code <= 2) name = 'icon-partly-cloudy';
  else if (code === 3) name = 'icon-overcast';
  else if (code === 45 || code === 48) name = 'icon-fog';
  else if (code >= 51 && code <= 57) name = 'icon-drizzle';
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) name = 'icon-rain';
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) name = 'icon-snow';
  else if (code >= 95) name = 'icon-storm';
  return `assets/images/${name}.webp`;
}

// ================= Views =================
// 'ready' = full dashboard, 'empty' = no results, 'error' = API failure
function showView(view) {
  hero.hidden = view === 'error';
  content.hidden = view !== 'ready';
  emptyView.hidden = view !== 'empty';
  errorView.hidden = view !== 'error';
}

function renderSkeleton() {
  card.classList.add('is-loading');
  [feelsEl, humidityEl, windEl, precipEl].forEach((el) => (el.textContent = '—'));
  dailyEl.innerHTML = '<div class="day-card skeleton"></div>'.repeat(7);
  hourlyEl.innerHTML = '<div class="hour-item skeleton"></div>'.repeat(8);
  daySelect.innerHTML = '<option>–</option>';
}

// ================= API =================
async function geocode(query, count) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding request failed');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    latitude: r.latitude,
    longitude: r.longitude,
    label: `${r.name}, ${r.country}`,
  }));
}

async function getWeather({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    temperature_unit: units.temp,
    wind_speed_unit: units.wind,
    precipitation_unit: units.precip,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('Weather request failed');
  return res.json();
}

// ================= Rendering =================
function renderCurrent(label) {
  const c = weather.current;
  card.classList.remove('is-loading');
  cityEl.textContent = label;
  dateEl.textContent = new Date(c.time).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
  tempEl.textContent = `${Math.round(c.temperature_2m)}°`;
  mainIcon.src = iconFor(c.weather_code);
  feelsEl.textContent = `${Math.round(c.apparent_temperature)}°`;
  humidityEl.textContent = `${c.relative_humidity_2m}%`;
  windEl.textContent = `${Math.round(c.wind_speed_10m)} ${WIND_LABEL[units.wind]}`;
  precipEl.textContent = `${c.precipitation} ${PRECIP_LABEL[units.precip]}`;
}

function renderDaily() {
  const d = weather.daily;
  dailyEl.innerHTML = d.time.map((day, i) => {
    const name = new Date(`${day}T00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    return `
      <div class="day-card">
        <p>${name}</p>
        <img src="${iconFor(d.weather_code[i])}" alt="">
        <div class="temps">
          <span>${Math.round(d.temperature_2m_max[i])}°</span>
          <span class="low">${Math.round(d.temperature_2m_min[i])}°</span>
        </div>
      </div>`;
  }).join('');
}

function renderDaySelect() {
  const days = [...new Set(weather.hourly.time.map((t) => t.slice(0, 10)))];
  daySelect.innerHTML = days.map((d) => {
    const name = new Date(`${d}T00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    return `<option value="${d}">${name}</option>`;
  }).join('');
  daySelect.value = selectedDay;
}

function renderHourly() {
  const h = weather.hourly;
  hourlyEl.innerHTML = h.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.startsWith(selectedDay))
    .map(({ t, i }) => {
      const label = new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
      return `
        <div class="hour-item">
          <div class="hour-left">
            <img src="${iconFor(h.weather_code[i])}" alt="">
            <span>${label}</span>
          </div>
          <span>${Math.round(h.temperature_2m[i])}°</span>
        </div>`;
    }).join('');
}

// ================= Flows =================
async function loadWeather(place) {
  const id = ++reqId;
  lastPlace = place;
  retry = () => loadWeather(place);
  showView('ready');
  renderSkeleton();
  try {
    const data = await getWeather(place);
    if (id !== reqId) return;               // a newer request took over
    weather = data;
    selectedDay = data.current.time.slice(0, 10);
    renderCurrent(place.label);
    renderDaily();
    renderDaySelect();
    renderHourly();
  } catch (err) {
    if (id !== reqId) return;
    console.error(err);
    showView('error');
  }
}

async function runSearch(query) {
  query = query.trim();
  if (!query) return;
  hideSuggestions();
  const id = ++reqId;
  retry = () => runSearch(query);
  showView('ready');
  renderSkeleton();
  try {
    const results = await geocode(query, 1);
    if (id !== reqId) return;
    if (!results.length) return showView('empty');   // no match is NOT an error
    await loadWeather(results[0]);
  } catch (err) {
    if (id !== reqId) return;
    console.error(err);
    showView('error');                                // network/API failure is
  }
}

// ================= Suggestions =================
function hideSuggestions() {
  sugId++;
  sugList.hidden = true;
  sugList.innerHTML = '';
}

function showSuggestionsLoading() {
  sugList.innerHTML = '<li class="progress"><span class="spinner"></span> Search in progress</li>';
  sugList.hidden = false;
}

async function fetchSuggestions(q) {
  const id = ++sugId;
  try {
    const results = await geocode(q, 5);
    if (id !== sugId) return;
    if (!results.length) return hideSuggestions();
    sugList.replaceChildren(...results.map((place) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggestion';
      btn.textContent = place.label;           // textContent, never innerHTML
      btn.addEventListener('click', () => {
        input.value = place.label;
        hideSuggestions();
        loadWeather(place);
      });
      li.append(btn);
      return li;
    }));
  } catch {
    if (id === sugId) hideSuggestions();
  }
}

let debounce;
input.addEventListener('input', () => {
  clearTimeout(debounce);
  const q = input.value.trim();
  if (q.length < 2) return hideSuggestions();
  showSuggestionsLoading();
  debounce = setTimeout(() => fetchSuggestions(q), 300);
});

// ================= Units menu =================
function isImperial() {
  return units.temp === IMPERIAL.temp
    && units.wind === IMPERIAL.wind
    && units.precip === IMPERIAL.precip;
}

function syncMenu() {
  unitsMenu.querySelectorAll('[data-unit]').forEach((b) =>
    b.setAttribute('aria-checked', String(units[b.dataset.unit] === b.dataset.value)));
  systemBtn.textContent = isImperial() ? 'Switch to Metric' : 'Switch to Imperial';
}

function toggleMenu(open) {
  unitsMenu.hidden = !open;
  unitsBtn.setAttribute('aria-expanded', String(open));
}

unitsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(unitsMenu.hidden);
});

unitsMenu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'unit-system') units = isImperial() ? { ...METRIC } : { ...IMPERIAL };
  else units[b.dataset.unit] = b.dataset.value;
  try { localStorage.setItem('units', JSON.stringify(units)); } catch {}
  syncMenu();
  if (lastPlace) loadWeather(lastPlace);   // the API converts the values, so re-fetch
});

// ================= Wiring =================
daySelect.addEventListener('change', () => {
  selectedDay = daySelect.value;
  renderHourly();
});

searchBtn.addEventListener('click', () => runSearch(input.value));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch(input.value);
});
retryBtn.addEventListener('click', () => retry && retry());

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-field')) hideSuggestions();
  if (!e.target.closest('.units')) toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideSuggestions();
    toggleMenu(false);
  }
});

syncMenu();
runSearch('Berlin');