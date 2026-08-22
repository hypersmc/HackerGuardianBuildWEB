<?php

namespace App\Services\HackerGuardian;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

final class HackerGuardianClient
{
    public function configured(): bool
    {
        return trim((string) config('hackerguardian.api.url')) !== ''
            && trim((string) config('hackerguardian.api.key_id')) !== ''
            && trim((string) config('hackerguardian.api.secret')) !== '';
    }

    public function request(string $method, string $path, array $query = [], ?array $json = null): Response
    {
        $baseUrl = rtrim((string) config('hackerguardian.api.url'), '/');
        $keyId = (string) config('hackerguardian.api.key_id');
        $secret = (string) config('hackerguardian.api.secret');

        if (! $this->configured()) {
            throw new RuntimeException('HackerGuardian API is not configured.');
        }

        $method = strtoupper($method);
        $path = '/'.ltrim($path, '/');
        $queryString = $query === [] ? '' : http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        $requestTarget = $path.($queryString === '' ? '' : '?'.$queryString);
        $body = $json === null ? '' : json_encode($json, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $timestamp = (string) round(microtime(true) * 1000);
        $nonce = bin2hex(random_bytes(24));
        $bodyHash = hash('sha256', $body);
        $canonical = implode("\n", [$method, $requestTarget, $timestamp, $nonce, $bodyHash]);
        $signature = hash_hmac('sha256', $canonical, $secret);

        $request = $this->http()->withHeaders([
            'X-HG-Key' => $keyId,
            'X-HG-TS' => $timestamp,
            'X-HG-Nonce' => $nonce,
            'X-HG-Sig' => $signature,
        ]);

        $url = $baseUrl.$requestTarget;

        return match ($method) {
            'GET' => $request->get($url),
            'POST' => $request->withBody($body, 'application/json')->post($url),
            'PUT' => $request->withBody($body, 'application/json')->put($url),
            'PATCH' => $request->withBody($body, 'application/json')->patch($url),
            'DELETE' => $request->withBody($body, 'application/json')->delete($url),
            default => throw new RuntimeException("Unsupported HG API method: {$method}"),
        };
    }

    private function http(): PendingRequest
    {
        // Do not use Laravel's automatic retry here. HG nonces are one-use; a
        // transparent retry with the same signed headers would correctly be
        // rejected as a replay. A future retry policy must create a fresh
        // signature/nonce for every attempt.
        return Http::acceptJson()
            ->connectTimeout((int) config('hackerguardian.api.connect_timeout', 3))
            ->timeout((int) config('hackerguardian.api.timeout', 10));
    }
}
