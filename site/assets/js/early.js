// The founding card's first-paint guard (spec §16.5). A CLASSIC, synchronous script in <head>,
// emitted by layout.page() on every page that carries the card, before the stylesheet: it runs
// before the first paint, so a visitor who dismissed the card never sees it paint and then vanish
// (banner.js is a module and runs only after parsing). founding.css hides [data-banner] under
// html.fd-hidden. Key and value are banner.js's STORAGE_KEY / HIDDEN_VALUE, its class HIDDEN_CLASS
// (tests/layout.test.js runs this file against them). Blocked or missing storage: the card shows.
(function () {
  try {
    if (window.localStorage.getItem('bg.founding.banner') === 'hidden') {
      document.documentElement.classList.add('fd-hidden');
    }
  } catch (e) {
    // Storage blocked: banner.js decides (it removes the card when it can read the choice).
  }
}());
