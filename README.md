# HackerGuardian Web

HackerGuardian's web control plane and replay viewer.

## Architecture

- `frontend/` — React + TypeScript + Vite
- `backend/` — Laravel 12 API
- Browser talks only to Laravel over `/api/v1/*`
- Laravel owns authentication, authorization, auditing, queues, and HackerGuardian API credentials
- Laravel communicates with HackerGuardian servers/proxies through the signed HG API; it does not connect directly to the plugin database

## Development target

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8000
```

Vite proxies `/api` and `/sanctum` requests to Laravel during development. Production is intended to use one origin, e.g. `https://hg.example.com/` for React and `https://hg.example.com/api/*` for Laravel.

## Initial roadmap

1. Laravel API foundation
2. React application shell
3. Sanctum session authentication
4. roles/permissions and panel audit log
5. HackerGuardian signed API gateway
6. dashboard
7. reports/moderation
8. replay library
9. chunked replay viewer
10. detection/learning controls and live events
