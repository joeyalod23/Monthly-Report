# 📊 Monthly Meeting Report

A responsive, mobile-friendly web app that loads your monthly-meeting agenda items **per project**, with all data editable from the browser:

- 🧹 **5S of Project** — current photos of offices / barracks (photoupload)
- 👷 **Manpower Headcount** — active / balance PRF / transferred
- 📑 **Contracts** — pending / ongoing / issues
- ⏱ **Overtime** — a Jan–Dec hours matrix per project **per year**. Add each month's hours at its monthly meeting and compare *any two months* with a % change (increasing / decreasing).

**Architecture**
- Frontend: pure HTML/CSS/JS → runs for free on **GitHub Pages**
- Database: **Google Sheets** (all records live there)
- File storage: **Google Drive** (5S photos uploaded automatically)
- Backend: a Google Apps Script **Web App** that connects the two

```
GitHub Pages (static site)  ──fetch/save──▶  Apps Script Web App  ──▶  Google Sheets
                                                    │
       5S photos (base64 → Drive) ◀────────────────┘
```

---

## 1. One-time Google setup (~5 min)

1. Go to <https://sheets.new> → create a spreadsheet (any name, e.g. `Monthly Meeting DB`). Keep it open.
2. Open **Extensions ▸ Apps Script**. Delete the default `function myFunction(){}` and paste the entire contents of **`apps-script/Code.gs`**.
3. *(Recommended)* Make a folder in Google Drive for the photos and copy its Folder ID.
   Put it at the top of `Code.gs`:
   ```js
   var FOLDER_ID = '1AbCdefGhijKlmNoPQrsTUvWxyZ';   // '' = My Drive
   ```
4. *(Optional but recommended)* Generate a key and use it in **both** `Code.gs` and the frontend:
   ```js
   var API_KEY = 'pick-a-long-random-string';
   ```
   Tip: generate one in your browser console with `crypto.randomUUID()`.
5. Deploy the Web App:
   - Click **Deploy ▸ New deployment**.
   - Choose type **Web app**.
   - Description: `monthly-meeting-api`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone with Google account` *(or `Anyone`)*
   - Click **Deploy**, then **Authorize access** (accept the "not verified" prompt — this is your own script; choose *Advanced ▸ Go to project* if it appears).
   - Copy the **`/exec` URL** shown (e.g. `https://script.google.com/macros/s/AKfycb…/exec`).

> **After any edit to `Code.gs` you must push a new version:** Deploy ▸ Manage deployments ▸ ✎ edit ▸ **Version: New** ▸ Deploy. The Overtime sheet below is auto-created (or auto-migrated from the old July/August layout) on first use.

> The 4 sheets (`5S`, `Manpower`, `Contracts`, `Overtime`) are **created automatically** with the right headers the first time the app is used.

---

## 2. Configure the frontend

Edit **`js/config.js`** in this project:

```js
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb…/exec";   // your /exec URL
const API_KEY           = "your-key-here";                                     // same as Code.gs (or "")
```

Use a spreadsheet **that the Apps Script can access**: either the spreadsheet where the script is bound, or one explicitly shared with the script owner's account.

---

## 3. Put the site on GitHub (frontend runs in GitHub)

This project is already deployed: **https://joeyalod23.github.io/Monthly-Report/**

Every future push to the repo auto-publishes the update (Pages is set to branch `master` / root):

```bash
git add .
git commit -m "update"
git push
```

*(If you re-host under a different account/repo, just enable GitHub Pages on your repo: Settings ▸ Pages ▸ Source ▸ Deploy from a branch ▸ main/master ▸ / (root).)*

> ⚠️ You only deploy the static site to GitHub. The Google **URL and API key live in `js/config.js`**, which will be visible in your (public or private) repo and in the browser. Anyone with your link can read **and** write data. For extra protection, restrict who opens the apps-script Web App (`Anyone with Google account`), use a long API key as a deterrent for random bots, and keep photo spam limited by Drive's daily quotas. For confidential data, consider keeping the repo private.

---

## 4. Usage

- **Overview** tab shows summary cards plus the selected overtime months comparison with % change.
- Each data tab has **＋ Add** / **Edit** / **Delete** controls.
- **Overtime**: each save writes one month's hours into that project's Jan–Dec row. Use the **Compare** dropdowns to view any two months side-by-side (total, average per project, % change, and per-project bars). The highlighted month columns in the table match your chosen comparison.
- 5S form accepts multiple photos per entry (auto-resized to ≤1280 px, uploaded to Drive, then shown on the card). Click any photo for full-size view.
- A **Refresh** button re-reads everything from Google Sheets.

## Project layout

```
├── index.html          # single responsive page (5 tabs)
├── css/style.css
├── js/
│   ├── config.js       # ← GOOGLE_SCRIPT_URL + API_KEY
│   └── app.js          # layout + CRUD + upload + overview logic
├── apps-script/
│   └── Code.gs         # ← paste into Google Apps Script
└── README.md
```