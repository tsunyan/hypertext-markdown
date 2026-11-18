  document.documentElement.classList.remove('no-js');
  try {
    var t = localStorage.getItem('hypertext-markdown:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    var w = parseInt(localStorage.getItem('hypertext-markdown:measure'), 10);
    if (w >= 480) document.documentElement.style.setProperty('--measure', w + 'px');
    var sw = parseInt(localStorage.getItem('hypertext-markdown:sidebar-width'), 10);
    if (sw >= 200 && sw <= 480) document.documentElement.style.setProperty('--side-w', sw + 'px');
  } catch (e) {}
