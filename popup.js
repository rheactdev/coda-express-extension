const SETTINGS_KEYS = ["backendBaseUrl", "bookmarkApiKey", "codaToken", "docId", "savedLocationId", "tableId"];
const LOCAL_CACHE_KEY = "codaDiscoveryCache";
const SAVED_LOCATIONS_KEY = "codaSavedLocations";
const SELECTED_PROPERTIES_KEY = "codaSelectedDatabaseProperties";
const MANUAL_PROPERTY_VALUES_KEY = "codaManualPropertyValues";
const CODA_API_BASE_URL = "https://coda.io/apis/v1";
const DISPLAY_URL_MAX_LENGTH = 180;
let DATABASE_PROPERTIES = [];

const form = document.querySelector("#clipForm");
const submitButton = document.querySelector("#submitButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const locationsButton = document.querySelector("#locationsButton");
const locationsPanel = document.querySelector("#locationsPanel");
const refreshDocsButton = document.querySelector("#refreshDocsButton");
const saveLocationButton = document.querySelector("#saveLocationButton");
const deleteLocationButton = document.querySelector("#deleteLocationButton");
const addFieldButton = document.querySelector("#addFieldButton");
const databasePropertiesMenu = document.querySelector("#databasePropertiesMenu");
const databasePropertiesList = document.querySelector("#databasePropertiesList");
const selectedPropertiesEl = document.querySelector("#selectedProperties");
const manualPropertiesEl = document.querySelector("#manualProperties");
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
let savedLocationId = "";
let discoveryCache = null;
let savedLocations = [];
let selectedDatabaseProperties = [];
let manualPropertyValuesByLocation = {};
let isSavingBookmark = false;
let isLoadingDocs = false;
let isLoadingTables = false;
let areEventListenersBound = false;

document.addEventListener("DOMContentLoaded", async () => {
  bindEventListeners();

  try {
    await Promise.all([
      loadSettings(),
      loadDiscoveryCache(),
      loadSavedLocations(),
      loadSelectedDatabaseProperties(),
      loadManualPropertyValues(),
      loadCurrentTab(),
    ]);
    
    updateApiPreview();

    renderDatabaseProperties();
    renderSelectedProperties();
    renderSavedLocations();
    await applySavedLocation(findSavedLocation(fields.savedLocationId.value), { quiet: true });
    if (fields.codaToken.value.trim()) {
      renderCachedDocs({ quiet: true });
    }
  } catch (error) {
    console.error(error);
    setStatus(toSafeErrorMessage(error), "error");
  }
});

function bindEventListeners() {
  if (areEventListenersBound) {
    return;
  }

  areEventListenersBound = true;

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", updateApiPreview);
  form.addEventListener("change", updateApiPreview);
  settingsButton.addEventListener("click", toggleSettingsPanel);
  locationsButton.addEventListener("click", toggleLocationsPanel);
  refreshDocsButton.addEventListener("click", refreshDiscoveryCache);
  saveLocationButton.addEventListener("click", handleSaveLocation);
  deleteLocationButton.addEventListener("click", handleDeleteLocation);
  addFieldButton.addEventListener("click", toggleDatabasePropertiesMenu);

  fields.backendBaseUrl.addEventListener("change", saveSettings);
  fields.bookmarkApiKey.addEventListener("change", saveSettings);
  fields.codaToken.addEventListener("change", handleTokenChange);
  fields.docId.addEventListener("change", handleDocChange);
  fields.tableId.addEventListener("change", handleTableChange);
  fields.savedLocationId.addEventListener("change", handleSavedLocationChange);
  fields.savedLocationName.addEventListener("keydown", handleSavedLocationNameKeydown);
  databasePropertiesList.addEventListener("click", handleDatabasePropertyClick);
  manualPropertiesEl.addEventListener("input", handleManualPropertyInput);
  manualPropertiesEl.addEventListener("keydown", handleManualPropertyKeydown);
  manualPropertiesEl.addEventListener("click", handleManualPropertyClick);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
  savedDocId = stored.docId ?? "";
  savedTableId = stored.tableId ?? "";
  savedLocationId = stored.savedLocationId ?? "";

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
    if (!settings.savedLocationId && settings.backendBaseUrl && settings.bookmarkApiKey && settings.codaToken) {
      setLocationsPanelOpen(true);
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
        properties: getManualPropertyValuesForLocation(settings.savedLocationId, true),
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
    DATABASE_PROPERTIES = [];
    renderDatabaseProperties();
    renderSelectedProperties();
    renderManualProperties(null);
  } else {
    resetTableSelect("Select a doc first");
  }
}

async function handleTableChange() {
  savedTableId = fields.tableId.value;
  fields.savedLocationId.value = findSavedLocationId(savedDocId, savedTableId);
  savedLocationId = fields.savedLocationId.value;
  await saveSettings();
  
  await loadTableSchema(savedDocId, savedTableId);
  renderDatabaseProperties();
  renderSelectedProperties();
  renderManualProperties();
}

async function handleSavedLocationChange() {
  await applySavedLocation(findSavedLocation(fields.savedLocationId.value));
}

async function applySavedLocation(location, { quiet = false } = {}) {
  if (!location) {
    DATABASE_PROPERTIES = [];
    renderDatabaseProperties();
    renderSelectedProperties();
    renderManualProperties(null);
    return;
  }

  savedLocationId = location.id;
  savedDocId = location.docId;
  savedTableId = location.tableId;
  fields.savedLocationId.value = location.id;
  fields.savedLocationName.value = location.name;

  if (fields.docId.options.length > 1) {
    fields.docId.value = location.docId;
  }

  if (hasCacheForCurrentToken() && getCachedDoc(location.docId)) {
    renderCachedTables(location.docId, { selectedTableId: location.tableId, quiet: true });
  }

  await loadTableSchema(location.docId, location.tableId);

  selectedDatabaseProperties = normalizeSelectedProperties(location.selectedProperties);
  await saveSelectedDatabaseProperties();
  renderDatabaseProperties();
  renderSelectedProperties();
  renderManualProperties(location);
  await saveSettings();

  if (!quiet) {
    setStatus(`Selected saved location: ${location.name}.`, "success");
  }
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
  const doc = getCachedDoc(settings.docId);
  const location = {
    id: existing?.id ?? `location-${Date.now()}`,
    tokenFingerprint,
    name,
    docId: settings.docId,
    tableId: settings.tableId,
    docName: getSelectedOptionLabel(fields.docId),
    selectedProperties: selectedDatabaseProperties,
    tableName: getSelectedOptionLabel(fields.tableId),
    updatedAt: new Date().toISOString(),
  };

  savedLocations = existing
    ? savedLocations.map((item) => item.id === existing.id ? location : item)
    : [...savedLocations, location];

  await saveSavedLocations();
  renderSavedLocations({ selectedLocationId: location.id });
  renderManualProperties(location);
  setStatus(`Saved location: ${name}.`, "success");
}

async function handleDeleteLocation() {
  const currentId = fields.savedLocationId.value;
  if (!currentId) {
    setStatus("No saved location is currently selected.", "error");
    return;
  }

  const existing = savedLocations.find((location) => location.id === currentId);
  if (!existing) {
    return;
  }

  savedLocations = savedLocations.filter((location) => location.id !== currentId);
  await saveSavedLocations();

  const nextLocation = savedLocations.length > 0 ? savedLocations[0] : null;
  renderSavedLocations({ selectedLocationId: nextLocation?.id || "" });
  await applySavedLocation(nextLocation);
  
  setStatus(`Deleted location: ${existing.name}.`, "success");
}

function handleSavedLocationNameKeydown(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  handleSaveLocation();
}

function toggleDatabasePropertiesMenu() {
  const isOpen = addFieldButton.getAttribute("aria-expanded") !== "true";
  databasePropertiesMenu.hidden = !isOpen;
  addFieldButton.setAttribute("aria-expanded", String(isOpen));
  renderDatabaseProperties();
}

async function handleDatabasePropertyClick(event) {
  const button = event.target.closest("[data-property-id]");
  if (!button || button.disabled) {
    return;
  }

  const propertyId = button.dataset.propertyId;
  if (!DATABASE_PROPERTIES.some((property) => property.id === propertyId)) {
    return;
  }

  selectedDatabaseProperties = normalizeSelectedProperties([...selectedDatabaseProperties, propertyId]);
  await saveSelectedDatabaseProperties();
  renderDatabaseProperties();
  renderSelectedProperties();
  setStatus(`Added ${getDatabasePropertyLabel(propertyId)} field.`, "success");
}

async function handleManualPropertyInput(event) {
  const input = event.target.closest("[data-manual-property-id]");
  if (!input || input.dataset.propertyKind === "tokens") {
    return;
  }

  await setManualPropertyValue(input.dataset.manualPropertyId, input.value);
}

async function handleManualPropertyKeydown(event) {
  const input = event.target.closest("[data-token-input]");
  if (!input) {
    return;
  }

  if (event.key === "Backspace" && !input.value) {
    const propertyId = input.dataset.manualPropertyId;
    const values = getManualPropertyArrayValue(propertyId);
    if (values.length) {
      await setManualPropertyValue(propertyId, values.slice(0, -1));
      renderManualProperties();
    }
  }
}

async function handleManualPropertyClick(event) {
  const removeButton = event.target.closest("[data-remove-token]");
  if (removeButton) {
    const propertyId = removeButton.dataset.manualPropertyId;
    const token = removeButton.dataset.removeToken;
    const values = getManualPropertyArrayValue(propertyId).filter((item) => !isSameValue(item, token));
    await setManualPropertyValue(propertyId, values);
    renderManualProperties();
    return;
  }

  const tokenArea = event.target.closest("[data-token-area]");
  if (tokenArea) {
    tokenArea.querySelector("[data-token-input]")?.focus();
  }
}



function toggleSettingsPanel() {
  setSettingsPanelOpen(settingsButton.getAttribute("aria-expanded") !== "true");
}

function setSettingsPanelOpen(isOpen) {
  settingsPanel.hidden = !isOpen;
  settingsButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    setLocationsPanelOpen(false);
  }
}

