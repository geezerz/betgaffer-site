// Tombstone (operator R-263, 2026-11-14): /blog/how-to-check-us/ is pulled and must answer 404 until the rewritten post is
// Legal-cleared and 6c has OK'd it. Pages kept serving the deleted page from its asset cache (s-maxage 7 days; a deploy only
// purges files it changes, never ones it removes), so a Function in front of it answers instead. No redirect.
// DELETE this file in the commit that republishes the post (the function would shadow the page).
export const onRequest = () => new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});
