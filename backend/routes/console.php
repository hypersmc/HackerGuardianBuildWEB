<?php

use App\Models\User;
use App\Services\MinecraftAssets\MinecraftAssetPackStore;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Validator;

Artisan::command('hg:about', function (): void {
    $this->info('HackerGuardian Web control plane');
});

Artisan::command('hg:user:create {email?}', function (?string $email = null): int {
    $email = $email ?: $this->ask('Email address');
    $name = $this->ask('Display name', 'Administrator');
    $password = $this->secret('Password');
    $confirmation = $this->secret('Confirm password');

    if ($password !== $confirmation) {
        $this->error('Passwords do not match.');
        return 1;
    }

    $validator = Validator::make(
        ['name' => $name, 'email' => $email, 'password' => $password],
        [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ],
    );

    if ($validator->fails()) {
        foreach ($validator->errors()->all() as $message) $this->error($message);
        return 1;
    }

    $user = User::query()->create(['name' => $name, 'email' => $email, 'password' => $password]);
    $this->newLine();
    $this->info(sprintf('Created HackerGuardian panel user #%d: %s <%s>', $user->id, $user->name, $user->email));
    return 0;
})->purpose('Create a HackerGuardian control-plane user interactively');

Artisan::command('hg:assets:import {source} {--id=} {--version=} {--overlay=*}', function (): int {
    try {
        $source = (string) $this->argument('source');
        $version = $this->option('version');
        $id = (string) ($this->option('id') ?: $version ?: pathinfo($source, PATHINFO_FILENAME));
        $overlays = array_values(array_filter((array) $this->option('overlay'), 'is_string'));

        /** @var MinecraftAssetPackStore $store */
        $store = app(MinecraftAssetPackStore::class);
        $manifest = $store->import($source, $id, is_string($version) ? $version : null, $overlays);

        $this->info('Imported Minecraft render assets: '.$manifest['id']);
        $this->line('Version: '.($manifest['version'] ?? 'unknown'));
        $this->line('Blockstates: '.($manifest['blockstate_count'] ?? 0));
        $this->line('Models: '.($manifest['model_count'] ?? 0));
        $this->line('Files: '.($manifest['file_count'] ?? 0));
        if ($overlays !== []) $this->line('Overlays: '.count($overlays));
        $this->newLine();
        $this->comment('Assets remain local under backend/storage/app/minecraft-assets and are not part of the Git repository.');
        return 0;
    } catch (Throwable $exception) {
        $this->error($exception->getMessage());
        return 1;
    }
})->purpose('Import a locally owned Minecraft client JAR/resource pack for faithful replay rendering');

Artisan::command('hg:assets:list', function (): int {
    /** @var MinecraftAssetPackStore $store */
    $store = app(MinecraftAssetPackStore::class);
    $packs = $store->list();
    if ($packs === []) {
        $this->warn('No Minecraft render asset packs are installed.');
        return 0;
    }

    $this->table(
        ['ID', 'Version', 'Blockstates', 'Models', 'Imported'],
        array_map(static fn (array $pack): array => [
            $pack['id'] ?? '',
            $pack['version'] ?? '',
            $pack['blockstate_count'] ?? 0,
            $pack['model_count'] ?? 0,
            $pack['imported_at'] ?? '',
        ], $packs)
    );
    return 0;
})->purpose('List locally imported Minecraft replay render asset packs');
