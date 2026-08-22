<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\MinecraftAssets\MinecraftAssetPackStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class MinecraftAssetController extends Controller
{
    public function index(MinecraftAssetPackStore $store): JsonResponse
    {
        return $this->ok(['packs' => $store->list()]);
    }

    public function catalog(string $pack, MinecraftAssetPackStore $store): JsonResponse
    {
        try {
            $catalog = $store->catalog($pack);
            $manifest = $store->manifest($pack);
        } catch (\Throwable $exception) {
            return $this->error('INVALID_ASSET_PACK', $exception->getMessage(), 400);
        }

        if ($catalog === null || $manifest === null) {
            return $this->error('ASSET_PACK_NOT_FOUND', 'Minecraft asset pack is not installed.', 404);
        }

        return $this->ok([
            'manifest' => $manifest,
            'catalog' => $catalog,
        ]);
    }

    public function texture(Request $request, string $pack, MinecraftAssetPackStore $store): BinaryFileResponse|JsonResponse
    {
        $validated = $request->validate([
            'asset' => ['required', 'string', 'max:255'],
        ]);

        try {
            $path = $store->texturePath($pack, $validated['asset']);
        } catch (\Throwable $exception) {
            return $this->error('INVALID_TEXTURE', $exception->getMessage(), 400);
        }

        if ($path === null) {
            return $this->error('TEXTURE_NOT_FOUND', 'Minecraft texture is not present in this asset pack.', 404);
        }

        return response()->file($path, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'private, max-age=31536000, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function ok(array $data): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'data' => $data,
            'meta' => [
                'api_version' => 1,
                'time_ms' => (int) round(microtime(true) * 1000),
            ],
        ], 200, ['Cache-Control' => 'private, max-age=60']);
    }

    private function error(string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'error' => ['code' => $code, 'message' => $message],
            'meta' => [
                'api_version' => 1,
                'time_ms' => (int) round(microtime(true) * 1000),
            ],
        ], $status, ['Cache-Control' => 'no-store']);
    }
}
