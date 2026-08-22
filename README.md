# HackerGuardian Web

HackerGuardian's web control plane and investigation-grade replay viewer.

## Architecture

- `frontend/` — React + TypeScript + Vite
- `backend/` — Laravel 12 API
- Browser talks only to Laravel over `/api/v1/*`
- Laravel owns authentication, authorization, auditing, queues, local render assets, and HackerGuardian API credentials
- Laravel communicates with HackerGuardian servers/proxies through the signed HG API; it does not connect directly to the plugin database

## Development target

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8000
```

Vite proxies `/api` and `/sanctum` requests to Laravel during development. Production is intended to use one origin, e.g. `https://hg.example.com/` for React and `https://hg.example.com/api/*` for Laravel.

## Local bootstrap

From `backend/`:

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan hg:user:create
php artisan serve
```

`hg:user:create` asks interactively for the email address, display name and password. Password input is hidden and is never passed on the command line.

From `frontend/`:

```bash
npm install
npm run dev
```

## Minecraft-faithful replay render assets

The replay renderer can use the real blockstate JSON, model JSON and textures from a Minecraft Java client/resource pack. **HackerGuardian does not redistribute or commit those game assets.** Each deployment imports assets locally from files the operator already has access to, and the resulting files remain under `backend/storage/app/minecraft-assets/`.

For example, import the client JAR matching the Minecraft version recorded by a replay:

```bash
cd backend
php artisan hg:assets:import ~/.minecraft/versions/1.21.11/1.21.11.jar \
  --id=1.21.11 \
  --version=1.21.11
```

If the server uses a resource pack, apply it as an overlay so its block models/textures override the vanilla layer:

```bash
php artisan hg:assets:import ~/.minecraft/versions/1.21.11/1.21.11.jar \
  --id=my-server-pack \
  --version=1.21.11 \
  --overlay=/path/to/server-resource-pack.zip
```

Then set the Paper replay configuration to the same local pack id:

```yaml
Replays:
  world_capture:
    resource_pack_id: "my-server-pack"
```

When `resource_pack_id` is empty, the web viewer looks for an imported pack whose id is the recorded Minecraft version. Use `php artisan hg:assets:list` to inspect installed local packs.

The browser receives assets only through authenticated Laravel routes. The Git repository itself contains only the renderer/importer code.

## Replay world fidelity

A replay world snapshot is not a screenshot or top-down PNG. HackerGuardian stores a complete, full-height block-state keyframe for every captured Minecraft chunk. New recordings also persist the exact capture timestamp for each chunk because chunk acquisition is intentionally spread across server ticks. The event stream is then replayed forward or backward from each chunk's own keyframe.

That structure preserves the information needed for a true 3D reconstruction: coordinates, full Bukkit block states, model variants and later world mutations. A flat image would permanently discard most of that information.

## Roadmap

1. Laravel/React control-plane foundation
2. Sanctum session authentication
3. signed HackerGuardian API gateway
4. reports/moderation/detection/learning views
5. replay library and chunked telemetry playback
6. full block-state world keyframes
7. local Minecraft resource-pack model/texture renderer
8. player skins/equipment/animations and broader entity reconstruction
9. complete nearby world-mutation journal (pistons, explosions, fluids, redstone/state changes)
10. lighting/biome/weather fidelity and live investigation tooling
