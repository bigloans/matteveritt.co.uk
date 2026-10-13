(function () {
  var root = document.documentElement;
  var narrowContents = window.matchMedia("(max-width: 899.98px)");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  // Page theme. A stored choice wins; otherwise the system preference applies.

  var themeBtn = document.querySelector("[data-theme-toggle]");
  function pageIsDark() {
    var t = root.getAttribute("data-theme");
    return t ? t === "dark" : systemDark.matches;
  }
  function syncTheme() {
    themeBtn.setAttribute("aria-pressed", pageIsDark());
    document.dispatchEvent(new Event("themechange"));
  }
  if (themeBtn) {
    themeBtn.hidden = false;
    themeBtn.setAttribute("aria-pressed", pageIsDark());
    themeBtn.addEventListener("click", function () {
      var t = pageIsDark() ? "light" : "dark";
      root.setAttribute("data-theme", t);
      try { localStorage.setItem("theme", t); } catch (e) {}
      syncTheme();
    });
    if (systemDark.addEventListener) systemDark.addEventListener("change", syncTheme);
  }

  // Show the spec. Token names and values come from the :root rules in tokens.css.

  var specBtn = document.querySelector("[data-spec-toggle]");
  var specStatus = document.querySelector("[data-spec-status]");
  var layer = null;
  var specOn = false;

  function readTokens() {
    var names = [];
    [].forEach.call(document.styleSheets, function (sheet) {
      if (!sheet.href || !/\/tokens\.css$/.test(sheet.href)) return;
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; }
      (function walk(list) {
        [].forEach.call(list, function (r) {
          if (r.cssRules) walk(r.cssRules);
          if (!r.style) return;
          for (var i = 0; i < r.style.length; i++) {
            var n = r.style[i];
            if (n.indexOf("--") === 0 && names.indexOf(n) < 0) names.push(n);
          }
        });
      })(rules);
    });
    var cs = getComputedStyle(root);
    return names.map(function (n) { return { name: n, value: cs.getPropertyValue(n).trim() }; });
  }

  function hexToRgb(h) {
    if (!/^#[0-9a-f]{6}$/i.test(h)) return null;
    return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }
  function parseRgb(c) {
    var m = c.match(/[\d.]+/g);
    if (!m) return null;
    m = m.slice(0, 4).map(Number);
    if (c.indexOf("color(srgb") === 0) { m[0] *= 255; m[1] *= 255; m[2] *= 255; }
    return m;
  }
  function lum(c) {
    return [0, 1, 2].map(function (i) {
      var v = c[i] / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function backgroundOf(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = parseRgb(getComputedStyle(n).backgroundColor);
      if (c && (c[3] === undefined || c[3] === 1)) return c;
    }
    return parseRgb(getComputedStyle(document.body).backgroundColor);
  }

  function finder(tokens) {
    function byPattern(re, test, skip) {
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (re.test(t.name) && !(skip && skip.test(t.name)) && test(t.value)) return t;
      }
      return null;
    }
    return {
      px: function (family, px) {
        return byPattern(new RegExp("^--" + family + "-\\d+$"), function (v) { return parseFloat(v) === px && /px$/.test(v); });
      },
      leading: function (ratio) {
        return byPattern(/^--leading-/, function (v) { return Math.abs(parseFloat(v) - ratio) < 0.01; });
      },
      radius: function (value) {
        return byPattern(/^--radius-/, function (v) { return v === value; });
      },
      color: function (rgb, use) {
        var skip = use === "background" ? /^--color-(text|on-|redline|hairline)/ : /^--color-(surface|hairline)/;
        return byPattern(/^--color-/, function (v) {
          var c = hexToRgb(v);
          return !!c && c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2];
        }, skip);
      }
    };
  }

  // The text's own extent: its first line, or the union of every line.

  function textBox(el, firstLine) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var rects = [].filter.call(range.getClientRects(), function (r) { return r.width > 0; });
    if (!rects.length) return null;
    if (firstLine) {
      var top = rects[0].top;
      rects = rects.filter(function (r) { return Math.abs(r.top - top) < 2; });
    }
    var l = Math.min.apply(null, rects.map(function (r) { return r.left; }));
    var t = Math.min.apply(null, rects.map(function (r) { return r.top; }));
    var r = Math.max.apply(null, rects.map(function (r) { return r.right; }));
    var b = Math.max.apply(null, rects.map(function (r) { return r.bottom; }));
    return { left: l, top: t, width: r - l, height: b - t };
  }

  function round(n) { return Math.round(n * 100) / 100; }

  function describe(el, find) {
    var cs = getComputedStyle(el);
    var kind = el.getAttribute("data-spec");
    var prop = el.getAttribute("data-spec-prop");
    var rect = el.getBoundingClientRect();
    var a = { el: el, kind: kind, priority: +el.getAttribute("data-spec-priority") || 2, rect: rect };

    if (kind === "type") {
      var size = parseFloat(cs.fontSize), lead = round(parseFloat(cs.lineHeight) / size);
      var st = find.px("text", size), lt = find.leading(lead);
      a.ok = !!(st && lt);
      a.text = (st ? st.name : "untokenised") + ": " + size + " / " + lead + " / " + cs.fontWeight;
      a.box = textBox(el, true) || rect;
    } else if (kind === "space") {
      var key = prop.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      var px = parseFloat(cs[key]);
      var t = find.px("space", px);
      a.ok = !!t;
      a.text = (t ? t.name : "untokenised") + ": " + px + "px";
      var kids = [].filter.call(el.children, function (c) { return c.getBoundingClientRect().width > 0; });
      var x = rect.left + Math.min(24, rect.width / 2);
      if (prop === "margin-top") a.line = { v: true, x: x, y: rect.top - px, len: px };
      else if (prop === "padding-top") a.line = { v: true, x: x, y: rect.top, len: px };
      else if (prop === "padding-left") a.line = { v: false, x: rect.left, y: rect.top + Math.min(24, rect.height / 2), len: px };
      else if (prop === "row-gap" && kids[1]) {
        var b1 = kids[0].getBoundingClientRect();
        a.line = { v: true, x: b1.left + Math.min(24, b1.width / 2), y: b1.bottom, len: kids[1].getBoundingClientRect().top - b1.bottom };
      } else if (prop === "column-gap" && kids[1]) {
        var c1 = kids[0].getBoundingClientRect();
        a.line = { v: false, x: c1.right, y: c1.bottom + 8, len: kids[1].getBoundingClientRect().left - c1.right };
      }
      if (!a.line || a.line.len <= 0) return null;
    } else if (kind === "radius") {
      var r = cs.borderTopLeftRadius, rt = find.radius(r);
      a.ok = !!rt;
      a.text = (rt ? rt.name : "untokenised") + ": " + r;
      a.box = rect;
    } else if (kind === "color") {
      var use = prop === "background-color" ? "background" : "text";
      var fg = parseRgb(cs.color), bg = backgroundOf(el);
      var own = use === "background" ? bg : fg;
      var other = use === "background" ? fg : bg;
      var ct = find.color(own, use), ot = find.color(other, use === "background" ? "text" : "background");
      a.ok = !!(ct && ot);
      a.text = (ct ? ct.name : "untokenised") + ", " + contrast(fg, bg).toFixed(2) + ":1 " + (use === "background" ? "with " : "on ") + (ot ? ot.name : "untokenised");
      a.short = (ct ? ct.name : "untokenised") + ", " + contrast(fg, bg).toFixed(2) + ":1";
      a.box = use === "background" ? rect : textBox(el, false) || rect;
    } else return null;
    return a;
  }

  function overlaps(r, list) {
    return list.some(function (o) {
      return r.left < o.right + 4 && r.right + 4 > o.left && r.top < o.bottom + 4 && r.bottom + 4 > o.top;
    });
  }

  function draw() {
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "spec-layer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    layer.textContent = "";
    layer.style.height = root.scrollHeight + "px";
    var tokens = readTokens(), find = finder(tokens);
    var narrow = window.innerWidth < 520;
    var vw = root.clientWidth, sx = window.scrollX, sy = window.scrollY;
    var items = [].map.call(document.querySelectorAll("[data-spec]"), function (el) {
      return el.getBoundingClientRect().width ? describe(el, find) : null;
    }).filter(function (a) { return a && (!narrow || a.priority === 1); });
    items.sort(function (x, y) { return x.priority - y.priority; });

    var placed = [], shown = 0, untokenised = 0;
    items.forEach(function (a) {
      var label = document.createElement("span");
      label.className = "spec-label" + (a.ok ? "" : " is-untokenised");
      label.textContent = a.text;
      layer.appendChild(label);
      if (a.short && label.offsetWidth > vw - 8) label.textContent = a.short;
      var w = label.offsetWidth, h = label.offsetHeight;
      var spots = [];
      var b = a.box;
      if (a.line && a.line.v) {
        var mid = a.line.y + a.line.len / 2 - h / 2;
        spots.push({ left: a.line.x + 8, top: mid }, { left: a.line.x - w - 8, top: mid }, { left: a.line.x + 8, top: mid - h - 4 });
      } else if (a.line) {
        spots.push({ left: a.line.x, top: a.line.y + 6 }, { left: a.line.x + a.line.len - w, top: a.line.y + 6 });
      } else if (a.kind === "radius") {
        spots.push({ left: b.left, top: b.top - h - 4 }, { left: b.left, top: b.top + b.height + 4 }, { left: b.left + b.width + 8, top: b.top, fit: true });
      } else {
        spots.push({ left: b.left + b.width + 8, top: b.top, fit: true }, { left: b.left, top: b.top - h - 4 }, { left: b.left, top: b.top + b.height + 4 });
      }
      var spot = null;
      for (var i = 0; i < spots.length; i++) {
        var s = spots[i];
        if (s.fit && s.left + w > vw - 4) continue;
        s.left = Math.max(4, Math.min(s.left, vw - w - 4));
        var box = { left: s.left, top: s.top, right: s.left + w, bottom: s.top + h };
        if (!overlaps(box, placed)) { spot = box; break; }
      }
      if (!spot) { layer.removeChild(label); return; }
      placed.push(spot);
      label.style.left = spot.left + sx + "px";
      label.style.top = spot.top + sy + "px";
      var mark = document.createElement("span");
      if (a.line) {
        mark.className = "spec-line " + (a.line.v ? "v" : "h");
        mark.style.left = a.line.x + sx + "px";
        mark.style.top = a.line.y + sy + "px";
        mark.style[a.line.v ? "height" : "width"] = a.line.len + "px";
      } else {
        mark.className = "spec-box";
        mark.style.left = a.box.left + sx + "px";
        mark.style.top = a.box.top + sy + "px";
        mark.style.width = a.box.width + "px";
        mark.style.height = a.box.height + "px";
      }
      layer.insertBefore(mark, label);
      shown++;
      if (!a.ok) untokenised++;
    });
    layer.setAttribute("data-count", shown);
    layer.setAttribute("data-untokenised", untokenised);
    return shown;
  }

  function setSpec(on) {
    specOn = on;
    specBtn.setAttribute("aria-pressed", on);
    specBtn.textContent = on ? "Hide the spec" : "Show the spec";
    if (on) {
      var n = draw();
      requestAnimationFrame(function () { layer.classList.add("is-on"); });
      specStatus.textContent = "Showing " + n + " spec annotations. Press Escape to hide.";
    } else {
      if (layer) { layer.classList.remove("is-on"); layer.textContent = ""; }
      specStatus.textContent = "";
    }
  }

  if (specBtn && specStatus && document.querySelector("[data-spec]")) {
    specBtn.hidden = false;
    specBtn.addEventListener("click", function () { setSpec(!specOn); });
    var queued = false;
    var redraw = function () {
      if (!specOn || queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; if (specOn) draw(); });
    };
    window.addEventListener("resize", redraw);
    document.addEventListener("themechange", redraw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
  }

  // Contents. Sticky list on wide screens; a fixed button and sheet on narrow ones.

  var contents = document.querySelector(".contents");
  if (contents) {
    var openBtn = contents.querySelector(".contents-button");
    var closeBtn = contents.querySelector(".contents-close");
    var links = [].slice.call(contents.querySelectorAll("ol a"));
    var targets = links.map(function (a) { return document.getElementById(a.hash.slice(1)); });
    var setOpen = function (open, focus) {
      contents.classList.toggle("is-open", open);
      openBtn.setAttribute("aria-expanded", open);
      if (open) links[0].focus();
      else if (focus) openBtn.focus();
    };
    openBtn.addEventListener("click", function () { setOpen(!contents.classList.contains("is-open")); });
    closeBtn.addEventListener("click", function () { setOpen(false, true); });
    contents.addEventListener("click", function (e) {
      if (e.target.closest("ol a") && narrowContents.matches) setOpen(false);
    });
    contents.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && contents.classList.contains("is-open")) { e.stopPropagation(); setOpen(false, true); }
    });

    var current = -1, ticking = false;
    var mark = function () {
      ticking = false;
      var line = window.innerHeight * 0.3, idx = -1;
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= line) idx = i; });
      if (idx === current) return;
      current = idx;
      links.forEach(function (a, i) {
        if (i === idx) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(mark); }
    }, { passive: true });
    mark();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && specOn) setSpec(false);
  });

  // Demo theme toggle. It changes the preview only, never the page.

  var stage = document.getElementById("stage");
  if (stage) {
    var setters = [].slice.call(document.querySelectorAll("[data-set]"));
    setters.forEach(function (b) {
      b.addEventListener("click", function () {
        stage.setAttribute("data-reg", b.getAttribute("data-set"));
        setters.forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      });
    });
  }

  // Motion: reveal on scroll, count-up figures, typed windows and funnel bars.
  // With reduced motion, everything shows in its final state at once.

  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var countUp = function (el) {
    var end = +el.getAttribute("data-count"), suffix = el.getAttribute("data-suffix") || "";
    if (still) return;
    var t0 = null, dur = 1400;
    var step = function (t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(end * e) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = "0" + suffix;
    requestAnimationFrame(step);
  };
  var showing = function (el) {
    el.classList.add("in");
    [].forEach.call(el.querySelectorAll ? el.querySelectorAll("[data-count]") : [], countUp);
    if (el.hasAttribute && el.hasAttribute("data-count")) countUp(el);
  };
  var animated = [].slice.call(document.querySelectorAll(".reveal, .typed, .funnel-bars"));
  if (still || !("IntersectionObserver" in window)) {
    animated.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        showing(e.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -5% 0px" });
    animated.forEach(function (el) { io.observe(el); });
  }

  // Spotlight that follows the pointer across cards.

  document.addEventListener("pointermove", function (e) {
    var card = e.target.closest && e.target.closest(".spot");
    if (!card) return;
    var r = card.getBoundingClientRect();
    card.style.setProperty("--mx", e.clientX - r.left + "px");
    card.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });

  // Reading progress in the contents list.

  var progress = document.querySelector(".contents-progress");
  var article = document.querySelector(".article-main");
  if (progress && article) {
    var queuedP = false;
    var setProgress = function () {
      queuedP = false;
      var r = article.getBoundingClientRect();
      var k = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - window.innerHeight)));
      progress.style.setProperty("--progress", k.toFixed(3));
    };
    window.addEventListener("scroll", function () {
      if (!queuedP) { queuedP = true; requestAnimationFrame(setProgress); }
    }, { passive: true });
    setProgress();
  }

  // Contrast ratios. The HTML carries them already; this recalculates from the colours.

  [].forEach.call(document.querySelectorAll("[data-fg]"), function (el) {
    var fg = hexToRgb(el.getAttribute("data-fg")), bg = hexToRgb(el.getAttribute("data-bg"));
    if (fg && bg) el.textContent = contrast(fg, bg).toFixed(2) + ":1";
  });
})();
