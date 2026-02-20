/*
  Paste this into `investor-site/investors.html` (or its bundled JS) on the static host.

  Purpose:
  - Read `access` from the URL hash (e.g. `#opportunity&access=...`)
  - Store it in sessionStorage (clears on browser close)
  - Remove it from the URL (so it doesn't linger in copy/paste)
  - Fetch hidden content from the API and render it

  Required HTML placeholder:
    <div id="investorHiddenContent"></div>

  Optional: an “Unlock” link:
    <a href="https://<app-host>/sign/<public-sign-token>">Unlock hidden content</a>
*/

(function () {
  // TODO: set this to wherever your API is hosted.
  // If the API is on the same origin as investors.html, you can use ''.
  var API_ORIGIN = '';

  function parseHashParams() {
    var raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return {};
    var parts = raw.split('&');
    var params = {};
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      var eq = part.indexOf('=');
      if (eq === -1) continue;
      var k = part.slice(0, eq);
      var v = part.slice(eq + 1);
      params[k] = decodeURIComponent(v || '');
    }
    return params;
  }

  function removeHashParam(paramName) {
    var raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return;
    var parts = raw.split('&').filter(Boolean);
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(paramName + '=') === 0) continue;
      kept.push(parts[i]);
    }
    var nextHash = kept.length ? '#' + kept.join('&') : '';
    try {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search + nextHash);
    } catch (e) {
      // ignore
    }
  }

  var params = parseHashParams();
  if (params.access) {
    sessionStorage.setItem('investorAccessToken', params.access);
    removeHashParam('access');
  }

  var token = sessionStorage.getItem('investorAccessToken') || '';
  var mount = document.getElementById('investorHiddenContent');
  if (!mount) return;

  if (!token) {
    mount.innerHTML = '<div style="padding:12px;border:1px solid #ddd;border-radius:10px;">' +
      '<strong>Hidden content locked.</strong> ' +
      'Complete the NDA + investor password flow to unlock.' +
      '</div>';
    return;
  }

  fetch(API_ORIGIN + '/api/public/investor-hidden', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  })
    .then(function (resp) { return resp.json().then(function (data) { return { ok: resp.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) throw new Error((result.data && result.data.error) || 'Unauthorized');
      if (result.data && typeof result.data.html === 'string') {
        mount.innerHTML = result.data.html;
        return;
      }
      if (result.data && Array.isArray(result.data.items)) {
        var html = '<ul>';
        for (var i = 0; i < result.data.items.length; i++) {
          var item = result.data.items[i];
          html += '<li><a target="_blank" rel="noopener" href="' + item.url + '">' + item.title + '</a></li>';
        }
        html += '</ul>';
        mount.innerHTML = html;
        return;
      }
      mount.innerHTML = '<div>Unlocked, but no payload configured.</div>';
    })
    .catch(function (err) {
      mount.innerHTML = '<div style="padding:12px;border:1px solid #f5c2c7;border-radius:10px;color:#842029;background:#f8d7da;">' +
        'Failed to load hidden content: ' + String(err && err.message ? err.message : err) +
        '</div>';
    });
})();

