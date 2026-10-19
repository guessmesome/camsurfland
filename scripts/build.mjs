import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public');
const frontend = ['index.html', 'styles.css', 'script.js', 'analytics.js'];
const mediaExtensions = new Set(['.webp', '.mp4', '.svg', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);

// Only explicitly public frontend files and media enter the static deployment.
// Private dashboard templates, server code, documentation and env files stay outside.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of frontend) {
  const source = join(root, file);
  if (!(await lstat(source)).isFile()) throw new Error(`Invalid frontend file: ${file}`);
  await copyFile(source, join(output, file));
}
let mediaCount = 0;
async function copyMedia(relative) {
  const source = join(root, relative);
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) throw new Error(`Symlinks are not public assets: ${relative}`);
  if (stats.isDirectory()) {
    for (const name of await readdir(source)) await copyMedia(join(relative, name));
  } else if (stats.isFile() && mediaExtensions.has(extname(relative).toLowerCase())) {
    const destination = join(output, relative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    mediaCount++;
  }
}
await copyMedia('media');
console.log(`Built public frontend: ${frontend.length} files, ${mediaCount} media assets. Private dashboard is served by the authenticated function.`);
