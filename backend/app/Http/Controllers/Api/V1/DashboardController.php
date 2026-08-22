<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\HackerGuardian\HackerGuardianClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

final class DashboardController extends Controller
{
    public function __invoke(Request $request, HackerGuardianClient $hg): JsonResponse
    {
        $now = (int) round(microtime(true) * 1000);
        $since24h = $now - 86_400_000;

        $health = $this->data($hg, '/v1/health');
        $reports = $this->data($hg, '/v1/reports', [
            'status' => 'open',
            'page' => 1,
            'per_page' => 5,
        ]);
        $replays = $this->data($hg, '/v1/replays', [
            'from' => $since24h,
            'page' => 1,
            'per_page' => 1,
        ]);
        $moderation = $this->data($hg, '/v1/moderation/actions', [
            'from' => $since24h,
            'page' => 1,
            'per_page' => 1,
        ]);
        $detections = $this->data($hg, '/v1/detection/recent', [
            'before' => $now,
            'limit' => 100,
        ]);

        $recentDetectionEvents = is_array($detections['events'] ?? null)
            ? array_values(array_filter(
                $detections['events'],
                static fn (mixed $event): bool => is_array($event)
                    && (int) ($event['time_ms'] ?? 0) >= $since24h
            ))
            : [];

        return response()->json([
            'user' => $request->user(),
            'stats' => [
                'open_reports' => isset($reports['total']) ? (int) $reports['total'] : null,
                'replays_24h' => isset($replays['total']) ? (int) $replays['total'] : null,
                'moderation_actions_24h' => isset($moderation['total']) ? (int) $moderation['total'] : null,
                // The detection endpoint is intentionally bounded. This is the
                // count of recent journal events returned inside the last 24h,
                // not an invented global total.
                'detection_alerts' => $detections === null ? null : count($recentDetectionEvents),
                'panel_users' => User::query()->count(),
            ],
            'recent_reports' => is_array($reports['reports'] ?? null) ? $reports['reports'] : [],
            'recent_detections' => array_slice($recentDetectionEvents, 0, 8),
            'system' => [
                'api' => 'online',
                'hg_gateway' => $health !== null
                    ? 'online'
                    : ($hg->configured() ? 'unreachable' : 'not_configured'),
                'role' => $health['role'] ?? null,
                'plugin_version' => $health['plugin_version'] ?? null,
                'players_online' => isset($health['players_online']) ? (int) $health['players_online'] : null,
                'database_healthy' => $health['database']['healthy'] ?? null,
                'capabilities' => is_array($health['capabilities'] ?? null) ? $health['capabilities'] : [],
                'servers_online' => is_array($health['servers'] ?? null)
                    ? count(array_filter($health['servers'], static fn (mixed $server): bool => is_array($server) && ($server['online'] ?? false) === true))
                    : null,
            ],
        ]);
    }

    private function data(HackerGuardianClient $hg, string $path, array $query = []): ?array
    {
        if (! $hg->configured()) return null;

        try {
            $response = $hg->request('GET', $path, $query);
            if (! $response->successful()) return null;

            $payload = $response->json();
            if (! is_array($payload) || ($payload['ok'] ?? false) !== true || ! is_array($payload['data'] ?? null)) {
                return null;
            }

            return $payload['data'];
        } catch (Throwable) {
            return null;
        }
    }
}
