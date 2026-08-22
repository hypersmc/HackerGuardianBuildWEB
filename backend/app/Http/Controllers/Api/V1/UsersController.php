<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;

final class UsersController extends Controller
{
    public function index(): JsonResponse
    {
        $users = User::query()
            ->orderBy('name')
            ->orderBy('id')
            ->get(['id', 'name', 'email', 'created_at']);

        return response()->json([
            'data' => $users,
            'total' => $users->count(),
        ]);
    }
}
