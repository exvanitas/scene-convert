/* site-analytics v2: Google Analytics 4 with consent, the same on every site.
 * The build replaces __GA_ID__ with the site's measurement ID and inlines this whole file as one
 * <script> in <head>. No ID at build time means no script at all (forks, local runs, previews).
 *
 * - Visitors whose time zone is in Europe are asked first. Until they say yes, nothing is loaded
 *   from Google: no script, no cookies, no pings. Yes or no is kept in localStorage.
 * - Everyone else is counted without a prompt. Google's own region default still denies analytics
 *   cookies in the EEA, the UK and Switzerland, in case a European visitor's clock says otherwise.
 * - Ads, ad data and ad personalisation are denied for everyone, always.
 * - Any element with data-analytics="yes" | "no" | "ask" becomes a control (a footer link or the
 *   privacy page's buttons); any element with data-analytics-state shows the current choice.
 * CSP (Google's "Analytics without Ads features" list): script-src https://www.googletagmanager.com
 *   plus this script's hash; img-src https://www.googletagmanager.com https://*.google-analytics.com;
 *   connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com
 */
(function () {
  var ID = '__GA_ID__';
  var KEY = 'site-analytics';
  var EUROPE = /^(Europe\/|Atlantic\/(Azores|Canary|Faroe|Madeira|Reykjavik)|Arctic\/Longyearbyen)/;
  var GDPR = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
    'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  var NO_ADS = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  var zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var ask = EUROPE.test(zone);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  var loaded = false;
  function load(granted) {
    if (loaded) return; loaded = true;
    gtag('consent', 'default', Object.assign({ analytics_storage: 'granted' }, NO_ADS));
    gtag('consent', 'default', Object.assign({ analytics_storage: 'denied', region: GDPR }, NO_ADS));
    if (granted) gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
  }
  function state() {
    var said = get();
    if (said === 'yes') return 'Counting is on for this browser.';
    if (said === 'no') return 'Counting is off for this browser.';
    return ask ? 'Nothing is counted until you choose.' : 'Counting is on (the default outside Europe).';
  }
  function show() {
    var els = document.querySelectorAll('[data-analytics-state]');
    for (var i = 0; i < els.length; i++) els[i].textContent = state();
  }
  function choose(v) {
    set(v); show();
    if (v === 'yes') { if (loaded) gtag('consent', 'update', { analytics_storage: 'granted' }); else load(true); }
    if (v === 'no' && loaded) { location.reload(); return; } // a reload is the only way to unload gtag
    var bar = document.getElementById('site-analytics-ask'); if (bar) bar.remove();
  }
  function showAsk() {
    if (document.getElementById('site-analytics-ask')) return;
    var bar = document.createElement('div');
    bar.id = 'site-analytics-ask'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Analytics');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:34rem;margin:0 auto;' +
      'display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;font:14px/1.4 system-ui,sans-serif;' +
      'background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:6px';
    var text = document.createElement('span');
    text.textContent = 'Count this visit with Google Analytics? It sets a cookie.';
    text.style.flex = '1 1 11rem';
    bar.appendChild(text);
    ['yes', 'no'].forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = v === 'yes' ? 'Yes' : 'No'; b.style.font = 'inherit';
      b.addEventListener('click', function () { choose(v); });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }
  function wire() {
    show();
    var said = get();
    if (ask && said !== 'yes' && said !== 'no') showAsk();
    var els = document.querySelectorAll('[data-analytics]');
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('click', function (e) {
        e.preventDefault();
        var v = this.getAttribute('data-analytics');
        if (v === 'ask') showAsk(); else choose(v);
      });
    }
  }

  var said = get();
  if (said === 'yes') load(true);
  else if (said !== 'no' && !ask) load(false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  window.siteAnalytics = { choose: choose, ask: showAsk };
}());
