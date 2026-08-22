<?php

use Illuminate\Support\Facades\Artisan;

Artisan::command('hg:about', function (): void {
    $this->info('HackerGuardian Web control plane');
});
