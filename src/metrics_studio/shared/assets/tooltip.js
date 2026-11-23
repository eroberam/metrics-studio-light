(function() {
  const tt = document.getElementById('g-tooltip');
  if (!tt) return;
  // Resolve at hover time so a language switch needs no re-apply pass:
  // data-tooltip-key -> glossary (active language), else literal data-tooltip.
  function tooltipText(icon) {
    const key = icon.dataset.tooltipKey;
    if (key && typeof glossaryText === 'function') {
      const txt = glossaryText(key);
      if (txt && txt !== key) return txt;
    }
    return icon.dataset.tooltip;
  }
  function show(icon) {
    const txt = tooltipText(icon);
    if (!txt) return;
    tt.textContent = txt;
    tt.style.display = 'block';
    const r = icon.getBoundingClientRect();
    let left = r.left + r.width/2 - tt.offsetWidth/2;
    let top  = r.top  - tt.offsetHeight - 10;
    if (top  < 8) top  = r.bottom + 10;
    if (left < 8) left = 8;
    if (left + tt.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tt.offsetWidth - 8;
    tt.style.left = left+'px'; tt.style.top = top+'px';
  }
  function hide() { tt.style.display = 'none'; }
  document.addEventListener('mouseover',  e => { const ic = e.target.closest('.info-icon'); if (ic) show(ic); });
  document.addEventListener('mouseout',   e => { if (e.target.closest('.info-icon')) hide(); });
  document.addEventListener('focusin',    e => { if (e.target.classList.contains('info-icon')) show(e.target); });
  document.addEventListener('focusout',   e => { if (e.target.classList.contains('info-icon')) hide(); });
  // Accessibility: expose the tooltip text to assistive technology.
  function updateAccessibleLabels() {
    document.querySelectorAll('.info-icon').forEach(function(ic) {
      const txt = tooltipText(ic);
      if (txt) { ic.setAttribute('role', 'img'); ic.setAttribute('aria-label', txt); }
    });
  }
  updateAccessibleLabels();
  document.addEventListener('dm:langchange', updateAccessibleLabels);
})();
