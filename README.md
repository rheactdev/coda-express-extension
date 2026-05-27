# Coda Express Clipper

A compact Chrome Manifest V3 extension for saving the current browser tab into a selected Coda table through the [`coda-express` bookmark backend](https://github.com/rheactdev/coda-express).

The extension reads the active tab URL, lets you choose a Coda doc and table, and sends the bookmark to:

```text
POST /api/save-bookmark
```

The backend remains responsible for scraping, extraction, workflow handling, schema inference, and inserting the row into Coda.

## Features

- Saves the current active tab URL to a selected Coda table.
- Sends both required backend credentials:
  - `x-api-key: <bookmark-api-key>`
  - `Authorization: Bearer <coda-token>`
- Keeps the Coda token behavior unchanged from the backend contract.
- Stores settings in Chrome extension storage.
- Loads accessible Coda docs and tables from the Coda API.
- Caches discovered docs and tables locally.
- Refreshes Coda docs/tables only when you click **Refresh**.
- Lets you save named doc/table destinations for quick reuse.
- Auto-closes the popup after a successful save.
- Truncates very long active-tab URLs in the popup while preserving the full URL for submission.
- Includes extension and toolbar icons from the `web/` folder.

## File Layout

```text
.
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── README.md
├── extension.md
└── web/
    ├── icons8-panda-glassmorphism-16.png
    ├── icons8-panda-glassmorphism-32.png
    ├── icons8-panda-glassmorphism-72.png
    ├── icons8-panda-glassmorphism-96.png
    ├── icons8-panda-glassmorphism-120.png
    ├── icons8-panda-glassmorphism-144.png
    ├── icons8-panda-glassmorphism-192.png
    └── icons8-panda-glassmorphism-512.png
```

This is a plain JavaScript Manifest V3 extension. There is no build step required.

## Requirements

- Google Chrome or another Chromium browser that supports Manifest V3 extensions.
- A running [`rheactdev/coda-express`](https://github.com/rheactdev/coda-express) bookmark backend that exposes:

  ```text
  POST /api/save-bookmark
  ```

- A private bookmark API key accepted by that backend.
- A Coda API token with access to the docs and tables you want to save into.

## Install Locally

1. Start your backend.

   For a local backend, this is commonly:

   ```sh
   pnpm run dev
   ```

2. Open Chrome.
3. Go to:

   ```text
   chrome://extensions
   ```

4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this extension folder:

   ```text
   /Users/donut/Desktop/Programs/tutorial.hello-world
   ```

7. Pin the extension from the Chrome extensions menu if you want quick toolbar access.

## Configure The Extension

Open the popup and click **Settings** next to the **Save to Coda** title.

Enter:

- **Backend URL**: the base URL for your bookmark backend, for example:

  ```text
  http://localhost:3000
  ```

- **Bookmark API key**: your private backend API key. This is sent as the `x-api-key` header.
- **Coda API token**: your Coda API token. This is sent as the `Authorization: Bearer ...` header.

The Settings panel opens automatically if you try to save or refresh without the required backend settings.

## First-Time Doc And Table Setup

After entering a Coda API token:

1. Click **Refresh** beside the Coda doc dropdown.
2. The extension fetches every Coda doc available to the token.
3. For each doc, it also fetches the tables in that doc.
4. The discovered docs and tables are cached locally.
5. Select the desired Coda doc.
6. Select the desired Coda table.

Opening the popup later uses the local cache. The extension does not call the Coda docs/tables APIs again unless you click **Refresh**.

## Save A Bookmark

1. Open a normal webpage tab.
2. Open the extension popup.
3. Confirm the displayed active URL.
4. Choose a Coda doc and table.
5. Click **Save bookmark**.

On success, the popup closes automatically.

The extension sends this JSON body to the backend:

```json
{
  "url": "https://example.com/page",
  "docId": "coda-doc-id",
  "tableId": "grid-table-id"
}
```

## Request Contract

The save request is sent to:

```text
POST <backend-url>/api/save-bookmark
```

Headers:

```http
Content-Type: application/json
x-api-key: <bookmark-api-key>
Authorization: Bearer <coda-token>
```

Body:

```json
{
  "url": "https://example.com/page",
  "docId": "coda-doc-id",
  "tableId": "grid-table-id"
}
```

The bookmark API key is never placed in the request body or query string. The Coda token is never placed in the request body or query string.

## Saved Locations

Saved locations let you reuse common Coda destinations.

To create one:

1. Select a Coda doc.
2. Select a Coda table.
3. Enter a name under **Save current location**, for example:

   ```text
   Wishlist
   ```

4. Click **Save**.

To use one:

1. Open the **Saved location** dropdown.
2. Choose the saved destination.
3. The popup switches the doc and table selectors to that saved location.

Saved locations are tied to the current Coda token fingerprint, so locations from one token are not shown for another token.

## Storage

The extension uses Chrome extension storage:

- `chrome.storage.sync`
  - `backendBaseUrl`
  - `bookmarkApiKey`
  - `codaToken`
  - `docId`
  - `tableId`

- `chrome.storage.local`
  - `codaDiscoveryCache`: cached Coda docs and tables.
  - `codaSavedLocations`: named doc/table destinations.

Sensitive values are stored only in Chrome extension storage and are sent only as request headers.

## Permissions

The manifest requests:

```json
{
  "permissions": ["activeTab", "storage", "tabs"],
  "host_permissions": ["<all_urls>"]
}
```

Why:

- `activeTab` and `tabs`: read the current active tab URL.
- `storage`: persist settings, cache, and saved locations.
- `<all_urls>`: allow fetches to the configured backend and Coda API.

## Development

Because this is a plain JavaScript extension, edit the source files directly:

- `popup.html`
- `popup.css`
- `popup.js`
- `manifest.json`

After changes:

1. Open `chrome://extensions`.
2. Click the refresh/reload button for the extension.
3. Open the popup again.

You can run a quick JavaScript syntax check with:

```sh
node --check popup.js
```

You can validate the manifest JSON with:

```sh
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"
```

## Troubleshooting

### Missing API Key

If you see:

```text
Bookmark API key is required.
```

Open **Settings** and enter the private backend API key.

### Missing Coda Token

If you see:

```text
Coda API token is required.
```

Open **Settings** and enter a Coda API token.

### Docs Do Not Appear

Click **Refresh** after entering or changing the Coda token. The extension uses its local cache until Refresh is clicked.

### Saved Location Cannot Be Used

If the saved doc or table is not in the current cache, click **Refresh**. The doc or table may have been renamed, deleted, moved, or the token may no longer have access.

### Backend Returns An Error

Confirm:

- The backend URL is correct.
- The backend is running.
- The bookmark API key matches the backend.
- The Coda token is valid.
- The selected doc and table are still accessible.

### Duplicate Workflow Logs

The extension sends one request to `/api/save-bookmark` per successful click. If you see multiple `/api/workflow/save-bookmark` logs, that is usually the backend workflow runner retrying a failed workflow request.

## Security Notes

- The bookmark API key is sent only in the `x-api-key` header.
- The Coda token is sent only in the `Authorization` header.
- Neither secret is sent in the JSON body.
- Neither secret is sent in the query string.
- Secrets are not written to popup status messages.
