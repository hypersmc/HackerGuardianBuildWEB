<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\HackerGuardian\HackerGuardianClient;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response as HttpResponse;
use Throwable;

final class HackerGuardianController extends Controller
{
    public function health(HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/health');
    }

    public function reports(Request $request, HackerGuardianClient $hg): HttpResponse
    {
        $query = $request->validate([
            'status' => ['sometimes', 'string', 'max:24'],
            'q' => ['sometimes', 'nullable', 'string', 'max:160'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return $this->relay($hg, '/v1/reports', $this->clean($query));
    }

    public function report(int $id, HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/reports/'.$id);
    }

    public function replays(Request $request, HackerGuardianClient $hg): HttpResponse
    {
        $query = $request->validate([
            'player_uuid' => ['sometimes', 'nullable', 'uuid'],
            'player_name' => ['sometimes', 'nullable', 'string', 'max:64'],
            'server' => ['sometimes', 'nullable', 'string', 'max:128'],
            'trigger' => ['sometimes', 'nullable', 'string', 'max:64'],
            'from' => ['sometimes', 'integer', 'min:0'],
            'to' => ['sometimes', 'integer', 'min:0'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return $this->relay($hg, '/v1/replays', $this->clean($query));
    }

    public function replay(int $id, HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/replays/'.$id);
    }

    public function replayChunk(int $id, int $seq, HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/replays/'.$id.'/chunks/'.$seq);
    }

    public function detectionStatus(HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/detection/status');
    }

    public function detectionRecent(Request $request, HackerGuardianClient $hg): HttpResponse
    {
        $query = $request->validate([
            'player_uuid' => ['sometimes', 'nullable', 'uuid'],
            'detector' => ['sometimes', 'nullable', 'string', 'max:160'],
            'before' => ['sometimes', 'integer', 'min:0'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ]);

        return $this->relay($hg, '/v1/detection/recent', $this->clean($query));
    }

    public function detectionPlayer(string $uuid, HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/detection/player/'.$uuid);
    }

    public function learningStatus(HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/learning/status');
    }

    public function learningPlayers(Request $request, HackerGuardianClient $hg): HttpResponse
    {
        $query = $request->validate([
            'trusted_only' => ['sometimes', 'in:true,false,1,0'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:5000'],
        ]);

        return $this->relay($hg, '/v1/learning/players', $this->clean($query));
    }

    public function moderationActions(Request $request, HackerGuardianClient $hg): HttpResponse
    {
        $query = $request->validate([
            'target_uuid' => ['sometimes', 'nullable', 'uuid'],
            'type' => ['sometimes', 'nullable', 'string', 'max:32'],
            'server' => ['sometimes', 'nullable', 'string', 'max:128'],
            'from' => ['sometimes', 'integer', 'min:0'],
            'to' => ['sometimes', 'integer', 'min:0'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return $this->relay($hg, '/v1/moderation/actions', $this->clean($query));
    }

    public function servers(HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/servers');
    }

    public function settings(HackerGuardianClient $hg): HttpResponse
    {
        return $this->relay($hg, '/v1/settings');
    }

    private function relay(HackerGuardianClient $hg, string $path, array $query = []): HttpResponse
    {
        try {
            $upstream = $hg->request('GET', $path, $query);
        } catch (Throwable $exception) {
            $message = $exception->getMessage() === 'HackerGuardian API is not configured.'
                ? 'HackerGuardian API is not configured.'
                : 'HackerGuardian API could not be reached.';

            return response()->json([
                'ok' => false,
                'error' => [
                    'code' => 'HG_UNAVAILABLE',
                    'message' => $message,
                ],
                'meta' => [
                    'api_version' => 1,
                    'time_ms' => (int) round(microtime(true) * 1000),
                ],
            ], 503, [
                'Cache-Control' => 'no-store',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        }

        return response($upstream->body(), $upstream->status(), [
            'Content-Type' => $upstream->header('Content-Type') ?: 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function clean(array $query): array
    {
        return array_filter(
            $query,
            static fn (mixed $value): bool => $value !== null && $value !== ''
        );
    }
}
