<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\HackerGuardianController;
use App\Http\Controllers\Api\V1\SystemController;
use App\Http\Controllers\Api\V1\UsersController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        Route::get('/dashboard', DashboardController::class);
        Route::get('/users', [UsersController::class, 'index']);
        Route::get('/system', SystemController::class);

        // Read-only HackerGuardian API v1 gateway. The browser never receives
        // the upstream HMAC credentials; Laravel signs every request.
        Route::get('/hg/health', [HackerGuardianController::class, 'health']);

        Route::get('/reports', [HackerGuardianController::class, 'reports']);
        Route::get('/reports/{id}', [HackerGuardianController::class, 'report'])->whereNumber('id');

        Route::get('/replays', [HackerGuardianController::class, 'replays']);
        Route::get('/replays/{id}', [HackerGuardianController::class, 'replay'])->whereNumber('id');
        Route::get('/replays/{id}/chunks/{seq}', [HackerGuardianController::class, 'replayChunk'])
            ->whereNumber('id')->whereNumber('seq');
        Route::get('/replays/{id}/world', [HackerGuardianController::class, 'replayWorld'])
            ->whereNumber('id');
        Route::get('/replays/{id}/world/chunks/{x}/{z}', [HackerGuardianController::class, 'replayWorldChunk'])
            ->whereNumber('id')
            ->where('x', '-?[0-9]+')
            ->where('z', '-?[0-9]+');

        Route::get('/detection/status', [HackerGuardianController::class, 'detectionStatus']);
        Route::get('/detection/recent', [HackerGuardianController::class, 'detectionRecent']);
        Route::get('/detection/player/{uuid}', [HackerGuardianController::class, 'detectionPlayer'])->whereUuid('uuid');

        Route::get('/learning/status', [HackerGuardianController::class, 'learningStatus']);
        Route::get('/learning/players', [HackerGuardianController::class, 'learningPlayers']);

        Route::get('/moderation/actions', [HackerGuardianController::class, 'moderationActions']);
        Route::get('/servers', [HackerGuardianController::class, 'servers']);
        Route::get('/hg/settings', [HackerGuardianController::class, 'settings']);
    });
});
