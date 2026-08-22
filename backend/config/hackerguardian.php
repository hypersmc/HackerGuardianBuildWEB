<?php

return [
    'api' => [
        'url' => env('HG_API_URL'),
        'key_id' => env('HG_API_KEY_ID'),
        'secret' => env('HG_API_SECRET'),
        'connect_timeout' => (int) env('HG_API_CONNECT_TIMEOUT', 3),
        'timeout' => (int) env('HG_API_TIMEOUT', 10),
    ],
];
