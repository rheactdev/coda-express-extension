const SETTINGS_KEYS = ["backendBaseUrl", "bookmarkApiKey", "codaToken", "docId", "tableId"];
const LOCAL_CACHE_KEY = "codaDiscoveryCache";
const SAVED_LOCATIONS_KEY = "codaSavedLocations";
const CODA_API_BASE_URL = "https://coda.io/apis/v1";
const DISPLAY_URL_MAX_LENGTH = 180;

const form = document.querySelector("#clipForm");
const submitButton = document.querySelector("#submitButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const refreshDocsButton = document.querySelector("#refreshDocsButton");
const saveLocationButton = document.querySelector("#saveLocationButton");
const statusEl = document.querySelector("#status");
const currentUrlEl = document.querySelector("#currentUrl");
const fields = {
  backendBaseUrl: document.querySelector("#backendBaseUrl"),
  bookmarkApiKey: document.querySelector("#bookmarkApiKey"),
  codaToken: document.querySelector("#codaToken"),
  docId: document.querySelector("#docId"),
  tableId: document.querySelector("#tableId"),
  savedLocationId: document.querySelector("#savedLocationId"),
  savedLocationName: document.querySelector("#savedLocationName"),
};

let currentTabUrl = "";
let savedDocId = "";
let savedTableId = "";
let discoveryCache = null;
let savedLocations = [];
let isSavingBookmark = false;
let isLoadingDocs = false;
let isLoadingTables = false;

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadSettings(), loadDiscoveryCache(), loadSavedLocations(), loadCurrentTab()]);
  form.addEventListener("submit", handleSubmit);
  settingsButton.addEventListener("click", toggleSettingsPanel);
  refreshDocsButton.addEventListener("click", refreshDiscoveryCache);
  saveLocationButton.addEventListener("click", handleSaveLocation);

  fields.backendBaseUrl.addEventListener("change", saveSettings);
  fields.bookmarkApiKey.addEventListener("change", saveSettings);
  fields.codaToken.addEventListener("change", handleTokenChange);
  fields.docId.addEventListener("change", handleDocChange);
  fields.tableId.addEventListener("change", handleTableChange);
  fields.savedLocationId.addEventListener("change", handleSavedLocationChange);
  fields.savedLocationName.addEventListener("keydown", handleSavedLocationNameKeydown);

  renderSavedLocations();
  if (fields.codaToken.value.trim()) {
    renderCachedDocs({ quiet: true });
  }
});

async function loadSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
  savedDocId = stored.docId ?? "";
  savedTableId = stored.tableId ?? "";

  for (const key of SETTINGS_KEYS) {
    if (stored[key] && fields[key] && fields[key].tagName !== "SELECT") {
      fields[key].value = stored[key];
    }
  }
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabUrl = tab?.url ?? "";

  if (!currentTabUrl) {
    currentUrlEl.textContent = "No active tab URL found.";
    setStatus("Open a normal webpage tab before saving.", "error");
    return;
  }

  currentUrlEl.textContent = truncateUrl(currentTabUrl);
  currentUrlEl.title = currentTabUrl;
}

async function handleSubmit(event) {
  event.preventDefault();

  const settings = getSettings();
  const validationError = validate(settings);
  if (validationError) {
    if (!settings.backendBaseUrl || !settings.bookmarkApiKey || !settings.codaToken) {
      setSettingsPanelOpen(true);
    }
    setStatus(validationError, "error");
    return;
  }

  await saveSettings();
  setLoading(true);
  setStatus("Sending bookmark to the backend...", "loading");

  try {
    const response = await fetch(buildSaveEndpoint(settings.backendBaseUrl), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.codaToken}`,
        "Content-Type": "application/json",
        "x-api-key": settings.bookmarkApiKey,
      },
      body: JSON.stringify({
        url: currentTabUrl,
        docId: settings.docId,
        tableId: settings.tableId,
      }),
    });

    const data = await readJsonResponse(response);

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Backend returned HTTP ${response.status}.`);
    }

    const workflowRunId = data?.workflowRunId ? ` Workflow run: ${data.workflowRunId}` : "";
    setStatus(`Bookmark accepted.${workflowRunId}`, "success");
    window.close();
  } catch (error) {
    setStatus(toSafeErrorMessage(error), "error");
  } finally {
    setLoading(false);
  }
}

async function handleTokenChange() {
  savedDocId = "";
  savedTableId = "";
  fields.savedLocationName.value = "";
  await saveSettings();
  renderSavedLocations();

  if (fields.codaToken.value.trim()) {
    renderCachedDocs();
  } else {
    resetDocSelect("Enter a token to load docs");
    resetTableSelect("Select a doc first");
  }
}

