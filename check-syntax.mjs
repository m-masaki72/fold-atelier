import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('./dist/', import.meta.url)).filter((name) => /^fold.*\.js$/.test(name));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', new URL(`./dist/${file}`, import.meta.url).pathname], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} modules`);
