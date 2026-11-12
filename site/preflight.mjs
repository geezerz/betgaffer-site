// Merge preflight (Marketing R-210): a blog piece goes live for the first time dated today (Lagos), never backdated.
// Usage: node site/preflight.mjs  -- exits 1 naming each slug to re-date. Not part of the build: a network blip must
// never stop the 2-hourly data rebuild, and only a merge can put a new piece live.
import { join } from 'node:path';
import config from './config.js';
import { REPO_ROOT } from './build.mjs';
import { backdated, readBlog } from './lib/blog.js';
import { lagosToday } from './lib/time.js';

const res = await fetch(`${config.origin}/sitemap-blog.xml`, { cache: 'no-store' });
if (!res.ok && res.status !== 404) throw new Error(`preflight: live sitemap-blog.xml answered ${res.status}; retry, do not merge blind`);
const live = new Set(res.ok ? [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : []);
const blog = await readBlog(join(REPO_ROOT, 'content', 'blog'));
const today = lagosToday(Date.now());
const bad = blog ? backdated(blog.data.articles, live, today, config.origin) : [];
if (bad.length) {
  console.error(`preflight: re-date to ${today} before merging (new piece with a past date): ${bad.join(', ')}`);
  process.exit(1);
}
console.log(`preflight ok: ${live.size} live blog url(s); no new piece is backdated (Lagos today ${today})`);