async function handleDocChange() {
  savedDocId = fields.docId.value;
  savedTableId = "";
  await saveSettings();

  if (savedDocId) {
    renderCachedTables(savedDocId);
  } else {
    resetTableSelect("Select a doc first");
  }
}

async function handleTableChange() {
  savedTableId = fields.tableId.value;
  fields.savedLocationId.value = findSavedLocationId(savedDocId, savedTableId);
  await saveSettings();
}

async function handleSavedLocationChange() {
  const location = findSavedLocation(fields.savedLocationId.value);
  if (!location) {
    return;
  }

  if (!hasCacheForCurrentToken()) {
    setStatus("Click Refresh before using saved locations for this token.", "error");
    return;
  }

  if (!getCachedDoc(location.docId)) {
    setStatus("That saved doc is not in the current cache. Click Refresh to update docs.", "error");
    return;
  }

  savedDocId = location.docId;
  savedTableId = location.tableId;
  fields.docId.value = location.docId;
  renderCachedTables(location.docId, { selectedTableId: location.tableId, quiet: true });

  if (fields.tableId.value !== location.tableId) {
    setStatus("That saved table is not in the current cache. Click Refresh to update tables.", "error");
    return;
  }

  fields.savedLocationName.value = location.name;
  await saveSettings();
  setStatus(`Selected saved location: ${location.name}.`, "success");
}

async function handleSaveLocation() {
  const name = fields.savedLocationName.value.trim();
  const settings = getSettings();

  if (!name) {
    setStatus("Name the current save location first.", "error");
    return;
  }

  if (!settings.codaToken || !settings.docId || !settings.tableId) {
    setStatus("Select a Coda doc and table before saving a location.", "error");
    return;
  }

  const tokenFingerprint = getTokenFingerprint(settings.codaToken);
  const existing = savedLocations.find((location) => location.tokenFingerprint === tokenFingerprint && location.name.toLowerCase() === name.toLowerCase());
  const location = {
    id: existing?.id ?? `location-${Date.now()}`,
    tokenFingerprint,
    name,
    docId: settings.docId,
    tableId: settings.tableId,
    docName: getSelectedOptionLabel(fields.docId),
    tableName: getSelectedOptionLabel(fields.tableId),
    updatedAt: new Date().toISOString(),
  };

  savedLocations = existing
    ? savedLocations.map((item) => item.id === existing.id ? location : item)
    : [...savedLocations, location];

  await saveSavedLocations();
  renderSavedLocations({ selectedLocationId: location.id });
  setStatus(`Saved location: ${name}.`, "success");
}

function handleSavedLocationNameKeydown(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  handleSaveLocation();
}

function toggleSettingsPanel() {
  setSettingsPanelOpen(settingsButton.getAttribute("aria-expanded") !== "true");
}

function setSettingsPanelOpen(isOpen) {
  settingsPanel.hidden = !isOpen;
  settingsButton.setAttribute("aria-expanded", String(isOpen));
}

function getSettings() {
  return {
    backendBaseUrl: fields.backendBaseUrl.value.trim(),
    bookmarkApiKey: fields.bookmarkApiKey.value.trim(),
    codaToken: fields.codaToken.value.trim(),
    docId: fields.docId.value.trim(),
    tableId: fields.tableId.value.trim(),
  };
}

async function saveSettings() {
  await chrome.storage.sync.set(getSettings());
}

async function loadDiscoveryCache() {
  const stored = await chrome.storage.local.get(LOCAL_CACHE_KEY);
  discoveryCache = stored[LOCAL_CACHE_KEY] ?? null;
}

async function saveDiscoveryCache(cache) {
  discoveryCache = cache;
  await chrome.storage.local.set({ [LOCAL_CACHE_KEY]: cache });
}

async function loadSavedLocations() {
  const stored = await chrome.storage.local.get(SAVED_LOCATIONS_KEY);
  savedLocations = Array.isArray(stored[SAVED_LOCATIONS_KEY]) ? stored[SAVED_LOCATIONS_KEY] : [];
}

async function saveSavedLocations() {
  await chrome.storage.local.set({ [SAVED_LOCATIONS_KEY]: savedLocations });
}