function toggleLocationsPanel() {
  setLocationsPanelOpen(locationsButton.getAttribute("aria-expanded") !== "true");
}

function setLocationsPanelOpen(isOpen) {
  locationsPanel.hidden = !isOpen;
  locationsButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    setSettingsPanelOpen(false);
  } else {
    setDatabasePropertiesMenuOpen(false);
  }
}

function setDatabasePropertiesMenuOpen(isOpen) {
  databasePropertiesMenu.hidden = !isOpen;
  addFieldButton.setAttribute("aria-expanded", String(isOpen));
}

function getSettings() {
  const selectedLocation = findSavedLocation(fields.savedLocationId.value);
  return {
    backendBaseUrl: fields.backendBaseUrl.value.trim(),
    bookmarkApiKey: fields.bookmarkApiKey.value.trim(),
    codaToken: fields.codaToken.value.trim(),
    docId: selectedLocation?.docId ?? fields.docId.value.trim(),
    savedLocationId: fields.savedLocationId.value.trim(),
    tableId: selectedLocation?.tableId ?? fields.tableId.value.trim(),
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

async function loadSelectedDatabaseProperties() {
  const stored = await chrome.storage.local.get(SELECTED_PROPERTIES_KEY);
  selectedDatabaseProperties = normalizeSelectedProperties(stored[SELECTED_PROPERTIES_KEY]);
}

async function saveSelectedDatabaseProperties() {
  await chrome.storage.local.set({ [SELECTED_PROPERTIES_KEY]: selectedDatabaseProperties });
}

async function loadManualPropertyValues() {
  const stored = await chrome.storage.local.get(MANUAL_PROPERTY_VALUES_KEY);
  manualPropertyValuesByLocation = isPlainObject(stored[MANUAL_PROPERTY_VALUES_KEY]) ? stored[MANUAL_PROPERTY_VALUES_KEY] : {};
}

async function saveManualPropertyValues() {
  await chrome.storage.local.set({ [MANUAL_PROPERTY_VALUES_KEY]: manualPropertyValuesByLocation });
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
      columnsByTableId: {},
      optionsByColumnId: {}
    });

    renderCachedDocs({ selectedDocId, selectedTableId, refreshed: true });
    
    if (savedDocId && savedTableId) {
      await loadTableSchema(savedDocId, savedTableId);
      renderDatabaseProperties();
      renderSelectedProperties();
      renderManualProperties();
    }
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
    fields.savedLocationId.append(buildOption(location.id, formatSavedLocationLabel(location)));
  }

  fields.savedLocationId.disabled = locations.length === 0;
  if (deleteLocationButton) deleteLocationButton.disabled = locations.length === 0;

  const selectedId = selectedLocationId || savedLocationId || findSavedLocationId(savedDocId, savedTableId);
  if (selectedId && locations.some((location) => location.id === selectedId)) {
    fields.savedLocationId.value = selectedId;
    savedLocationId = selectedId;
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

function formatSavedLocationLabel(location) {
  return location.name;
}

function renderDatabaseProperties() {
  databasePropertiesList.replaceChildren();

  for (const property of DATABASE_PROPERTIES) {
    const isSelected = selectedDatabaseProperties.includes(property.id);
    const button = document.createElement("button");
    button.className = "btn btn-ghost btn-sm grid h-auto min-h-0 grid-cols-[2rem_1fr_auto] justify-items-start gap-2 px-1 py-1";
    button.type = "button";
    button.dataset.propertyId = property.id;
    button.disabled = isSelected;

    const icon = document.createElement("span");
    icon.className = "text-base-content/40";
    icon.textContent = property.icon;

    const label = document.createElement("span");
    label.className = "font-medium";
    label.textContent = property.label;

    const state = document.createElement("span");
    state.className = "text-base-content/50";
    state.textContent = isSelected ? "Already Added" : "";

    button.append(icon, label, state);
    databasePropertiesList.append(button);
  }
}

function renderSelectedProperties() {
  selectedPropertiesEl.replaceChildren();

  if (!selectedDatabaseProperties.length) {
    return;
  }

  for (const propertyId of selectedDatabaseProperties) {
    const badge = document.createElement("span");
    badge.className = "badge badge-soft badge-sm";
    badge.textContent = getDatabasePropertyLabel(propertyId);
    selectedPropertiesEl.append(badge);
  }
}

function renderManualProperties(location = findSavedLocation(fields.savedLocationId.value)) {
  manualPropertiesEl.replaceChildren();

  if (!location) {
    manualPropertiesEl.hidden = true;
    updateApiPreview();
    return;
  }

  const selectedProperties = normalizeSelectedProperties(location.selectedProperties);
  if (!selectedProperties.length) {
    manualPropertiesEl.hidden = true;
    updateApiPreview();
    return;
  }

  manualPropertiesEl.hidden = false;

  for (const propertyId of selectedProperties) {
    const property = getDatabaseProperty(propertyId);
    if (!property) {
      continue;
    }

    manualPropertiesEl.append(buildManualPropertyField(property, location.id));
  }
  
  updateApiPreview();
}

function buildManualPropertyField(property, locationId) {
  const wrapper = document.createElement("label");
  wrapper.className = "grid gap-1";

  const label = document.createElement("span");
  label.className = "label pb-1";

  const labelText = document.createElement("span");
  labelText.className = "text-xs font-semibold";
  labelText.textContent = property.label;

  label.append(labelText);
  wrapper.append(label);

  if (isMultiValueProperty(property)) {
    wrapper.append(buildTokenInput(property, locationId));
    return wrapper;
  }

  const input = document.createElement("input");
  input.className = "input input-sm w-full";
  input.dataset.manualPropertyId = property.id;
  input.type = property.type === "date" ? "date" : property.type === "url" ? "url" : "text";
  input.placeholder = getManualPropertyPlaceholder(property.id);
  input.value = getManualPropertyScalarValue(property.id);

  wrapper.append(input);
  return wrapper;
}

function buildTokenInput(property, locationId) {
  const area = document.createElement("div");
  area.className = "relative flex-1";

  const inputWrapper = document.createElement("div");
  inputWrapper.className = "flex flex-wrap items-center gap-1 rounded border border-base-300 bg-base-100 p-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30 transition";
  inputWrapper.dataset.tokenArea = "true";

  for (const token of getManualPropertyArrayValue(property.id)) {
    const chip = document.createElement("span");
    chip.className = "badge badge-soft gap-1 max-w-full";
    
    const textSpan = document.createElement("span");
    textSpan.className = "truncate";
    textSpan.textContent = token;

    const removeButton = document.createElement("button");
    removeButton.className = "btn btn-ghost btn-xs h-4 min-h-0 px-1 shrink-0";
    removeButton.type = "button";
    removeButton.dataset.manualPropertyId = property.id;
    removeButton.dataset.removeToken = token;
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${token}`);

    chip.append(textSpan, removeButton);
    inputWrapper.append(chip);
  }

  const input = document.createElement("input");
  input.className = "min-w-24 flex-1 bg-transparent px-1 py-1 text-sm outline-none";
  input.dataset.manualPropertyId = property.id;
  input.dataset.propertyKind = "tokens";
  input.dataset.tokenInput = "true";
  input.type = "text";
  input.placeholder = getManualPropertyArrayValue(property.id).length ? "" : "Add option";
  input.autocomplete = "off";

  inputWrapper.append(input);
  inputWrapper.addEventListener("click", () => input.focus());
  area.append(inputWrapper);

  const dropdown = document.createElement("ul");
  dropdown.className = "absolute mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-base-300 bg-base-100 py-1 shadow-xl";
  dropdown.style.zIndex = "100";
  dropdown.hidden = true;
  area.append(dropdown);

  bindAutocomplete(input, dropdown, property);

  return area;
}

function bindAutocomplete(input, dropdown, property) {
  let highlightIndex = -1;
  let menuItems = [];

  function getSuggestions(draft) {
    const allOptions = [...new Set((discoveryCache?.optionsByColumnId?.[property.id] || []).filter(Boolean).map(String))];
    const currentValues = getManualPropertyArrayValue(property.id);
    const normalizedDraft = normalizeValue(draft);
    const lowerDraft = normalizedDraft.toLowerCase();

    let filtered = allOptions.filter(item => {
      if (currentValues.some(selected => isSameValue(selected, item))) return false;
      if (!lowerDraft) return true;
      return item.toLowerCase().includes(lowerDraft);
    });

    if (lowerDraft) {
      filtered.sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(lowerDraft);
        const bStarts = b.toLowerCase().startsWith(lowerDraft);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });
    }
    
    filtered = filtered.slice(0, 3);

    const canCreate = normalizedDraft.length > 0 && 
                      !filtered.some(item => isSameValue(item, normalizedDraft)) && 
                      !currentValues.some(item => isSameValue(item, normalizedDraft)) &&
                      !allOptions.some(item => isSameValue(item, normalizedDraft));

    return canCreate ? [...filtered, null] : filtered;
  }

  function renderDropdown(draft) {
    menuItems = getSuggestions(draft);
    if (menuItems.length === 0) {
      dropdown.hidden = true;
      return;
    }
    
    dropdown.replaceChildren();
    menuItems.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = `cursor-pointer px-3 py-2 text-sm transition-colors break-words ${index === highlightIndex ? "bg-primary/10 text-primary" : "text-base-content hover:bg-base-200"}`;
      
      if (item === null) {
        li.innerHTML = `Create &ldquo;<span>${escapeHtml(normalizeValue(draft))}</span>&rdquo;`;
      } else {
        li.textContent = item;
      }
      
      li.addEventListener("mouseenter", () => {
        highlightIndex = index;
        const currentActive = dropdown.querySelector("li.bg-primary\\/10");
        if (currentActive) {
          currentActive.classList.remove("bg-primary/10", "text-primary");
          currentActive.classList.add("text-base-content", "hover:bg-base-200");
        }
        li.classList.remove("text-base-content", "hover:bg-base-200");
        li.classList.add("bg-primary/10", "text-primary");
      });
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", async (e) => {
        e.preventDefault();
        await commitToken(item === null ? normalizeValue(draft) : item);
      });
      
      dropdown.append(li);
    });
    dropdown.hidden = false;
  }

  async function commitToken(value) {
    input.value = "";
    highlightIndex = -1;
    dropdown.hidden = true;
    
    const nextToken = normalizeValue(value);
    if (!nextToken) return;

    const propertyId = input.dataset.manualPropertyId;
    let values = getManualPropertyArrayValue(propertyId);
    if (values.some(item => isSameValue(item, nextToken))) return;

    values = [...values, nextToken];

    await setManualPropertyValue(propertyId, values);
    renderManualProperties();
    
    setTimeout(() => {
      const newInput = document.querySelector(`input[data-manual-property-id="${propertyId}"]`);
      if (newInput) newInput.focus();
    }, 0);
  }

  input.addEventListener("input", () => {
    highlightIndex = -1;
    renderDropdown(input.value);
  });

  input.addEventListener("focus", () => {
    highlightIndex = -1;
    renderDropdown(input.value);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      dropdown.hidden = true;
    }, 150);
  });

  input.addEventListener("keydown", async (event) => {
    const itemCount = menuItems.length;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (dropdown.hidden) {
          renderDropdown(input.value);
        } else {
          highlightIndex = (highlightIndex + 1) % itemCount;
          renderDropdown(input.value);
        }
        break;

      case "ArrowUp":
        event.preventDefault();
        if (!dropdown.hidden) {
          highlightIndex = highlightIndex <= 0 ? itemCount - 1 : highlightIndex - 1;
          renderDropdown(input.value);
        }
        break;

      case "Enter":
        event.preventDefault();
        if (!dropdown.hidden && highlightIndex >= 0 && highlightIndex < itemCount) {
          const selected = menuItems[highlightIndex];
          await commitToken(selected === null ? normalizeValue(input.value) : selected);
        } else if (input.value) {
          await commitToken(input.value);
        }
        break;

      case ",":
        event.preventDefault();
        if (input.value) {
          await commitToken(input.value);
        }
        break;

      case "Escape":
        if (!dropdown.hidden) {
          event.preventDefault();
          dropdown.hidden = true;
          highlightIndex = -1;
        }
        break;
    }
  });
}

function escapeHtml(unsafe) {
    return (unsafe || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getManualPropertyPlaceholder(propertyId) {
  if (propertyId === "name") {
    return "Name";
  }

  if (propertyId === "url") {
    return "https://example.com";
  }

  return "";
}

async function commitTokenInput(input) {
  const propertyId = input.dataset.manualPropertyId;
  const nextToken = normalizeValue(input.value);
  input.value = "";

  if (!nextToken) {
    return;
  }

  const values = getManualPropertyArrayValue(propertyId);
  if (values.some((item) => isSameValue(item, nextToken))) {
    return;
  }

  await setManualPropertyValue(propertyId, [...values, nextToken]);
  renderManualProperties();
}

async function setManualPropertyValue(propertyId, value) {
  const locationId = fields.savedLocationId.value;
  if (!locationId) {
    return;
  }

  const existing = isPlainObject(manualPropertyValuesByLocation[locationId]) ? manualPropertyValuesByLocation[locationId] : {};
  manualPropertyValuesByLocation = {
    ...manualPropertyValuesByLocation,
    [locationId]: {
      ...existing,
      [propertyId]: value,
    },
  };

  await saveManualPropertyValues();
}

function getManualPropertyValuesForLocation(locationId, useLabels = false) {
  const location = findSavedLocation(locationId);
  if (!location) {
    return {};
  }

  const selectedProperties = normalizeSelectedProperties(location.selectedProperties);
  const storedValues = isPlainObject(manualPropertyValuesByLocation[locationId]) ? manualPropertyValuesByLocation[locationId] : {};
  const values = {};

  for (const propertyId of selectedProperties) {
    const property = getDatabaseProperty(propertyId);
    if (!property) continue;

    const key = useLabels ? property.label : propertyId;

    if (isMultiValueProperty(property)) {
      values[key] = Array.isArray(storedValues[propertyId]) ? storedValues[propertyId] : [];
      continue;
    }

    values[key] = typeof storedValues[propertyId] === "string" ? storedValues[propertyId].trim() : "";
  }

  return values;
}

function updateApiPreview() {
  const apiPreview = document.getElementById("apiPreview");
  if (!apiPreview) return;
  const settings = getSettings();
  
  const payload = {
    url: currentTabUrl || "Loading...",
    docId: settings.docId || "",
    tableId: settings.tableId || "",
    properties: settings.savedLocationId ? getManualPropertyValuesForLocation(settings.savedLocationId, true) : {}
  };
  
  apiPreview.textContent = JSON.stringify(payload, null, 2);
}

function getManualPropertyScalarValue(propertyId) {
  const values = getManualPropertyValuesForLocation(fields.savedLocationId.value);
  return typeof values[propertyId] === "string" ? values[propertyId] : "";
}

function getManualPropertyArrayValue(propertyId) {
  const values = getManualPropertyValuesForLocation(fields.savedLocationId.value);
  return Array.isArray(values[propertyId]) ? values[propertyId] : [];
}

function getDatabaseProperty(propertyId) {
  return DATABASE_PROPERTIES.find((property) => property.id === propertyId);
}

function isMultiValueProperty(property) {
  if (!property) {
    return false;
  }

  const type = String(property.type ?? property.kind ?? property.displayType ?? "").toLowerCase();
  const isSelectOrRelation = type.includes("select") || type.includes("relation") || type.includes("lookup") || type.includes("person");
  const allowsMultiple = Boolean(
    property.isMulti ||
    property.multiselect ||
    property.multiSelect ||
    property.multiple ||
    property.allowMultiple ||
    property.allowsMultiple
  );

  return isSelectOrRelation && allowsMultiple;
}

function getDatabasePropertyLabel(propertyId) {
  return getDatabaseProperty(propertyId)?.label ?? propertyId;
}

function normalizeSelectedProperties(properties) {
  if (!Array.isArray(properties)) {
    return [];
  }

  const allowedIds = new Set(DATABASE_PROPERTIES.map((property) => property.id));
  return [...new Set(properties.filter((propertyId) => allowedIds.has(propertyId)))];
}

function normalizeValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isSameValue(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "accent" }) === 0;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

async function loadTableSchema(docId, tableId) {
  if (!docId || !tableId) {
    DATABASE_PROPERTIES = [];
    return;
  }

  const token = fields.codaToken.value.trim();
  if (!token) return;

  if (discoveryCache?.columnsByTableId?.[tableId]) {
    DATABASE_PROPERTIES = discoveryCache.columnsByTableId[tableId];
    return;
  }

  setDiscoveryLoading({ docs: true, tables: true });
  setStatus("Loading table columns...", "loading");

  try {
    const columns = await fetchAllCodaItems(`${CODA_API_BASE_URL}/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/columns`, token);
    
    DATABASE_PROPERTIES = columns.map(col => {
      const type = String(col.format?.type ?? col.displayType ?? col.type ?? "").toLowerCase();
      return {
        id: col.id,
        label: col.name,
        icon: type === "text" ? "Aa" : type === "url" || type === "link" ? "🔗" : type.includes("date") ? "▣" : "↗",
        type: type,
        isMulti: Boolean(col.format?.isArray || type.includes("select") || type.includes("lookup") || type.includes("person") || type.includes("relation")),
        format: col.format
      };
    });

    if (!discoveryCache.columnsByTableId) discoveryCache.columnsByTableId = {};
    discoveryCache.columnsByTableId[tableId] = DATABASE_PROPERTIES;
    
    for (const prop of DATABASE_PROPERTIES) {
      const isRelation = prop.type.includes("lookup") || prop.type.includes("relation") || prop.type.includes("person");
      const targetTableId = prop.format?.table?.id || prop.format?.targetTableId;

      if (isRelation && targetTableId) {
        if (!discoveryCache.optionsByColumnId) discoveryCache.optionsByColumnId = {};
        if (!discoveryCache.optionsByColumnId[prop.id]) {
          try {
            const rows = await fetchAllCodaItems(`${CODA_API_BASE_URL}/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(targetTableId)}/rows?useColumnNames=true`, token);
            discoveryCache.optionsByColumnId[prop.id] = rows.map(r => r.name);
          } catch (e) {
            console.error("Failed to load options for", prop.label, e);
            discoveryCache.optionsByColumnId[prop.id] = [];
          }
        }
      } else if (prop.type.includes("select") && prop.format?.options) {
        if (!discoveryCache.optionsByColumnId) discoveryCache.optionsByColumnId = {};
        const opts = prop.format.options;
        discoveryCache.optionsByColumnId[prop.id] = opts.map(o => o.name || o);
      }
    }
    await saveDiscoveryCache(discoveryCache);

    setStatus("Loaded table columns.", "success");
    
    let debugArea = document.querySelector("#debugArea");
    if (!debugArea) {
      debugArea = document.createElement("textarea");
      debugArea.id = "debugArea";
      debugArea.className = "w-full p-2 mt-4 text-xs font-mono border rounded";
      debugArea.rows = 10;
      document.querySelector("main").appendChild(debugArea);
    }
    debugArea.value = JSON.stringify({
      options: discoveryCache.optionsByColumnId,
      props: DATABASE_PROPERTIES.map(p => ({id: p.id, type: p.type, format: p.format}))
    }, null, 2);

  } catch (error) {
    setStatus(toSafeErrorMessage(error), "error");
    DATABASE_PROPERTIES = [];
  } finally {
    setDiscoveryLoading({ docs: false, tables: false });
  }
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

  if (!settings.savedLocationId) {
    return "Select a saved location.";
  }

  if (!settings.docId) {
    return "Selected saved location is missing a Coda doc.";
  }

  if (!settings.tableId) {
    return "Selected saved location is missing a Coda table.";
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
  locationsButton.disabled = isBusy;
  refreshDocsButton.disabled = isBusy;
  saveLocationButton.disabled = isBusy;
  if (deleteLocationButton) deleteLocationButton.disabled = isBusy || fields.savedLocationId.options.length <= 1;
  addFieldButton.disabled = isBusy;
  setManualPropertiesDisabled(isBusy);
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
  locationsButton.disabled = isBusy;
  fields.savedLocationId.disabled = isBusy || fields.savedLocationId.options.length <= 1;
  refreshDocsButton.disabled = isBusy;
  if (deleteLocationButton) deleteLocationButton.disabled = isBusy || fields.savedLocationId.options.length <= 1;
  saveLocationButton.disabled = isBusy;
  addFieldButton.disabled = isBusy;
  setManualPropertiesDisabled(isBusy);
  submitButton.disabled = isBusy;
}

function setManualPropertiesDisabled(isDisabled) {
  for (const control of manualPropertiesEl.querySelectorAll("input, button")) {
    control.disabled = isDisabled;
  }
}

function setStatus(message, state = "") {
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.className = getStatusClassName(state);
  if (state) {
    statusEl.dataset.state = state;
  } else {
    delete statusEl.dataset.state;
  }
}

function getStatusClassName(state) {
  const baseClassName = "alert min-h-11 [overflow-wrap:anywhere] text-xs leading-snug";

  if (state === "success") {
    return `${baseClassName} alert-success`;
  }

  if (state === "error") {
    return `${baseClassName} alert-error`;
  }

  if (state === "loading") {
    return `${baseClassName} alert-info`;
  }

  return `${baseClassName} bg-base-100 text-base-content/70`;
}

function toSafeErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The bookmark could not be saved.";
}
