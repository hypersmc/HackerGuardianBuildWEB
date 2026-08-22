<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\ReportsController;
use App\Http\Controllers\Api\V1\SystemController;
use App\Http\Controllers\Api\V1\UsersController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        Route::get('/dashboard', DashboardController::class);
        Route::get('/reports', [ReportsController::class, 'index']);
        Route::get('/users', [UsersController::class, 'index']);
        Route::get('/system', SystemController::class);
    });
});
