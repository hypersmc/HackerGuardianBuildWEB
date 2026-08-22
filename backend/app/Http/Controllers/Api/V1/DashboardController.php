<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $request->user(),
            'stats' => [
                'open_reports' => null,
                'replays_24h' => null,
                'moderation_actions_24h' => null,
                'detection_alerts' => null,
            ],
            'system' => [
                'api' => 'online',
                'hg_gateway' => 'not_configured',
            ],
        ]);
    }
}
