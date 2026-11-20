# PeopleFlow HR Agent

PeopleFlow is a policy-led HR Agent workspace with a real SQLite database, role-based access control, policy versioning, approval gates, document uploads, audit logging, and calculation APIs.

## Requirements

- Node.js 22 or newer. Node 26 is recommended because it provides the built-in `node:sqlite` module used by this project.

## Run locally

```powershell
node server.js
```

Open <http://localhost:3000>.

Set `PEOPLEFLOW_EMPLOYEE_PASSWORD`, `PEOPLEFLOW_HR_PASSWORD`, and `PEOPLEFLOW_ADMIN_PASSWORD` before the first start to provision local accounts. Passwords are never rendered in the UI or committed to the repository. The database is created at `data/peopleflow.sqlite`; uploaded PDF/DOC/DOCX files are stored in `data/uploads/`.

## Test

```powershell
npm.cmd test
```

The test suite covers salary privacy, self-approval, recorded approval gates, leave, attendance, overtime, HR/Admin policy permissions, draft visibility, knowledge-base updates, bilingual UTF-8 content, and upload type validation.

## Environment variables

- `PORT` — HTTP port, default `3000`.
- `PEOPLEFLOW_TOKEN_SECRET` — required in production; use a long random secret for signed session tokens.
- `PEOPLEFLOW_EMPLOYEE_PASSWORD`, `PEOPLEFLOW_HR_PASSWORD`, `PEOPLEFLOW_ADMIN_PASSWORD` — first-run account passwords. Required for controlled deployments.

## Data model

The SQLite schema is initialized by `server.js` and includes `users`, `policies`, `policy_versions`, `policy_files`, `requests`, `approvals`, `leave_balances`, `attendance_records`, `overtime_records`, `knowledge_base_updates`, and `audit_logs`.

Approved policies are the only policies returned to employees. Drafts are visible only to HR and Admin. Approving a policy writes a `knowledge_base_updates` record so the assistant knowledge layer can consume the new version.
