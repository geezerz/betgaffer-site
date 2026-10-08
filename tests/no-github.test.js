// Spec §10: no GitHub link or mention anywhere on the site. The guard builds the fixture artifact
// and scans every shipped page, script, stylesheet and _headers for "github" (any case) and for the
// value of config.repo. Excluded: the published data (days/, index.json — the publisher owns them)
// and the bundled font licences (assets/fonts/: the OFL texts legitimately name github.com).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../site/build.mjs';
import { workspace, copyArtifact, addArchive, testConfig } from './site-fixtures.js';

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else yield p;
  }
}

/** Every github mention or repo slug in shipped HTML/JS/CSS and _headers (data files and font licences excluded). */
export async function githubHits(distDir, repo) {
  const hits = [];
  for await (const f of files(distDir)) {
    const rel = f.slice(distDir.length + 1).replace(/\\/g, '/');
    if (rel.startsWith('days/') || rel === 'index.json' || rel.startsWith('assets/fonts/')) continue;
    if (!/\.(html|js|css)$/.test(rel) && rel !== '_headers') continue;
    const text = await readFile(f, 'utf8');
    if (/github/i.test(text)) hits.push(`${rel}: github`);
    if (repo && text.includes(repo)) hits.push(`${rel}: ${repo}`);
  }
  return hits;
}

/** Build the fixture artifact plus the archive (a full stub day and a compacted day) into ws.out. */
async function builtSite(ws, cfg) {
  await copyArtifact(ws.root);
  await addArchive(ws.root);
  await build({ root: ws.root, out: ws.out, config: cfg, warn: () => {} });
}

test('no built page, script, stylesheet or header mentions GitHub or the repo slug', async () => {
  const ws = await workspace();
  try {
    const cfg = testConfig();
    await builtSite(ws, cfg);
    // The scan must reach the pages that used to link the repository: footer (every page), the
    // home receipt, both archive stubs, the record footnote, features, terms and day.js.
    const rels = [];
    for await (const f of files(ws.out)) rels.push(f.slice(ws.out.length + 1).replace(/\\/g, '/'));
    for (const r of ['index.html', 'day/2026-10-06/index.html', 'day/2026-10-05/index.html', 'our-record/index.html',
      'features/index.html', 'terms/index.html', 'assets/js/day.js', 'assets/js/lib/fixtures.js', '_headers']) {
      assert.ok(rels.includes(r), `the build ships ${r}`);
    }
    assert.deepEqual(await githubHits(ws.out, cfg.repo), []);
  } finally { await ws.cleanup(); }
});

test('premise: the guard reports a planted github link and a planted repo slug, and skips only data and fonts', async () => {
  const ws = await workspace();
  try {
    const cfg = testConfig();
    await builtSite(ws, cfg);
    await writeFile(join(ws.out, 'planted.html'), '<a href="https://GitHub.com/x/y">x</a>');
    await writeFile(join(ws.out, 'planted.js'), `const r = '${cfg.repo}';`);
    await mkdir(join(ws.out, 'assets', 'css', 'deep'), { recursive: true });
    await writeFile(join(ws.out, 'assets', 'css', 'deep', 'planted.css'), '/* see GITHUB */');
    await writeFile(join(ws.out, '_headers'), `${await readFile(join(ws.out, '_headers'), 'utf8')}# github\n`);
    await writeFile(join(ws.out, 'assets', 'fonts', 'OFL-planted.txt'), 'https://github.com/x/y');
    const hits = await githubHits(ws.out, cfg.repo);
    assert.deepEqual(hits.sort(), [
      '_headers: github',
      'assets/css/deep/planted.css: github',
      'planted.html: github',
      `planted.js: ${cfg.repo}`,
    ]);
  } finally { await ws.cleanup(); }
});
