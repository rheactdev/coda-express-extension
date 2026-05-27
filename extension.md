# Codex Prompt: Build The Matching Chrome Extension

You are an expert Chrome Extension developer. Build a production-ready Chrome extension that pairs a `coda-express` backend API.

## Goal

Create a Chrome Manifest V3 extension that lets a user save the current browser tab into a selected Coda table by directly calling this backend endpoint:

```text
POST /api/save-bookmark
```

The backend expects this JSON payload:

```json
{
  "url": "https://example.com/page",
  "docId": "coda-doc-id",
  "tableId": "grid-table-id"
}
```

The extension must send the user's Coda API token securely as:

```text
Authorization: Bearer <coda-token>
```

The backend then uses Upstash Workflow, Firecrawl, Vercel AI Gateway, and the Coda API to scrape the URL, dynamically infer the selected table schema, extract structured data, and insert a row into that table.

## Required Extension Behavior

Implement a Chrome extension that provides a simple clipping flow:

1. Let the user configure and persist:
   - Backend base URL, such as `http://localhost:3000` or the deployed Vercel URL.
   - Coda API token.
   - Coda doc ID.
   - Coda table ID.
2. Read the active tab URL when the popup opens.
3. Show the URL that will be clipped.
4. Let the user submit the clip request.
5. Call `${backendBaseUrl}/api/save-bookmark` with:
   - HTTP method `POST`.
   - JSON body containing only `url`, `docId`, and `tableId`.
   - `Authorization: Bearer <coda-token>`.
   - `Content-Type: application/json`.
6. Show a clear loading, success, and failure state.
7. On success, display any `workflowRunId` returned by the backend.

## Technical Requirements

- Use Chrome Manifest V3.
- Prefer a small TypeScript implementation with a local build step if this repo already has TypeScript tooling available.
- Keep the extension code separate from the Express server code, for example under `extension/`.
- Include complete source files, build config, and instructions needed to load the unpacked extension in Chrome.
- Use `chrome.storage.sync` or `chrome.storage.local` for settings.
- Use `chrome.tabs.query` to get the active tab URL.
- Use a popup UI for the main clipping workflow.
- Add host permissions for:
  - The configured backend URL pattern needed for `fetch`.
  - Active tab access.
- Do not call Firecrawl, Vercel AI Gateway, Upstash, or the Coda rows API directly from the extension. The backend owns that work.
- Do not attempt to build the dynamic AI extraction schema in the extension. The backend does it dynamically from the selected Coda table.
- Treat the Coda token as sensitive:
  - Do not log it.
  - Do not show it in success or error output.
  - Do not put it in the JSON request body.
  - Store it only in Chrome extension storage.
- Validate all required fields before calling the backend.
- Make backend URL handling robust:
  - Accept a base URL without a trailing slash.
  - Build the endpoint as `${baseUrl}/api/save-bookmark`.
- Keep the UI compact and practical. This is a utility popup, not a marketing page.

## Expected Backend Response

The backend currently returns success like:

```json
{
  "ok": true,
  "workflowRunId": "wfr_..."
}
```

It may return failure like:

```json
{
  "ok": false,
  "error": "Bookmark was accepted, but the background workflow could not be started."
}
```

Handle both shapes. Also handle non-JSON errors and network failures cleanly.

## Suggested File Structure

Create something close to:

```text
extension/
  package.json
  tsconfig.json
  manifest.json
  src/
    popup.html
    popup.ts
    popup.css
  dist/
    manifest.json
    popup.html
    popup.js
    popup.css
```

You may adjust this structure if a simpler MV3 extension setup is more appropriate for the repository.

## Suggested Popup Flow

The popup should include:

- Backend URL input.
- Coda API token password input.
- Coda doc ID input.
- Coda table ID input.
- Current tab URL display.
- `Save bookmark` button.
- Status area for validation errors, request progress, success, and backend errors.

Persist settings when edited or when the form is submitted. The user should not need to re-enter settings every time they open the popup.

## Existing Backend Contract Summary

The backend is an Express TypeScript app in `server.ts` with:

- `POST /api/save-bookmark`: validates `{ url, docId, tableId }`, reads the Coda token from `Authorization: Bearer ...`, triggers Upstash Workflow, and returns immediately.
- `POST /api/workflow/save-bookmark`: workflow worker that scrapes the page, fetches the selected Coda table schema, dynamically builds a Zod schema, calls Vercel AI Gateway with zero data retention, and writes a row to Coda.

The Chrome extension should only publish clipping requests into `/api/save-bookmark`.

## Quality Bar

- Produce complete, runnable extension code, not just a sketch.
- Keep changes focused on the extension/backend boundary.
- Include local development commands.
- Include clear instructions for loading the built `extension/dist` directory as an unpacked extension.
- Run type checks or build commands if available.
- Avoid unrelated changes to the Express backend unless they are required for browser extension calls.
- If CORS blocks extension requests, update the backend in the smallest reasonable way to allow requests from the extension origin while preserving JSON validation and bearer-token handling.