async function refreshDiscoveryCache() {
  const token = fields.codaToken.value.trim();
  if (!token) {
    setSettingsPanelOpen(true);
    resetDocSelect("Enter a token to load docs");
    resetTableSelect("Select a doc first");
    return;
  }

  const selectedDocId = fields.docId.value || savedDocId;
  const selectedTableId = fields.tableId.value || savedTableId;
  setDiscoveryLoading({ docs: true });
  resetDocSelect("Loading docs...");
  resetTableSelect("Select a doc first");
  setStatus("Refreshing Coda docs and tables...", "loading");

  try {
    const docs = await fetchAllCodaItems(`${CODA_API_BASE_URL}/docs`, token);
    const tablesByDocId = {};

    for (const doc of docs) {
      tablesByDocId[doc.id] = await fetchAllCodaItems(`${CODA_API_BASE_URL}/docs/${encodeURIComponent(doc.id)}/tables`, token);
    }

    await saveDiscoveryCache({
      tokenFingerprint: getTokenFingerprint(token),
      refreshedAt: new Date().toISOString(),
      docs,
      tablesByDocId,
    });

    renderCachedDocs({ selectedDocId, selectedTableId, refreshed: true });
  } catch (error) {
    resetDocSelect("Could not load docs");
    resetTableSelect("Select a doc first");
    setStatus(toSafeErrorMessage(error), "error");
  } finally {
    setDiscoveryLoading({ docs: false });
  }
}

function renderCachedDocs({ selectedDocId = savedDocId, selectedTableId = savedTableId, quiet = false, refreshed = false } = {}) {
  const token = fields.codaToken.value.trim();
  if (!token) {
    resetDocSelect("Enter a token to load docs");
    resetTableSelect("Select a doc first");
    return;
  }

  if (!hasCacheForCurrentToken()) {
    resetDocSelect("Click refresh to load docs");
    resetTableSelect("Select a doc first");
    renderSavedLocations();
    if (!quiet) {
      setStatus("Click Refresh to load docs for this Coda token.", "");
    }
    return;
  }

  const docs = Array.isArray(discoveryCache.docs) ? discoveryCache.docs : [];
  populateSelect(fields.docId, docs, {
    placeholder: docs.length ? "Select a doc" : "No docs are available for this token",
    selectedValue: selectedDocId,
    formatLabel: formatDocLabel,
  });

  savedDocId = fields.docId.value;
  renderCachedTables(savedDocId, { selectedTableId, quiet: true });
  renderSavedLocations({ selectedLocationId: findSavedLocationId(savedDocId, savedTableId) });

  if (!quiet) {
    const prefix = refreshed ? "Refreshed" : "Loaded cached";
    setStatus(`${prefix} ${docs.length} Coda ${pluralize("doc", docs.length)}.`, docs.length ? "success" : "error");
  }
}

function renderCachedTables(docId, { selectedTableId = savedTableId, quiet = false } = {}) {
  if (!docId) {
    resetTableSelect("Select a doc first");
    return;
  }

  const tables = discoveryCache?.tablesByDocId?.[docId] ?? [];
  populateSelect(fields.tableId, tables, {
    placeholder: tables.length ? "Select a table" : "No tables found in this doc",
    selectedValue: selectedTableId,
    formatLabel: formatTableLabel,
  });

  savedTableId = fields.tableId.value;
  fields.savedLocationId.value = findSavedLocationId(savedDocId, savedTableId);
  saveSettings();

  if (!quiet) {
    setStatus(`Loaded ${tables.length} cached ${pluralize("table", tables.length)} from the selected doc.`, tables.length ? "success" : "error");
  }
}

function renderSavedLocations({ selectedLocationId = "" } = {}) {
  const locations = getSavedLocationsForCurrentToken();
  fields.savedLocationId.replaceChildren(buildOption("", locations.length ? "Choose saved location" : "No saved locations"));

  for (const location of locations) {
    fields.savedLocationId.append(buildOption(location.id, location.name));
  }

  fields.savedLocationId.disabled = locations.length === 0;

  const selectedId = selectedLocationId || findSavedLocationId(savedDocId, savedTableId);
  if (selectedId && locations.some((location) => location.id === selectedId)) {
    fields.savedLocationId.value = selectedId;
  }
}

