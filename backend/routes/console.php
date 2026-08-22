<?php

use App\Models\User;
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
        [
            'name' => $name,
            'email' => $email,
            'password' => $password,
        ],
        [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ],
    );

    if ($validator->fails()) {
        foreach ($validator->errors()->all() as $message) {
            $this->error($message);
        }

        return 1;
    }

    $user = User::query()->create([
        'name' => $name,
        'email' => $email,
        'password' => $password,
    ]);

    $this->newLine();
    $this->info(sprintf('Created HackerGuardian panel user #%d: %s <%s>', $user->id, $user->name, $user->email));

    return 0;
})->purpose('Create a HackerGuardian control-plane user interactively');
