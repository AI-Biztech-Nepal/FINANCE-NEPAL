/*
 * visit-tracker.js - tells Finance (Visits tab) which page a visitor opened and for how long they really stayed on it.
 *
 * Put this file next to the website's main.js and add ONE line before </body> on every public page you want counted
 * (index, shop, product, contact, checkout, wishlist, ...), not on the admin pages:
 *
 *   <script src="visit-tracker.js" data-url="https://YOUR-PROJECT.supabase.co" data-key="YOUR-ANON-KEY"
 *           data-owner="YOUR-COMPANY-ID" defer></script>
 *
 *   data-url    the Supabase project URL         (the same EXPO_PUBLIC_SUPABASE_URL Finance uses)
 *   data-key    the anon / publishable key        (public by design - it is the one inside the Finance app too)
 *   data-owner  the company's user id             (Supabase -> Authentication -> Users -> the All In One Abroad account)
 *
 * It needs migration 0031_visit_time.sql to be run first. It sends no name, phone or cart: only a random id kept in
 * the browser, the page, the site the visitor came from, phone/tablet/computer, and seconds.
 *
 * Time on a page counts only the seconds when the tab is in front AND the visitor did something (moved, scrolled,
 * tapped, typed) in the last minute, so a tab left open overnight does not read as an 8-hour stay.
 * One call when the page opens, one more every 10 counted seconds, one when the visitor leaves.
 */
(function () {
  'use strict';

  var me = document.currentScript;
  if (!me || !window.fetch) return;
  var base = (me.getAttribute('data-url') || '').replace(/\/+$/, '');
  var key = me.getAttribute('data-key');
  var owner = me.getAttribute('data-owner');
  if (!base || !key || !owner) return;
  // Search-engine and test robots would only fill the page with visits that are not people.
  if (/bot\b|\bbot|crawl|spider|slurp|headless|lighthouse/i.test(navigator.userAgent || '') || navigator.webdriver) return;

  var IDLE_MS = 60000; // no movement for this long and the clock stops until they do something again
  var EVERY = 10; // counted seconds between updates

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = '';
    for (var j = 0; j < 16; j++) h += (b[j] < 16 ? '0' : '') + b[j].toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // The same browser keeps the same visitor id between pages and days; a browser that blocks storage is a new visitor each page.
  var visitor;
  try {
    visitor = localStorage.getItem('aia_visitor');
    if (!visitor) localStorage.setItem('aia_visitor', (visitor = randomId().replace(/-/g, '').slice(0, 20)));
  } catch (e) {
    visitor = randomId().replace(/-/g, '').slice(0, 20);
  }

  // The page, with the product when it is a product page (product.php?id=4) - not the rest of the address bar.
  var path = location.pathname || '/';
  try {
    var id = new URLSearchParams(location.search).get('id');
    if (id && /^[\w-]{1,40}$/.test(id)) path += '?id=' + id;
  } catch (e) {}

  // Only a site that is not this one counts as "where they came from"; moving between our own pages is not a source.
  var referrer = '';
  try {
    var host = new URL(document.referrer).hostname.replace(/^www\./, '');
    if (host && host !== location.hostname.replace(/^www\./, '')) referrer = host;
  } catch (e) {}

  var ua = navigator.userAgent || '';
  var device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop';

  var view = randomId();
  var seconds = 0;
  var sent = -1;
  var lastActive = Date.now();

  function send() {
    if (seconds === sent) return;
    sent = seconds;
    try {
      fetch(base + '/rest/v1/rpc/record_visit', {
        method: 'POST',
        keepalive: true, // lets the last update finish while the page is closing
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({
          p_owner: owner,
          p_visitor: visitor,
          p_path: path,
          p_referrer: referrer,
          p_device: device,
          p_view: view,
          p_seconds: seconds,
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  function active() {
    lastActive = Date.now();
  }
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'].forEach(function (name) {
    window.addEventListener(name, active, { passive: true, capture: true });
  });

  setInterval(function () {
    if (!document.hidden && Date.now() - lastActive < IDLE_MS) {
      seconds++;
      if (seconds % EVERY === 0) send();
    }
  }, 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) send();
    else active();
  });
  window.addEventListener('pagehide', send);

  send(); // the page is opened: 0 seconds so far
})();
