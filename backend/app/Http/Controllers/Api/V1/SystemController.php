<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

final class SystemController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $url = trim((string) config('hackerguardian.api.url'));
        $keyId = trim((string) config('hackerguardian.api.key_id'));
        $secret = trim((string) config('hackerguardian.api.secret'));
        $configured = $url !== '' && $keyId !== '' && $secret !== '';

        return response()->json([
            'app' => [
                'environment' => app()->environment(),
                'debug' => (bool) config('app.debug'),
            ],
            'session' => [
                'driver' => (string) config('session.driver'),
                'lifetime_minutes' => (int) config('session.lifetime'),
            ],
            'hg_gateway' => [
                'configured' => $configured,
                'url' => $url !== '' ? $url : null,
                'connect_timeout_seconds' => (int) config('hackerguardian.api.connect_timeout', 3),
                'timeout_seconds' => (int) config('hackerguardian.api.timeout', 10),
            ],
            'capabilities' => [
                'reports' => $configured ? 'available' : 'not_configured',
                'replays' => 'plugin_api_pending',
                'detection' => 'plugin_api_pending',
                'moderation' => 'plugin_api_pending',
            ],
        ]);
    }
}
