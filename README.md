# Smart Campus Lost-and-Found Management System

Course project for **DevOps and Full Stack Development** (SR University, School of CS & AI).
A role-based web application where students/staff report lost and found items, search and claim them, officers verify
ownership and arrange handover, and administrators manage users, master data and reports.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Responsive single-page app in vanilla HTML/CSS/JS (no inline scripts or styles; CSP-safe) |
| Backend | Node.js 22 + Express 4 REST API |
| Database | SQLite (relational, built-in `node:sqlite`) – schema in `db/schema.sql` |
| Auth | bcrypt password hashes, signed JWT (8 h), server-side role checks on every request |
| Files | Multer uploads to a private directory; images served only through authenticated endpoints |
| DevOps | Git/GitHub, GitHub Actions CI/CD, Docker (multi-stage), Docker Compose, Kubernetes manifests |

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm start              # http://localhost:3000
npm run lint
npm test               # 19 API tests
node scripts/seed-demo.js   # optional: loads demo reports (server must be running)
```

Environment variables: `PORT`, `DATA_DIR` (DB + uploads, default `./data`), `JWT_SECRET` (**required** when `NODE_ENV=production`),
`ADMIN_PASSWORD`, `OFFICER_PASSWORD`.

### Demo accounts (seeded on first start)

| Role | Email | Password |
|---|---|---|
| Administrator | admin@sru.edu.in | `Admin@123` |
| Lost-and-Found Officer | officer@sru.edu.in | `Officer@123` |
| Student / Staff | register from the login screen | – |

Change the seeded passwords with `ADMIN_PASSWORD` / `OFFICER_PASSWORD` before any real deployment.
Self-registration always creates a *student* account; only an administrator can promote users.

## Screens (rubric §2.4)

1. Login / Registration · 2. Role-based Dashboard · 3. Report Lost Item · 4. Report Found Item · 5. Browse and Search ·
6. Item Details (+ claim form, match suggestions) · 7. My Reports and Claims · 8. Officer Review Panel · 9. Admin Management and Reports.
Screenshots from the running app are in `docs/screenshots/`.

## API summary

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| POST | /api/auth/register | Create student account | Public |
| POST | /api/auth/login | Authenticate, returns JWT | Public (rate-limited) |
| GET | /api/auth/me | Current user | Authenticated |
| GET | /api/meta | Categories and locations | Public |
| POST | /api/items | Create lost/found report (multipart, optional image) | Authenticated |
| GET | /api/items | Search/filter (type, category_id, location_id, status, q, from, to) | Authenticated |
| GET | /api/items/mine | Own reports | Authenticated |
| GET | /api/items/{id} | Item details (contact/custody only for owner and staff) | Authenticated |
| GET | /api/items/{id}/matches | Suggested matches | Owner / staff |
| GET | /api/items/{id}/image | Item photo | Authenticated |
| PATCH | /api/items/{id}/status | Close / reopen / mark returned | Owner (lost) / staff |
| POST | /api/items/{id}/claims | Submit claim with optional evidence | Authenticated |
| GET | /api/claims/mine | Own claims | Authenticated |
| GET | /api/claims?status= | Review queue | Officer / Admin |
| GET | /api/claims/{id}/evidence | Evidence image | Claimant / staff |
| PATCH | /api/claims/{id}/review | approve / reject / more_info | Officer / Admin |
| PATCH | /api/claims/{id}/respond | Claimant answers an info request | Claimant |
| POST | /api/claims/{id}/handover | Record handover, item becomes returned | Officer / Admin |
| GET | /api/reports/dashboard | Role-based counts | Authenticated |
| GET | /api/reports/summary | Category/location/month summary | Officer / Admin |
| GET | /api/reports/items · pending-claims · returned | Mandatory reports (`?format=csv`) | Officer / Admin |
| GET/PATCH | /api/admin/users | List users, change role/status | Admin |
| POST/DELETE | /api/admin/categories · locations | Master data | Admin |
| GET | /api/admin/audit | Audit log | Admin |
| GET | /api/health · /api/metrics | Health probe, Prometheus-style counters | Public |

## Docker

```bash
docker compose up --build            # http://localhost:3000, data kept in the lostfound-data volume
# or
docker build -t campus-lost-found:latest .
docker run --rm -p 3000:3000 -e JWT_SECRET=$(openssl rand -hex 32) -v lostfound-data:/data campus-lost-found:latest
```

## Kubernetes (Minikube example)

```bash
minikube image build -t campus-lost-found:latest .
kubectl apply -f k8s/secret.yaml -f k8s/pvc.yaml -f k8s/deployment.yaml -f k8s/service.yaml
kubectl rollout status deployment/lostfound
kubectl port-forward service/lostfound 8080:80      # http://localhost:8080
```

One replica with a `Recreate` strategy is deliberate: the database is a SQLite file on a ReadWriteOnce volume.
To scale horizontally, move to PostgreSQL/MySQL (the SQL in `db/schema.sql` is standard apart from a few SQLite-specific types).
`k8s/secret.yaml` holds demo values only – create real secrets with `kubectl create secret`.

## CI/CD (`.github/workflows/ci.yml`)

`push`/`pull_request` → checkout → `npm ci` → lint → unit/API tests → Docker build → run container and poll `/api/health` →
(on `main`) push image to GitHub Container Registry.

## Security notes

Passwords hashed with bcrypt; login rate-limited; role checked server-side on every route and re-read from the DB per request
(disabled accounts lose access immediately); parameterised SQL everywhere; uploads limited to 2 MB JPEG/PNG/WebP with magic-byte
verification; claim evidence and contact details are never in public responses; CSV export neutralises spreadsheet formulas;
CSP, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` headers; container runs as a non-root user.

## Known limitations

Prototype scope: no email/SMS notifications, no campus SSO, single-instance SQLite storage, JWTs are not revocable before expiry
(mitigated by per-request account status checks), and `node:sqlite` is still flagged *experimental* by Node.
