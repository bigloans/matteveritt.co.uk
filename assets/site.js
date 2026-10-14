(function () {
  var root = document.documentElement;
  var narrowContents = window.matchMedia("(max-width: 899.98px)");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var rootStyle = getComputedStyle(root);
  var drawMs = parseFloat(rootStyle.getPropertyValue("--motion-draw")) || 0;
  var stagger = parseFloat(rootStyle.getPropertyValue("--motion-stagger")) || 0;

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

  // Every line box of an element's text, one rect per line.

  function lineBoxes(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var rows = [];
    [].forEach.call(range.getClientRects(), function (r) {
      if (!r.width) return;
      var row = rows.filter(function (x) { return Math.abs(x.top - r.top) < 2; })[0];
      if (row) { row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    });
    return rows;
  }

  // Real ascent, cap height and x-height for the element's font, measured on a canvas.

  var metricCtx = document.createElement("canvas").getContext("2d");
  function fontMetrics(cs) {
    metricCtx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    var H = metricCtx.measureText("H"), x = metricCtx.measureText("x");
    return { ascent: H.fontBoundingBoxAscent, cap: H.actualBoundingBoxAscent, x: x.actualBoundingBoxAscent };
  }

  // What to draw for one element. Each element becomes one group of parts.

  function describe(el, find) {
    var cs = getComputedStyle(el);
    var kind = el.getAttribute("data-spec");
    var prop = el.getAttribute("data-spec-prop");
    var rect = el.getBoundingClientRect();
    var g = { el: el, priority: +el.getAttribute("data-spec-priority") || 2, rect: rect, parts: [], ok: true, top: rect.top };
    var component = el.getAttribute("data-spec-component");
    if (component) g.parts.push({ type: "frame", box: rect, name: component });

    if (kind === "type") {
      var size = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight), lead = round(lh / size);
      var st = find.px("text", size), lt = find.leading(lead);
      g.ok = !!(st && lt);
      var rows = lineBoxes(el).slice(0, 3);
      if (!rows.length) return null;
      g.parts.push({ type: "type", rows: rows, size: size, lh: lh, metrics: fontMetrics(cs) });
      var last = rows[rows.length - 1];
      g.label = { text: (st ? st.name : "untokenised") + ": " + size + " / " + lead + " / " + cs.fontWeight, near: { left: rows[0].left, top: rows[0].top, width: rows[0].right - rows[0].left, height: rows[0].bottom - rows[0].top }, tail: { left: last.right + 12, top: last.top + (last.bottom - last.top) / 2 - 12 } };
    } else if (kind === "space") {
      var key = prop.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      var px = parseFloat(cs[key]), t = find.px("space", px);
      g.ok = !!t;
      var kids = [].filter.call(el.children, function (c) { return c.getBoundingClientRect().width > 0; });
      var area = null, line = null;
      if (prop === "margin-top") {
        area = { left: rect.left, top: rect.top - px, width: rect.width, height: px };
        line = { v: true, x: rect.left + Math.min(32, rect.width / 2), y: rect.top - px, len: px };
      } else if (prop === "padding-top") {
        area = { left: rect.left, top: rect.top, width: rect.width, height: px };
        line = { v: true, x: rect.left + Math.min(96, rect.width / 4), y: rect.top, len: px };
      } else if (prop === "column-gap" && kids[1]) {
        var c1 = kids[0].getBoundingClientRect(), c2 = kids[1].getBoundingClientRect();
        if (c2.left - c1.right <= 0) return null;
        area = { left: c1.right, top: Math.max(c1.top, c2.top), width: c2.left - c1.right, height: Math.min(c1.bottom, c2.bottom) - Math.max(c1.top, c2.top) };
        line = { v: false, x: c1.right, y: area.top + area.height / 2, len: c2.left - c1.right };
      } else if (prop === "row-gap" && kids[1]) {
        var r1 = kids[0].getBoundingClientRect(), r2 = kids[1].getBoundingClientRect();
        if (r2.top - r1.bottom <= 0) return null;
        area = { left: r1.left, top: r1.bottom, width: r1.width, height: r2.top - r1.bottom };
        line = { v: true, x: r1.left + Math.min(32, r1.width / 2), y: r1.bottom, len: r2.top - r1.bottom };
      }
      if (!area || area.height <= 0 || area.width <= 0) return null;
      g.top = area.top;
      g.parts.push({ type: "space", area: area, line: line });
      g.token = t ? t.name : null;
      g.key = prop;
      g.label = { text: (t ? t.name : "untokenised") + ": " + px + "px", line: line };
    } else if (kind === "radius") {
      var r = cs.borderTopLeftRadius, rt = find.radius(r);
      g.ok = !!rt;
      var rpx = r.indexOf("%") > 0 ? Math.min(rect.width, rect.height) / 2 : parseFloat(r);
      g.parts.push({ type: "radius", box: rect, r: Math.min(rpx, rect.height / 2) });
      g.label = { text: (rt ? rt.name : "untokenised") + ": " + r, near: rect, above: true };
    } else if (kind === "color") {
      var use = prop === "background-color" ? "background" : "text";
      var fg = parseRgb(cs.color), bg = backgroundOf(el);
      var own = use === "background" ? bg : fg, other = use === "background" ? fg : bg;
      var ct = find.color(own, use), ot = find.color(other, use === "background" ? "text" : "background");
      g.ok = !!(ct && ot);
      var near = use === "background" ? rect : textBox(el, false) || rect;
      g.label = { text: (ct ? ct.name : "untokenised") + ", " + contrast(fg, bg).toFixed(2) + ":1", swatch: "rgb(" + own.slice(0, 3).join(",") + ")", near: near, side: true };
    } else if (!component) return null;
    return g;
  }

  function overlaps(r, list, gap) {
    var m = gap == null ? 4 : gap;
    return list.some(function (o) {
      return r.left < o.right + m && r.right + m > o.left && r.top < o.bottom + m && r.bottom + m > o.top;
    });
  }

  function piece(cls, box, parent) {
    var n = document.createElement("span");
    n.className = cls;
    if (box) {
      n.style.left = box.left + "px";
      n.style.top = box.top + "px";
      if (box.width != null) n.style.width = box.width + "px";
      if (box.height != null) n.style.height = box.height + "px";
    }
    (parent || layer).appendChild(n);
    return n;
  }

  // Draw the canvas: rulers, the layout grid, then one group per annotated element.

  function draw() {
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "spec-layer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    layer.textContent = "";
    var docH = root.scrollHeight;
    layer.style.height = docH + "px";
    var tokens = readTokens(), find = finder(tokens);
    var narrow = window.innerWidth < 520, wide = window.innerWidth >= 900;
    var vw = root.clientWidth, sx = window.scrollX, sy = window.scrollY;
    var toDoc = function (b) { return { left: b.left + sx, top: b.top + sy, width: b.width, height: b.height }; };
    var header = document.querySelector(".site-header");
    var headH = header ? header.offsetHeight : 0;

    var placed = [];

    // Layout grid, read from the page container.

    var pageEl = document.querySelector("main .page");
    if (pageEl) {
      var pr = pageEl.getBoundingClientRect(), pcs = getComputedStyle(pageEl);
      var gl = pr.left + parseFloat(pcs.paddingLeft), gw = pr.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
      var cols = wide ? 12 : 4;
      var grid = piece("sp-grid", { left: gl + sx, top: 0, width: gw, height: docH });
      grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      grid.style.columnGap = getComputedStyle(root).getPropertyValue(wide ? "--space-32" : "--space-16");
      for (var c = 0; c < cols; c++) piece("sp-col", null, grid).style.setProperty("--c", c);
      if (!narrow) {
        var gt = piece("sp-tag sp-grid-tag", { left: 0, top: 0 });
        gt.textContent = "Layout grid, " + cols + " columns, " + (wide ? "--space-32" : "--space-16") + " gutters";
        gt.style.left = gl + gw - gt.offsetWidth + sx + "px";
        gt.style.top = headH + 32 + "px";
        placed.push({ left: gl + gw - gt.offsetWidth, top: headH + 32 - sy, right: gl + gw, bottom: headH + 32 - sy + gt.offsetHeight });
      }

      // Rulers, with the grid's left edge as zero.

      if (!narrow) {
        var top = piece("sp-ruler sp-ruler-top", { left: 0, top: headH, width: vw, height: null });
        var left = piece("sp-ruler sp-ruler-left", { left: 0, top: headH, width: null, height: docH - headH });
        top.style.backgroundPositionX = gl + "px";
        for (var x = 0; gl + x < vw; x += 128) piece("sp-tick-n", { left: gl + x + 4, top: 0 }, top).textContent = x;
        for (var y = 0; y < docH - headH; y += 128) piece("sp-tick-n v", { left: 0, top: y + 4 }, left).textContent = y;
      }
    }

    var els = [].slice.call(document.querySelectorAll("[data-spec], [data-spec-component]"));
    var groups = els.map(function (el) {
      return el.getBoundingClientRect().width ? describe(el, find) : null;
    }).filter(function (g) { return g && (!narrow || g.priority === 1); });
    groups.sort(function (x, y) { return x.priority - y.priority; });

    // Obstacles are the shapes each group draws, not whole elements, so a section's padding doesn't block its neighbours.

    var obstacles = [];
    groups.forEach(function (g) {
      g.parts.forEach(function (p) {
        if (p.type === "frame") return;
        var r = p.type === "radius" ? { left: p.box.left, top: p.box.top, width: Math.max(16, p.r * 2), height: Math.max(16, p.r * 2) } : p.area;
        if (p.rows) r = { left: p.rows[0].left, top: p.rows[0].top, width: Math.max.apply(null, p.rows.map(function (x) { return x.right; })) - p.rows[0].left, height: p.rows[p.rows.length - 1].bottom - p.rows[0].top };
        if (r) obstacles.push({ owner: g, left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height });
      });
      if (g.label && g.label.near) { var n = g.label.near; obstacles.push({ owner: g, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height }); }
    });
    var shown = 0, untokenised = 0;
    var tryPlace = function (node, spots, owner, avoidOthers) {
      var w = node.offsetWidth, h = node.offsetHeight;
      for (var i = 0; i < spots.length; i++) {
        var s = spots[i];
        if (s.fit && s.left + w > vw - 4) continue;
        var l = Math.max(4, Math.min(s.left, vw - w - 4));
        var box = { left: l, top: s.top, right: l + w, bottom: s.top + h };
        if (overlaps(box, placed)) continue;
        if (avoidOthers && overlaps(box, obstacles.filter(function (o) { return o.owner !== owner; }), 0)) continue;
        placed.push(box);
        node.style.left = l + sx + "px";
        node.style.top = s.top + sy + "px";
        return true;
      }
      return false;
    };

    groups.forEach(function (g) {
      var group = piece("spec-g");
      g.node = group;
      g.parts.forEach(function (p) {
        if (p.type === "frame") {
          var f = piece("sp-frame", toDoc(p.box), group);
          ["tl", "tr", "bl", "br"].forEach(function (k) { piece("sp-handle " + k, null, f); });
          var tag = piece("sp-tag", null, group);
          tag.textContent = p.name;
          if (!tryPlace(tag, [{ left: p.box.left, top: p.box.top - tag.offsetHeight - 6 }, { left: p.box.right - tag.offsetWidth, top: p.box.top - tag.offsetHeight - 6 }, { left: p.box.left, top: p.box.top + 6 }], g)) group.removeChild(tag);
          var dims = piece("sp-dims", null, group);
          var W = Math.round(p.box.width), H = Math.round(p.box.height);
          dims.textContent = W + " × " + H;
          if (!tryPlace(dims, [{ left: p.box.left + p.box.width / 2 - dims.offsetWidth / 2, top: p.box.bottom + 6 }, { left: p.box.right - dims.offsetWidth, top: p.box.bottom - dims.offsetHeight - 6 }], g)) group.removeChild(dims);
        } else if (p.type === "space") {
          piece("sp-hatch", toDoc(p.area), group);
          var L = p.line;
          var m = piece("sp-measure " + (L.v ? "v" : "h"), L.v ? { left: L.x + sx, top: L.y + sy, height: L.len } : { left: L.x + sx, top: L.y + sy, width: L.len }, group);
          m.style[L.v ? "height" : "width"] = L.len + "px";
        } else if (p.type === "type") {
          p.rows.forEach(function (row, i) {
            var band = piece("sp-band" + (i % 2 ? " alt" : ""), toDoc({ left: row.left, top: row.top, width: row.right - row.left, height: row.bottom - row.top }), group);
            band.style.setProperty("--r", i);
            piece("sp-guide base", null, band).style.top = p.metrics.ascent + "px";
            piece("sp-guide cap", null, band).style.top = p.metrics.ascent - p.metrics.cap + "px";
            piece("sp-guide x", null, band).style.top = p.metrics.ascent - p.metrics.x + "px";
          });
        } else if (p.type === "radius") {
          var size = Math.max(16, p.r * 2);
          var arc = piece("sp-arc", toDoc({ left: p.box.left, top: p.box.top, width: size, height: size }), group);
          arc.style.borderTopLeftRadius = p.r + "px";
        }
      });

      if (g.label) {
        var lab = piece("spec-label" + (g.ok ? "" : " is-untokenised"), null, group);
        if (g.label.swatch) { var sw = document.createElement("i"); sw.className = "sp-swatch"; sw.style.background = g.label.swatch; lab.appendChild(sw); }
        lab.appendChild(document.createTextNode(g.label.text));
        var w = lab.offsetWidth, h = lab.offsetHeight, spots = [];
        if (g.label.line && g.label.line.v) {
          var L2 = g.label.line, mid = L2.y + L2.len / 2 - h / 2;
          spots.push({ left: L2.x + 10, top: mid }, { left: L2.x - w - 10, top: mid });
        } else if (g.label.line) {
          var L3 = g.label.line;
          var below = g.parts[0].area.top + g.parts[0].area.height + 8;
          spots.push({ left: L3.x + L3.len / 2 - w / 2, top: below }, { left: L3.x + L3.len / 2 - w / 2, top: g.parts[0].area.top - h - 8 });
        } else {
          var b = g.label.near, bb = { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
          if (g.label.tail) spots.push({ left: bb.right + 10, top: bb.top, fit: true }, { left: g.label.tail.left, top: g.label.tail.top, fit: true });
          if (g.label.above) spots.push({ left: bb.left, top: bb.top - h - 6 }, { left: bb.left, top: bb.bottom + 6 });
          spots.push({ left: bb.right + 10, top: bb.top + (bb.bottom - bb.top - h) / 2, fit: true }, { left: bb.left, top: bb.top - h - 6 }, { left: bb.left, top: bb.bottom + 6 });
        }
        var spotOk = false;
        for (var i = 0; i < spots.length && !spotOk; i++) spotOk = tryPlace(lab, [spots[i]], g, !!spots[i].fit);
        if (!spotOk) group.removeChild(lab);
        else g.labelNode = lab;
      }
      if (!group.children.length) { layer.removeChild(group); return; }
      shown++;
      if (!g.ok) untokenised++;
    });

    layer.setAttribute("data-count", shown);
    layer.setAttribute("data-untokenised", untokenised);
    return groups.filter(function (g) { return g.node && g.node.parentNode; });
  }

  // Groups draw in document order, top to bottom, one stagger step apart.

  var live = [];

  function choreograph(instant) {
    live.slice().sort(function (x, y) { return x.top - y.top; }).forEach(function (g, i) {
      g.node.style.setProperty("--d", instant ? "0ms" : i * stagger + "ms");
      g.node.classList.add("on");
    });
  }

  // When a breakpoint changes a spacing step, the changed label says what it was.

  var lastSpace = new Map();

  function markChanges() {
    var next = new Map();
    live.forEach(function (g) {
      if (!g.key || !g.labelNode) return;
      var before = lastSpace.get(g.el);
      next.set(g.el, g.token);
      if (before && g.token && before !== g.token) {
        g.labelNode.lastChild.textContent = "was " + before + ", now " + g.token;
        g.labelNode.classList.add("is-changed");
        setTimeout(function () { g.labelNode.classList.remove("is-changed"); }, 1200);
      }
    });
    lastSpace = next;
  }

  var hideTimer = null;
  function setSpec(on) {
    specOn = on;
    specBtn.setAttribute("aria-pressed", on);
    specBtn.textContent = on ? "Hide the spec" : "Show the spec";
    clearTimeout(hideTimer);
    if (on) {
      live = draw();
      lastSpace = new Map();
      markChanges();
      layer.getBoundingClientRect();
      layer.classList.add("is-on");
      choreograph(still);
      specStatus.textContent = "Showing " + live.length + " spec annotations. Press Escape to hide.";
    } else {
      if (layer) {
        layer.classList.remove("is-on");
        hideTimer = setTimeout(function () { if (!specOn) layer.textContent = ""; }, parseFloat(rootStyle.getPropertyValue("--motion-fast")) || 0);
      }
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
      requestAnimationFrame(function () {
        queued = false;
        if (!specOn) return;
        layer.classList.add("instant");
        live = draw();
        choreograph(true);
        requestAnimationFrame(function () {
          layer.classList.remove("instant");
          markChanges();
        });
      });
    };
    window.addEventListener("resize", redraw);
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

  // Contrast ratios. The HTML carries them already; this recalculates from the colours.

  [].forEach.call(document.querySelectorAll("[data-fg]"), function (el) {
    var fg = hexToRgb(el.getAttribute("data-fg")), bg = hexToRgb(el.getAttribute("data-bg"));
    if (fg && bg) el.textContent = contrast(fg, bg).toFixed(2) + ":1";
  });
})();
