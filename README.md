# Coda Express Chrome Extension

This Chrome Manifest V3 extension saves the active tab to a Coda table by calling the local `coda-express` backend.

## Load In Chrome

1. Start the backend from the repository root:

   ```sh
   pnpm run dev
   ```

2. Open Chrome and go to `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select this folder.

## Required Settings

Open the extension popup and enter:

- Backend URL, for example `http://localhost:3000`.
- Bookmark API key from the header **Settings** button.
- Coda API token from the header **Settings** button.
- Coda doc, selected from the docs the token can access.
- Coda table, selected from the tables in the chosen doc.

After you enter a Coda API token, click **Refresh** to load and locally cache every accessible doc plus each doc's tables. Opening the popup or changing the selected doc uses the local cache; the extension only calls the Coda API again when you click **Refresh**.

To reuse common destinations, select a doc and table, enter a friendly name under **Save current location**, and click **Save**. The saved-location dropdown can then switch the popup back to that doc and table quickly.

The extension stores these settings in `chrome.storage.sync`, reads the active tab URL, and sends:

```json
{
  "url": "https://example.com/page",
  "docId": "coda-doc-id",
  "tableId": "grid-table-id"
}
```

to:

```text
POST /api/save-bookmark
```

The bookmark API key is sent only as `x-api-key: <api-key>`. The Coda token is sent only as `Authorization: Bearer <token>`.
