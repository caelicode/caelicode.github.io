(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var header = document.querySelector('[data-site-header]');
  var themeToggle = document.querySelector('[data-theme-toggle]');
  var menuToggle = document.querySelector('[data-menu-toggle]');
  var navigation = document.querySelector('[data-navigation]');
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var storageKey = 'caelicode-platform-theme';

  function currentTheme() {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function updateThemeControl() {
    if (!themeToggle) return;
    var isDark = currentTheme() === 'dark';
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeToggle.setAttribute('aria-label', isDark ? 'Use light theme' : 'Use dark theme');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#081d19' : '#103029');
  }

  function setTheme(theme, persist) {
    root.dataset.theme = theme;
    updateThemeControl();
    if (persist) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch (error) {
        // The interface still works when storage is unavailable.
      }
    }
  }

  updateThemeControl();

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
  }

  function closeMenu(options) {
    if (!menuToggle || !navigation) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.querySelector('.sr-only').textContent = 'Open navigation';
    navigation.classList.remove('is-open');
    body.classList.remove('menu-open');
    if (options && options.restoreFocus) menuToggle.focus();
  }

  function openMenu() {
    if (!menuToggle || !navigation) return;
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.querySelector('.sr-only').textContent = 'Close navigation';
    navigation.classList.add('is-open');
    body.classList.add('menu-open');
  }

  if (menuToggle && navigation) {
    menuToggle.addEventListener('click', function () {
      if (menuToggle.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      } else {
        openMenu();
      }
    });

    navigation.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
        closeMenu({ restoreFocus: true });
      }
    });

    document.addEventListener('click', function (event) {
      if (menuToggle.getAttribute('aria-expanded') !== 'true') return;
      if (!navigation.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 920) closeMenu();
    });
  }

  function updateHeader() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  }

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    var controls = Array.from(tabs.querySelectorAll('[role="tab"]'));
    var panels = Array.from(tabs.querySelectorAll('[role="tabpanel"]'));

    function selectTab(selected, moveFocus) {
      controls.forEach(function (control) {
        var isSelected = control === selected;
        control.setAttribute('aria-selected', String(isSelected));
        control.tabIndex = isSelected ? 0 : -1;
      });

      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.panel !== selected.dataset.tab;
      });

      if (moveFocus) selected.focus();
    }

    controls.forEach(function (control, index) {
      control.addEventListener('click', function () {
        selectTab(control, false);
      });

      control.addEventListener('keydown', function (event) {
        var targetIndex = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (index + 1) % controls.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (index - 1 + controls.length) % controls.length;
        if (event.key === 'Home') targetIndex = 0;
        if (event.key === 'End') targetIndex = controls.length - 1;
        if (targetIndex === index && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        selectTab(controls[targetIndex], true);
      });
    });
  });

  var sections = Array.from(document.querySelectorAll('main section[id]'));
  var navLinks = Array.from(document.querySelectorAll('.primary-navigation a[href^="#"]'));
  if ('IntersectionObserver' in window && sections.length && navLinks.length) {
    var observed = new Map();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        observed.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      });
      var active = Array.from(observed.entries()).sort(function (a, b) { return b[1] - a[1]; })[0];
      navLinks.forEach(function (link) {
        var isCurrent = active && active[1] > 0 && link.getAttribute('href') === '#' + active[0];
        if (isCurrent) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.15, 0.5] });
    sections.forEach(function (section) { observer.observe(section); });
  }

  document.querySelectorAll('[data-year]').forEach(function (year) {
    year.textContent = String(new Date().getFullYear());
  });
}());
