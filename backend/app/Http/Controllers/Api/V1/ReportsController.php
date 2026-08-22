<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\HackerGuardian\HackerGuardianClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

final class ReportsController extends Controller
{
    public function index(Request $request, HackerGuardianClient $hg): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', 'string', 'max:24'],
            'q' => ['sometimes', 'nullable', 'string', 'max:160'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        try {
            $response = $hg->request('GET', '/v1/reports', array_filter(
                $filters,
                static fn ($value): bool => $value !== null && $value !== ''
            ));
        } catch (Throwable $exception) {
            return response()->json([
                'ok' => false,
                'message' => $exception->getMessage() === 'HackerGuardian API is not configured.'
                    ? 'HackerGuardian API is not configured.'
                    : 'HackerGuardian report API could not be reached.',
            ], 503);
        }

        $payload = $response->json();

        if (! is_array($payload)) {
            return response()->json([
                'ok' => false,
                'message' => 'HackerGuardian returned an invalid report response.',
            ], 502);
        }

        return response()->json($payload, $response->status());
    }
}
