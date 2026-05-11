# Tresa Driver Entry System

Web app for tracking cab driver duties, calculating expenses, driver salaries, and verifying vendor payments.
Hosted on **GitHub Pages** · Backend: **Google Sheets + Apps Script** (free).

---

## Salary Rules Implemented

| Rule | Detail |
|------|--------|
| Basic Salary | ₹26,000 / month per driver |
| Overtime | ₹100 / hr for hours **outside 08:00–20:00** (non-Outstation) |
| Sunday Bonus | +₹1,000 for any duty on a Sunday |
| Outstation | Flat ₹500 / day. If duty extends **≥30 min past midnight** → +₹500 for next day |

Example: Start 15:00 → End 01:30 = OT from 20:00 to 01:30 = **5.5 hrs × ₹100 = ₹550**

---

## Setup (One-time, ~10 minutes)

### Step 1 – Create the Google Sheets backend

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
2. Open **Extensions → Apps Script**.
3. Delete any existing code. Paste the entire contents of **`apps-script/Code.gs`** from this repo.
4. Click **Save** (💾).
5. Click **Deploy → New deployment**.
   - Click the ⚙️ gear next to "Type" → select **Web app**
   - Description: `Tresa API`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**
6. Click **Authorize access** → follow the Google sign-in prompts.
7. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/AKfy.../exec`).

> **Important:** Every time you edit Code.gs, you must create a **new deployment** for changes to take effect.

### Step 2 – Configure the app

Open **`js/config.js`** and update:

```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_ID/exec',  // paste here
DASHBOARD_PASSWORD: 'your-secret-password',                            // change this
```

### Step 3 – Enable GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Source: **Deploy from branch** → **main** → **/ (root)** → Save.
4. Wait ~60 seconds. Your app will be live at:
   `https://yourusername.github.io/tresadriverentry/`

---

## Usage

| Who | URL | Purpose |
|-----|-----|---------|
| Drivers | `/` (index.html) | Log duty details |
| Owner | `/dashboard.html` | View all duties, generate salary & vendor reports |

### Driver entry form
- Select driver name, vehicle, duty date
- Fill in vendor, duty number, type, km readings, times
- Enter expenses (parking, toll, MCD, state tax, misc)
- Record fuel if filled
- **Live preview** shows overtime / allowance earned before submitting

### Owner dashboard
- **Overview** – filter duties by date / driver / vendor / type; per-driver summary cards
- **Salary Report** – pick a month → gross salary per driver: Basic + OT + Outstation + Sunday bonus + per-duty breakdown
- **Vendor Report** – pick a date range → all duty numbers per vendor for payment reconciliation
- **Export CSV** at any time

---

## Changing Drivers / Vehicles / Vendors

Edit the arrays in **`js/config.js`**. No other files need changing.

---

## Project Structure

```
tresadriverentry/
├── index.html          ← Driver duty entry form
├── dashboard.html      ← Owner dashboard (password protected)
├── css/styles.css      ← All styles
├── js/
│   ├── config.js       ← Drivers, vehicles, vendors, API URL
│   ├── salary.js       ← Overtime & allowance calculation engine
│   ├── form.js         ← Entry form logic
│   └── dashboard.js    ← Dashboard logic
├── apps-script/
│   └── Code.gs         ← Paste into Google Apps Script
└── .nojekyll
```
