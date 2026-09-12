# Google Sheets Sync — Setup Guide

Follow these steps ONCE before the sync will work.

---

## Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click **"New Project"** → name it anything (e.g. `JJU Backup`)
3. Click **"Create"**

---

## Step 2 — Enable the Google Sheets API

1. In your project, go to **APIs & Services → Library**
2. Search for **"Google Sheets API"** → click it → click **Enable**
3. Also search for **"Google Drive API"** → Enable that too

---

## Step 3 — Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **"+ Create Credentials" → "Service Account"**
3. Name it anything (e.g. `jju-sync`) → click **Create and Continue**
4. Skip the optional role/user steps → click **Done**
5. Click your new service account in the list
6. Go to the **"Keys"** tab → **"Add Key" → "Create new key"**
7. Choose **JSON** → click **Create**
8. A `.json` file downloads — **keep this safe, treat it like a password**

---

## Step 4 — Put the credentials file in your project

Copy the downloaded JSON file into your project root and rename it:

```
credentials/google-service-account.json
```

Your project structure should look like:
```
your-app/
  credentials/
    google-service-account.json   ← put it here
  controllers/
    sync.controller.js
  ...
```

---

## Step 5 — Create the Google Sheet

1. Go to https://sheets.google.com → create a **New Spreadsheet**
2. Name it (e.g. `JJU Database Backup`)
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```
4. Open your service account JSON file — find the `"client_email"` field
5. In Google Sheets, click **Share** → paste that email → give it **Editor** access

---

## Step 6 — Configure your .env file

Add these lines to your `.env` file (create one in project root if it doesn't exist):

```env
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/google-service-account.json
GOOGLE_SPREADSHEET_ID=paste_your_spreadsheet_id_here
```

---

## Step 7 — Install the Google API package

Run in your project root:

```bash
npm install googleapis
```

---

## Step 8 — Add sync schedule (optional)

If you want automatic nightly sync, add this to your `.env`:

```env
SYNC_CRON_SCHEDULE=0 2 * * *
```
This runs at 2:00 AM every night. Adjust the cron expression as needed:
- `0 0 * * *` = midnight
- `0 22 * * *` = 10 PM
- `0 2 * * *` = 2 AM

---

## Done!

Once set up, the sync button in the app will push all your data to Google Sheets automatically.
The spreadsheet will have separate tabs for: **Records**, **Cashbook**, **Customers**, **Sync Log**.
