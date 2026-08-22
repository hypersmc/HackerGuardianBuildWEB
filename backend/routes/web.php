<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'service' => 'HackerGuardian Web API',
    'status' => 'ok',
]));
