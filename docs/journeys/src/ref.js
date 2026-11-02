(function () {
  var root = document.querySelector('.wrap');
  function view(tech) {
    document.querySelectorAll('.v-plain').forEach(function (el) { el.hidden = tech; });
    document.querySelectorAll('.v-tech').forEach(function (el) { el.hidden = !tech; });
    document.getElementById('vPlain').setAttribute('aria-pressed', String(!tech));
    document.getElementById('vTech').setAttribute('aria-pressed', String(tech));
    try { localStorage.setItem('jv', tech ? 't' : 'p'); } catch (e) {}
  }
  function zoom(fit) {
    root.classList.toggle('fit', fit);
    document.getElementById('zFit').setAttribute('aria-pressed', String(fit));
    document.getElementById('zAct').setAttribute('aria-pressed', String(!fit));
    try { localStorage.setItem('jz', fit ? 'f' : 'a'); } catch (e) {}
  }
  document.getElementById('vPlain').onclick = function () { view(false); };
  document.getElementById('vTech').onclick = function () { view(true); };
  document.getElementById('zAct').onclick = function () { zoom(false); };
  document.getElementById('zFit').onclick = function () { zoom(true); };
  try { if (localStorage.getItem('jv') === 't') view(true); if (localStorage.getItem('jz') === 'f') zoom(true); } catch (e) {}
  if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
})();
