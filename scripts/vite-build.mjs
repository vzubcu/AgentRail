import { createRequire } from 'node:module';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import viteConfig from '../vite.config.mjs';

function patchWindowsChildProcesses() {
  if (process.platform !== 'win32') {
    return;
  }

  const require = createRequire(import.meta.url);
  const childProcess = require('node:child_process');
  const originalExec = childProcess.exec;

  childProcess.exec = function patchedExec(command, options, callback) {
    const normalized = typeof command === 'string' ? command.trim().toLowerCase() : '';
    if (normalized === 'net use') {
      const resolvedCallback = typeof options === 'function' ? options : callback;
      queueMicrotask(() => resolvedCallback?.(null, '', ''));
      return {
        pid: 0,
        kill() { return true; },
        on() { return this; },
        once() { return this; },
        stdout: null,
        stderr: null,
      };
    }

    return originalExec.call(this, command, options, callback);
  };

  syncBuiltinESMExports();
}

function getEffectiveBuildConfig() {
  if (process.platform !== 'win32') {
    return {
      configFile: false,
      ...viteConfig,
    };
  }

  return {
    configFile: false,
    ...viteConfig,
    build: {
      ...viteConfig.build,
      minify: false,
      cssMinify: false,
      target: 'esnext',
    },
  };
}

export async function buildWebAssets() {
  patchWindowsChildProcesses();
  const { build } = await import('vite');
  await build(getEffectiveBuildConfig());
}

// process.argv[1] is the script path as typed (relative on Windows shells), so
// compare via pathToFileURL (resolves against cwd) instead of new URL(..., 'file://'),
// which resolves against the bare file base and never matches.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await buildWebAssets();
}