function getSavedLocationsForCurrentToken() {
  const token = fields.codaToken.value.trim();
  if (!token) {
    return [];
  }

  const tokenFingerprint = getTokenFingerprint(token);
  return savedLocations
    .filter((location) => location.tokenFingerprint === tokenFingerprint)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function findSavedLocation(locationId) {
  return savedLocations.find((location) => location.id === locationId);
}

function findSavedLocationId(docId, tableId) {
  const location = getSavedLocationsForCurrentToken().find((item) => item.docId === docId && item.tableId === tableId);
  return location?.id ?? "";
}

function getCachedDoc(docId) {
  const docs = Array.isArray(discoveryCache?.docs) ? discoveryCache.docs : [];
  return docs.find((doc) => doc.id === docId);
}

function getSelectedOptionLabel(select) {
  return select.selectedOptions[0]?.textContent ?? "";
}

async function fetchAllCodaItems(initialUrl, token) {
  const items = [];
  let nextUrl = initialUrl;
  let pageCount = 0;

  while (nextUrl) {
    pageCount += 1;
    if (pageCount > 100) {
      throw new Error("Coda returned too many pages while loading results.");
    }

    const response = await fetch(nextUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Coda returned HTTP ${response.status}.`);
    }

    items.push(...(Array.isArray(data?.items) ? data.items : []));
    nextUrl = normalizeCodaPageLink(data?.nextPageLink);
  }

  return items;
}

function normalizeCodaPageLink(nextPageLink) {
  if (!nextPageLink) {
    return "";
  }

  return new URL(nextPageLink, `${CODA_API_BASE_URL}/`).toString();
}

function populateSelect(select, items, { placeholder, selectedValue, formatLabel }) {
  select.replaceChildren(buildOption("", placeholder));

  for (const item of items) {
    select.append(buildOption(item.id, formatLabel(item)));
  }

  select.disabled = items.length === 0;

  if (selectedValue && items.some((item) => item.id === selectedValue)) {
    select.value = selectedValue;
  }
}

function buildOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function resetDocSelect(message) {
  fields.docId.replaceChildren(buildOption("", message));
  fields.docId.disabled = true;
}

function resetTableSelect(message) {
  fields.tableId.replaceChildren(buildOption("", message));
  fields.tableId.disabled = true;
}

function formatDocLabel(doc) {
  return doc.name ? `${doc.name} (${doc.id})` : doc.id;
}

function formatTableLabel(table) {
  const type = table.type ? `${table.type}: ` : "";
  return table.name ? `${type}${table.name} (${table.id})` : table.id;
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function hasCacheForCurrentToken() {
  const token = fields.codaToken.value.trim();
  return Boolean(discoveryCache?.tokenFingerprint && discoveryCache.tokenFingerprint === getTokenFingerprint(token));
}

function getTokenFingerprint(token) {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(index)) | 0;
  }

  return `${token.length}:${hash}`;
}

function validate(settings) {
  if (!currentTabUrl) {
    return "No active tab URL is available.";
  }

  try {
    new URL(currentTabUrl);
  } catch {
    return "The active tab URL is not a valid URL.";
  }

  if (!settings.backendBaseUrl) {
    return "Backend URL is required.";
  }

  try {
    new URL(settings.backendBaseUrl);
  } catch {
    return "Backend URL must be a valid URL.";
  }

  if (!settings.bookmarkApiKey) {
    return "Bookmark API key is required.";
  }

  if (!settings.codaToken) {
    return "Coda API token is required.";
  }

  if (!settings.docId) {
    return "Select a Coda doc.";
  }

  if (!settings.tableId) {
    return "Select a Coda table.";
  }

  return "";
}

function buildSaveEndpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/api/save-bookmark`;
}

function truncateUrl(url) {
  if (url.length <= DISPLAY_URL_MAX_LENGTH) {
    return url;
  }

  const keepStart = 100;
  const marker = "...";
  const keepEnd = DISPLAY_URL_MAX_LENGTH - keepStart - marker.length;
  return `${url.slice(0, keepStart)}${marker}${url.slice(-keepEnd)}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function setLoading(isLoading) {
  isSavingBookmark = isLoading;
  const isBusy = isSavingBookmark || isLoadingDocs || isLoadingTables;
  submitButton.disabled = isBusy;
  settingsButton.disabled = isBusy;
  refreshDocsButton.disabled = isBusy;
  saveLocationButton.disabled = isBusy;
  fields.savedLocationName.disabled = isBusy;
  fields.bookmarkApiKey.disabled = isBusy;
  fields.codaToken.disabled = isBusy;
  fields.savedLocationId.disabled = isBusy || fields.savedLocationId.options.length <= 1;
  submitButton.textContent = isLoading ? "Saving..." : "Save bookmark";
}

function setDiscoveryLoading({ docs = isLoadingDocs, tables = isLoadingTables }) {
  isLoadingDocs = docs;
  isLoadingTables = tables;
  const isBusy = isSavingBookmark || isLoadingDocs || isLoadingTables;
  fields.codaToken.disabled = isBusy;
  fields.bookmarkApiKey.disabled = isBusy;
  fields.docId.disabled = isBusy || fields.docId.options.length <= 1;
  fields.tableId.disabled = isBusy || fields.tableId.options.length <= 1;
  fields.savedLocationName.disabled = isBusy;
  settingsButton.disabled = isBusy;
  fields.savedLocationId.disabled = isBusy || fields.savedLocationId.options.length <= 1;
  refreshDocsButton.disabled = isBusy;
  saveLocationButton.disabled = isBusy;
  submitButton.disabled = isBusy;
}

function setStatus(message, state = "") {
  statusEl.textContent = message;
  if (state) {
    statusEl.dataset.state = state;
  } else {
    delete statusEl.dataset.state;
  }
}

function toSafeErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The bookmark could not be saved.";
}
