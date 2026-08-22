<?php

namespace App\Services\MinecraftAssets;

use Illuminate\Filesystem\Filesystem;
use RuntimeException;
use ZipArchive;

final class MinecraftAssetPackStore
{
    private const MAX_ARCHIVE_ENTRIES = 100000;
    private const MAX_UNCOMPRESSED_BYTES = 1073741824; // 1 GiB safety bound.
    private const MAX_SINGLE_FILE_BYTES = 67108864; // 64 MiB.

    public function __construct(private readonly Filesystem $files)
    {
    }

    /**
     * Import a Minecraft client JAR/resource pack plus optional overlays into a
     * local, private asset pack. Mojang assets are never committed to this repo.
     */
    public function import(string $source, string $id, ?string $version = null, array $overlays = []): array
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('PHP ext-zip is required to import Minecraft assets.');
        }

        $id = $this->packId($id);
        $source = $this->existingArchive($source);
        $overlayPaths = array_map(fn (string $path): string => $this->existingArchive($path), $overlays);

        $root = $this->root();
        $this->files->ensureDirectoryExists($root);
        $temp = $root.'/.import-'.$id.'-'.bin2hex(random_bytes(6));
        $this->files->ensureDirectoryExists($temp);

        try {
            $fileCount = $this->extractLayer($source, $temp);
            foreach ($overlayPaths as $overlay) {
                $fileCount += $this->extractLayer($overlay, $temp);
            }

            $catalog = $this->buildCatalog($temp);
            $manifest = [
                'id' => $id,
                'version' => $version ?: $id,
                'imported_at' => now()->toIso8601String(),
                'source' => [
                    'name' => basename($source),
                    'sha256' => hash_file('sha256', $source),
                ],
                'overlays' => array_map(static fn (string $path): array => [
                    'name' => basename($path),
                    'sha256' => hash_file('sha256', $path),
                ], $overlayPaths),
                'file_count' => $fileCount,
                'blockstate_count' => count($catalog['blockstates']),
                'model_count' => count($catalog['models']),
                'texture_count' => count($catalog['textures']),
                'texture_meta_count' => count($catalog['texture_meta']),
            ];

            $this->files->put($temp.'/catalog.json', json_encode($catalog, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            $this->files->put($temp.'/manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));

            $destination = $this->packPath($id);
            if ($this->files->exists($destination)) {
                $this->files->deleteDirectory($destination);
            }
            if (! @rename($temp, $destination)) {
                throw new RuntimeException('Could not activate imported Minecraft asset pack.');
            }

            return $manifest;
        } catch (\Throwable $exception) {
            $this->files->deleteDirectory($temp);
            throw $exception;
        }
    }

    public function list(): array
    {
        if (! $this->files->isDirectory($this->root())) return [];

        $packs = [];
        foreach ($this->files->directories($this->root()) as $directory) {
            if (str_starts_with(basename($directory), '.import-')) continue;
            $manifest = $this->readJson($directory.'/manifest.json');
            if (is_array($manifest)) $packs[] = $manifest;
        }

        usort($packs, static fn (array $a, array $b): int => strcmp((string) ($a['id'] ?? ''), (string) ($b['id'] ?? '')));
        return $packs;
    }

    public function catalog(string $id): ?array
    {
        $value = $this->readJson($this->packPath($this->packId($id)).'/catalog.json');
        return is_array($value) ? $value : null;
    }

    public function manifest(string $id): ?array
    {
        $value = $this->readJson($this->packPath($this->packId($id)).'/manifest.json');
        return is_array($value) ? $value : null;
    }

    public function texturePath(string $packId, string $asset): ?string
    {
        $packId = $this->packId($packId);
        $asset = strtolower(trim($asset));
        if (! str_contains($asset, ':')) $asset = 'minecraft:'.$asset;
        if (! preg_match('/^[a-z0-9_.-]+:[a-z0-9_\.\/-]+$/', $asset)) {
            throw new RuntimeException('Invalid Minecraft texture identifier.');
        }

        [$namespace, $path] = explode(':', $asset, 2);
        if (str_contains($path, '..')) throw new RuntimeException('Invalid Minecraft texture path.');

        $file = $this->packPath($packId).'/assets/'.$namespace.'/textures/'.$path.'.png';
        return $this->files->isFile($file) ? $file : null;
    }

    private function buildCatalog(string $root): array
    {
        $blockstates = [];
        $models = [];
        $textures = [];
        $textureMeta = [];
        $assetsRoot = $root.'/assets';

        if (! $this->files->isDirectory($assetsRoot)) {
            throw new RuntimeException('Archive contains no Minecraft-style assets directory.');
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($assetsRoot, \FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $file) {
            if (! $file->isFile()) continue;
            $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($assetsRoot) + 1));
            $parts = explode('/', $relative);
            if (count($parts) < 3) continue;
            $namespace = array_shift($parts);
            $kind = array_shift($parts);
            $rest = implode('/', $parts);

            if ($kind === 'blockstates' && str_ends_with($rest, '.json')) {
                $key = $namespace.':'.substr($rest, 0, -5);
                $json = $this->readJson($file->getPathname());
                if (is_array($json)) $blockstates[$key] = $json;
            } elseif ($kind === 'models' && str_ends_with($rest, '.json')) {
                $key = $namespace.':'.substr($rest, 0, -5);
                $json = $this->readJson($file->getPathname());
                if (is_array($json)) $models[$key] = $json;
            } elseif ($kind === 'textures' && str_ends_with($rest, '.png')) {
                $textures[$namespace.':'.substr($rest, 0, -4)] = true;
            } elseif ($kind === 'textures' && str_ends_with($rest, '.png.mcmeta')) {
                $key = $namespace.':'.substr($rest, 0, -11);
                $json = $this->readJson($file->getPathname());
                if (is_array($json)) $textureMeta[$key] = $json;
            }
        }

        ksort($blockstates);
        ksort($models);
        ksort($textures);
        ksort($textureMeta);

        return [
            'format' => 'hg-minecraft-assets-v1',
            'blockstates' => $blockstates,
            'models' => $models,
            'textures' => array_keys($textures),
            'texture_meta' => $textureMeta,
        ];
    }

    private function extractLayer(string $archive, string $destination): int
    {
        $zip = new ZipArchive();
        $status = $zip->open($archive);
        if ($status !== true) throw new RuntimeException('Could not open Minecraft asset archive: '.basename($archive));

        try {
            if ($zip->numFiles > self::MAX_ARCHIVE_ENTRIES) {
                throw new RuntimeException('Minecraft asset archive contains too many files.');
            }

            $total = 0;
            $written = 0;
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index);
                if (! is_array($stat)) continue;
                $name = str_replace('\\', '/', (string) ($stat['name'] ?? ''));
                if ($name === '' || str_ends_with($name, '/') || ! $this->allowedArchivePath($name)) continue;

                $size = (int) ($stat['size'] ?? 0);
                if ($size < 0 || $size > self::MAX_SINGLE_FILE_BYTES) {
                    throw new RuntimeException('Minecraft asset file exceeds safety limit: '.$name);
                }
                $total += $size;
                if ($total > self::MAX_UNCOMPRESSED_BYTES) {
                    throw new RuntimeException('Minecraft asset archive exceeds decompressed safety limit.');
                }

                $contents = $zip->getFromIndex($index);
                if ($contents === false) throw new RuntimeException('Could not read Minecraft asset: '.$name);

                $target = $destination.'/'.$name;
                $this->files->ensureDirectoryExists(dirname($target));
                $this->files->put($target, $contents);
                $written++;
            }

            return $written;
        } finally {
            $zip->close();
        }
    }

    private function allowedArchivePath(string $path): bool
    {
        if (str_starts_with($path, '/') || str_contains($path, '..') || str_contains($path, "\0")) return false;
        if ($path === 'pack.mcmeta' || $path === 'pack.png') return true;

        return (bool) preg_match('#^assets/[a-z0-9_.-]+/(blockstates|models|textures|atlases)/[a-zA-Z0-9_./-]+(?:\.json|\.png|\.png\.mcmeta)$#', $path);
    }

    private function readJson(string $path): mixed
    {
        if (! $this->files->isFile($path)) return null;
        try {
            return json_decode($this->files->get($path), true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return null;
        }
    }

    private function existingArchive(string $path): string
    {
        $path = $this->expandHome(trim($path));
        $resolved = realpath($path);
        if ($resolved === false || ! is_file($resolved)) {
            throw new RuntimeException('Minecraft asset archive not found: '.$path);
        }
        return $resolved;
    }

    private function expandHome(string $path): string
    {
        if (! str_starts_with($path, '~/')) return $path;
        $home = getenv('HOME');
        return $home ? rtrim($home, '/').substr($path, 1) : $path;
    }

    private function packId(string $id): string
    {
        $id = trim($id);
        if (! preg_match('/^[A-Za-z0-9._-]{1,128}$/', $id)) {
            throw new RuntimeException('Asset pack id may only contain letters, numbers, dot, underscore and dash.');
        }
        return $id;
    }

    private function root(): string
    {
        return storage_path('app/minecraft-assets');
    }

    private function packPath(string $id): string
    {
        return $this->root().'/'.$id;
    }
}
