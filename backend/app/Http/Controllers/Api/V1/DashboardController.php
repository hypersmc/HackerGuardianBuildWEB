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
        $gatewayConfigured = $this->gatewayConfigured();
        $reportsState = $gatewayConfigured ? 'unreachable' : 'not_configured';
        $openReports = null;
        $recentReports = [];

        if ($gatewayConfigured) {
            try {
                $response = $hg->request('GET', '/v1/reports', [
                    'status' => 'open',
                    'page' => 1,
                    'per_page' => 5,
                ]);

                if ($response->successful()) {
                    $payload = $response->json();
                    $openReports = isset($payload['total']) ? (int) $payload['total'] : null;
                    $recentReports = is_array($payload['data'] ?? null) ? $payload['data'] : [];
                    $reportsState = 'ready';
                } else {
                    $reportsState = 'http_'.$response->status();
                }
            } catch (Throwable) {
                $reportsState = 'unreachable';
            }
        }

        return response()->json([
            'user' => $request->user(),
            'stats' => [
                'open_reports' => $openReports,
                'replays_24h' => null,
                'moderation_actions_24h' => null,
                'detection_alerts' => null,
                'panel_users' => User::query()->count(),
            ],
            'recent_reports' => $recentReports,
            'system' => [
                'api' => 'online',
                'hg_gateway' => $gatewayConfigured ? ($reportsState === 'unreachable' ? 'unreachable' : 'configured') : 'not_configured',
                'reports_api' => $reportsState,
            ],
        ]);
    }

    private function gatewayConfigured(): bool
    {
        return trim((string) config('hackerguardian.api.url')) !== ''
            && trim((string) config('hackerguardian.api.key_id')) !== ''
            && trim((string) config('hackerguardian.api.secret')) !== '';
    }
}
