// The owner's app works with no script: every screen is drawn on the server,
// and every action is a form. This one small script, served at /app.js and
// allowed by the pages' content security policy, adds three things the
// example does with its own script:
// - Back goes back, when the page before was one of the app's.
// - A button that sends a form says so ("Sending…") and cannot be tapped
//   twice.
// - On All jobs, the list narrows as the owner types in the find box.
// It reads nothing from the page but what is on it, and sends nothing.

export const APP_SCRIPT = `'use strict';
(function () {
  document.addEventListener('click', function (event) {
    var back = event.target instanceof Element ? event.target.closest('a.back') : null;
    if (back && document.referrer.indexOf(location.origin + '/') === 0 && history.length > 1) {
      event.preventDefault();
      history.back();
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method !== 'post') return;
    if (form.dataset.sent) {
      event.preventDefault();
      return;
    }
    form.dataset.sent = 'yes';
    var button = event.submitter;
    if (button && button.dataset.busy) {
      button.textContent = button.dataset.busy;
      button.setAttribute('aria-disabled', 'true');
    }
  });

  var find = document.getElementById('fl-find');
  var list = document.getElementById('fl-jobs');
  var none = document.getElementById('fl-none');
  if (find && list && none) {
    var narrow = function () {
      var wanted = find.value.toLowerCase().replace(/[\\u2018\\u2019]/g, "'").replace(/\\s+/g, ' ').trim();
      var shown = 0;
      list.querySelectorAll('a.row[data-find]').forEach(function (row) {
        var match = wanted === '' || row.dataset.find.indexOf(wanted) !== -1;
        row.hidden = !match;
        if (match) shown += 1;
      });
      none.hidden = shown !== 0;
    };
    find.addEventListener('input', narrow);
    narrow();
  }
})();
`;
