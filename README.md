# JJU Bank Dashboard — Complete Setup Guide

## Project Structure
```
jju-bank/
├── backend/
│   ├── server.js                    ← Entry point (port 4001)
│   ├── db/
│   │   ├── pool.js                  ← PostgreSQL connection pool
│   │   └── migrations.js            ← Creates ALL tables on startup
│   ├── routes/
│   │   ├── records.routes.js        ← /api/records/*
│   │   ├── cashbook.routes.js       ← /api/cashbook/*
│   │   └── sync.routes.js           ← /api/sync-sheets/*
│   ├── controllers/
│   │   ├── records.controller.js    ← Full records CRUD + stats + process-transaction
│   │   ├── cashbook.controller.js   ← Cashbook CRUD
│   │   └── sync.controller.js       ← Sync status
│   └── middleware/
│       └── errorHandler.js
├── frontend/
│   └── index.html                   ← Your v24 frontend (URLs fixed to relative paths)
├── .env                             ← DB credentials
└── package.json
```

---

## Database Tables Created Automatically

| Table | Purpose |
|-------|---------|
| `records` | Master transaction table — every form submission |
| `cashbook_entries` | Daily cashbook rows (debit/credit ledger) |
| `customers` | Customer master — auto-upserted on every save |
| `gold_loans` | Active/closed gold loan tracker |
| `fd_accounts` | Fixed deposit account tracker |
| `saving_accounts` | Saving account balance tracker |
| `od_loans` | FD-OD loan tracker |
| `memberships` | Sadasya / Naammatr Sabhasad membership |
| `sync_log` | Google Sheets sync history |
| `users` | Admin users (for future login) |

All tables are created automatically when the server first starts. You don't need to run any SQL manually.

---

## Setup

### 1. Create PostgreSQL database
```sql
CREATE USER jju_user WITH PASSWORD 'jju_pass123';
CREATE DATABASE jju_bank OWNER jju_user;
GRANT ALL PRIVILEGES ON DATABASE jju_bank TO jju_user;
```

### 2. Configure .env
```
PORT=4001
DB_USER=jju_user
DB_HOST=localhost
DB_NAME=jju_bank
DB_PASSWORD=jju_pass123
DB_PORT=5432
```

### 3. Install & Run
```bash
npm install
npm run dev      # development (auto-restart)
npm start        # production
npm run pm2      # background with PM2
```

### 4. Open browser
```
http://localhost:4001
```

---

## API Reference

### Records
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/records` | List with filters: `?section=gold&status=active&limit=50&offset=0&date_from=&date_to=&q=` |
| GET | `/api/records/stats` | Dashboard stats (KPIs, section counts, recent records) |
| GET | `/api/records/deleted` | Soft-deleted records |
| GET | `/api/records/:id` | Single record |
| POST | `/api/records` | Create record |
| PUT | `/api/records/:id` | Update record |
| DELETE | `/api/records/:id` | Soft delete |
| PATCH | `/api/records/:id/close` | Close account |
| PATCH | `/api/records/:id/reopen` | Reopen account |
| PATCH | `/api/records/:id/restore` | Restore from trash |
| DELETE | `/api/records/:id/permanent` | Permanent delete |
| POST | `/api/records/process-transaction` | Update derived tables after save |
| POST | `/api/records/import/bulk` | Bulk import |
| GET | `/api/records/next-loan-no/:prefix` | Auto-suggest next loan number |
| GET | `/api/records/check-loan-no/:no` | Check if loan acc no exists |
| GET | `/api/records/next-fd-acc-no/:prefix` | Auto-suggest next FD account |
| GET | `/api/records/check-fd-acc-no/:no` | Check FD acc no |
| GET | `/api/records/next-mis-acc-no/:prefix` | Auto-suggest next MIS account |
| GET | `/api/records/check-mis-acc-no/:no` | Check MIS acc no |
| GET | `/api/records/customers/search?q=` | Customer autocomplete search |

### Cashbook
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cashbook?date=YYYY-MM-DD` | Entries for a date |
| GET | `/api/cashbook/deleted` | Soft-deleted entries |
| POST | `/api/cashbook/bulk` | Bulk insert entries |
| PUT | `/api/cashbook/:id` | Update entry |
| PATCH | `/api/cashbook/:id/soft-delete` | Soft delete |
| PATCH | `/api/cashbook/:id/restore` | Restore |
| DELETE | `/api/cashbook/:id` | Permanent delete |

### Sync
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync-sheets/status` | Check sync status |
| POST | `/api/sync-sheets` | Trigger sync |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | DB connection check |

---

## How Data Flows

```
User fills form in index.html
        ↓
POST /api/records  →  records table (source of truth)
        ↓
POST /api/records/process-transaction
        ↓
  Updates derived tables:
  ├── gold_loans      (Gold Loan / Closing - Loan)
  ├── fd_accounts     (New FD / Closing - FD)
  ├── od_loans        (New FD-OD / Closing - OD)
  ├── saving_accounts (Saving Account / Deposit / Withdrawal)
  ├── memberships     (New Sadasya / Naammatr Sabhasad)
  └── customers       (upserted on every save)
        ↓
POST /api/cashbook/bulk
  → cashbook_entries table (daily ledger)
```
