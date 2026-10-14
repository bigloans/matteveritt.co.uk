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
      g.label = { text: (t ? t.name : "untokenised") + ": " + px + "px", count: { name: t ? t.name : "untokenised", px: px }, line: line };
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
      g.counters = [];
      g.parts.forEach(function (p) {
        if (p.type === "frame") {
          var f = piece("sp-frame", toDoc(p.box), group);
          ["tl", "tr", "bl", "br"].forEach(function (k) { piece("sp-handle " + k, null, f); });
          var tag = piece("sp-tag", null, group);
          tag.textContent = "◇ " + p.name;
          if (!tryPlace(tag, [{ left: p.box.left, top: p.box.top - tag.offsetHeight - 6 }, { left: p.box.right - tag.offsetWidth, top: p.box.top - tag.offsetHeight - 6 }, { left: p.box.left, top: p.box.top + 6 }], g)) group.removeChild(tag);
          var dims = piece("sp-dims", null, group);
          var W = Math.round(p.box.width), H = Math.round(p.box.height);
          dims.textContent = W + " × " + H;
          if (tryPlace(dims, [{ left: p.box.left + p.box.width / 2 - dims.offsetWidth / 2, top: p.box.bottom + 6 }, { left: p.box.right - dims.offsetWidth, top: p.box.bottom - dims.offsetHeight - 6 }], g)) {
            g.counters.push({ node: dims, fmt: function (k) { return Math.round(W * k) + " × " + Math.round(H * k); } });
          } else group.removeChild(dims);
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
        if (spotOk && g.label.count && g.ok) {
          var C = g.label.count;
          g.counters.push({ node: lab, fmt: function (k) { return C.name + ": " + Math.round(C.px * k) + "px"; } });
        }
      }
      if (!group.children.length) { layer.removeChild(group); return; }
      shown++;
      if (!g.ok) untokenised++;
    });

    layer.setAttribute("data-count", shown);
    layer.setAttribute("data-untokenised", untokenised);
    return groups.filter(function (g) { return g.node && g.node.parentNode; });
  }

  // Choreography. A scan line sweeps the viewport and each group draws as the line reaches it.
  // Groups further down draw when they scroll into view.

  var scanMs = 1000, scanDelay = 250, groupIO = null, live = [];

  function runCounters(g, delay) {
    if (still) return;
    g.counters.forEach(function (c) {
      var t0 = null, final = c.node.textContent;
      c.node.textContent = c.fmt(0);
      var step = function (t) {
        if (!specOn) return;
        if (t0 === null) t0 = t + delay;
        var k = Math.max(0, Math.min(1, (t - t0) / drawMs));
        c.node.textContent = k >= 1 ? final : c.fmt(1 - Math.pow(1 - k, 3));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function reveal(g, delay) {
    g.node.style.setProperty("--d", delay + "ms");
    g.node.classList.add("on");
    runCounters(g, delay);
  }

  function scan() {
    if (still) return;
    var line = document.createElement("span");
    line.className = "sp-scan";
    line.setAttribute("aria-hidden", "true");
    line.style.setProperty("--scan", scanMs + "ms");
    line.style.animationDelay = scanDelay + "ms";
    document.body.appendChild(line);
    setTimeout(function () { if (line.parentNode) line.parentNode.removeChild(line); }, scanDelay + scanMs + 400);
  }

  function choreograph(instant) {
    if (groupIO) { groupIO.disconnect(); groupIO = null; }
    var vh = window.innerHeight;
    if (instant || still) { live.forEach(function (g) { g.node.classList.add("on"); }); return; }
    var later = [];
    live.forEach(function (g) {
      if (g.top < vh) reveal(g, scanDelay + Math.max(0, g.top) / vh * scanMs);
      else later.push(g);
    });
    if (!later.length || !("IntersectionObserver" in window)) { later.forEach(function (g) { reveal(g, 0); }); return; }
    groupIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        groupIO.unobserve(e.target);
        var g = later.filter(function (x) { return x.node === e.target.parentNode; })[0];
        if (g) reveal(g, 80);
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    later.forEach(function (g) { if (g.node.firstChild) groupIO.observe(g.node.firstChild); });
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
    specBtn.lastChild.textContent = on ? "Hide the spec" : "Show the spec";
    clearTimeout(hideTimer);
    if (on) {
      if (layer) layer.className = "spec-layer";

      // Measure the final layout: finish every reveal and drop any tilt first.

      root.classList.add("spec-measure");
      [].forEach.call(document.querySelectorAll(".reveal, .typed, .funnel-bars"), function (el) { el.classList.add("in"); });
      [].forEach.call(document.querySelectorAll("[data-tilt]"), function (el) { el.style.transform = ""; });
      root.getBoundingClientRect();
      live = draw();
      lastSpace = new Map();
      markChanges();
      requestAnimationFrame(function () { root.classList.remove("spec-measure"); });
      layer.getBoundingClientRect();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!specOn) return;
          layer.classList.add("is-on");
          scan();
          choreograph(false);
        });
      });
      specStatus.textContent = "Showing " + live.length + " spec annotations. Press Escape to hide.";
    } else {
      if (groupIO) { groupIO.disconnect(); groupIO = null; }
      if (layer) {
        layer.classList.add("is-leaving");
        hideTimer = setTimeout(function () { if (!specOn) { layer.textContent = ""; layer.className = "spec-layer"; } }, still ? 0 : 360);
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

  // Site menu. Below 900px the links and "Show the spec" sit in a sheet that traps focus while open.

  var siteHeader = document.querySelector(".site-header");
  var menuBtn = document.querySelector(".menu-button");
  var menu = document.getElementById("site-menu");
  var menuOpen = false;
  if (siteHeader && menuBtn && menu) {
    menuBtn.hidden = false;
    var focusables = function () {
      return [menuBtn].concat([].filter.call(menu.querySelectorAll("a, button"), function (el) { return !el.hidden; }));
    };
    var setMenu = function (open, returnFocus) {
      menuOpen = open;
      siteHeader.classList.toggle("is-open", open);
      menuBtn.setAttribute("aria-expanded", open);
      menuBtn.textContent = open ? "Close" : "Menu";
      if (open) menu.querySelector("a").focus();
      else if (returnFocus) menuBtn.focus();
    };
    menuBtn.addEventListener("click", function () { setMenu(!menuOpen); });
    menu.addEventListener("click", function (e) {
      if (menuOpen && e.target.closest("a, button")) setMenu(false, e.target.matches("button"));
    });
    siteHeader.addEventListener("keydown", function (e) {
      if (!menuOpen) return;
      if (e.key === "Escape") { e.stopPropagation(); setMenu(false, true); return; }
      if (e.key !== "Tab") return;
      var f = focusables(), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener("click", function (e) {
      if (menuOpen && !siteHeader.contains(e.target)) setMenu(false);
    });
    narrowContents.addEventListener("change", function (e) { if (!e.matches && menuOpen) setMenu(false); });
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

  // Tilt on the feature card, a few degrees towards the pointer.

  if (!still) [].forEach.call(document.querySelectorAll("[data-tilt]"), function (el) {
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = "perspective(1400px) rotateX(" + (-y * 3).toFixed(2) + "deg) rotateY(" + (x * 4).toFixed(2) + "deg)";
    });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; });
  });

  // The pink pill in the radius art follows the pointer to the nearest edge of its box.

  var pills = [].slice.call(document.querySelectorAll(".art-radius"));
  if (pills.length && !still) {
    var pillState = pills.map(function (art) {
      return { art: art, box: art.children[1], pill: art.children[2], x: 32, y: 12, tx: 32, ty: 12 };
    });
    var animating = false;
    var tick = function () {
      animating = false;
      pillState.forEach(function (p) {
        p.x += (p.tx - p.x) * 0.14;
        p.y += (p.ty - p.y) * 0.14;
        p.pill.style.setProperty("--px", p.x.toFixed(2) + "px");
        p.pill.style.setProperty("--py", p.y.toFixed(2) + "px");
        if (Math.abs(p.tx - p.x) > 0.2 || Math.abs(p.ty - p.y) > 0.2) animating = true;
      });
      if (animating) requestAnimationFrame(tick);
    };
    document.addEventListener("pointermove", function (e) {
      pillState.forEach(function (p) {
        var b = p.box.getBoundingClientRect(), pr = p.pill.getBoundingClientRect();
        var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        var dx = e.clientX - cx, dy = e.clientY - cy, len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len, pad = 6;
        var ax = Math.max(0, (b.width - pr.width) / 2 - pad), ay = Math.max(0, (b.height - pr.height) / 2 - pad);
        var t = Math.min(ux ? ax / Math.abs(ux) : Infinity, uy ? ay / Math.abs(uy) : Infinity);
        p.tx = ux * t;
        p.ty = uy * t;
      });
      if (!animating) { animating = true; requestAnimationFrame(tick); }
    }, { passive: true });
  }

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

  // Try the gate. Each checkbox applies one real kind of violation to the card,
  // and the panel lists findings in the gate's message format.

  var gateDemo = document.querySelector("[data-gate-demo]");
  if (gateDemo) {
    var card = gateDemo.querySelector("[data-demo-card]");
    var img = card.querySelector("img"), title = card.querySelector(".demo-card-title"), cardBtn = card.querySelector(".demo-card-btn");
    var alt = img.getAttribute("alt");
    var out = gateDemo.querySelector("[data-gate-output]"), gateStatus = gateDemo.querySelector("[data-gate-status]");
    var rules = {
      hex: { apply: function (on) { title.style.color = on ? "#ff0000" : ""; }, line: "card.css:3  <span class=\"fail\">[colour]</span>  raw hex colour `#ff0000` — use a semantic `--color-*` token" },
      padding: { apply: function (on) { card.style.padding = on ? "15px" : ""; }, line: "card.css:5  <span class=\"fail\">[spacing]</span>  off-scale spacing `15px` — not a scale step; nearest is `16px` (use its `--spacing-*` / `--space-*` token)" },
      alt: { apply: function (on) { if (on) img.removeAttribute("alt"); else img.setAttribute("alt", alt); }, line: "card.html:2  <span class=\"fail\">[a11y]</span>  &lt;img&gt; is missing required \"alt\" attribute (wcag/h37)" },
      ghost: { apply: function (on) { cardBtn.style.color = on ? getComputedStyle(root).getPropertyValue("--demo-ghost-fg") : ""; }, line: "card.html:4  <span class=\"fail\">[contrast]</span>  button label 3.34:1 on its surface — text needs 4.5:1 (WCAG 1.4.3)" }
    };
    var boxes = [].slice.call(gateDemo.querySelectorAll("[data-violation]"));
    var render = function () {
      var lines = [];
      boxes.forEach(function (b) {
        var r = rules[b.getAttribute("data-violation")];
        r.apply(b.checked);
        if (b.checked) lines.push(r.line);
      });
      var n = lines.length;
      var verdict = n ? "FAIL, " + n + " violation" + (n === 1 ? "" : "s") : "PASS, 0 violations";
      var files = lines.length ? "\n" + lines.map(function (l) { return "  " + l; }).join("\n") + "\n" : "";
      out.innerHTML = "<span class=\"hint\">passes: static, rendered\nchecked 2 governed file(s)</span>\n" + files + "\n<span class=\"" + (n ? "fail" : "ok") + "\">" + verdict + "</span>";
      gateStatus.textContent = "Gate result: " + verdict + ".";
    };
    boxes.forEach(function (b) { b.addEventListener("change", render); });
  }

  // Follow a bug. A marker carries the bug from agent to agent along a rail.
  // Previous, Next and Play move it. Positions are measured, so the rail works across or down.

  var bugDemo = document.querySelector("[data-bug-demo]");
  if (bugDemo) {
    var rail = bugDemo.querySelector(".bug-rail"), track = bugDemo.querySelector(".bug-track"), fill = bugDemo.querySelector(".bug-fill"), marker = bugDemo.querySelector(".bug-marker");
    var steps = [].slice.call(bugDemo.querySelectorAll("[data-step]"));
    var nodes = steps.map(function (s) { return s.querySelector(".bug-node"); });
    var detail = bugDemo.querySelector("[data-bug-detail]");
    var count = bugDemo.querySelector("[data-bug-count]"), roleEl = bugDemo.querySelector("[data-bug-role]"), sentence = bugDemo.querySelector("[data-bug-sentence]");
    var prev = bugDemo.querySelector("[data-bug-prev]"), next = bugDemo.querySelector("[data-bug-next]"), play = bugDemo.querySelector("[data-bug-play]");
    var bugStatus = bugDemo.querySelector("[data-bug-status]");
    var at = 0, timer = null, moveTimer = null;
    var stepMs = 1800;

    var centres = function () {
      var r = rail.getBoundingClientRect();
      return nodes.map(function (n) {
        var b = n.getBoundingClientRect();
        return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
      });
    };
    var place = function () {
      var c = centres(), first = c[0], last = c[c.length - 1], here = c[at];
      var across = Math.abs(last.y - first.y) < 2;
      var rule = 2;
      track.style.left = first.x - (across ? 0 : rule / 2) + "px";
      track.style.top = first.y - (across ? rule / 2 : 0) + "px";
      track.style.width = (across ? last.x - first.x : rule) + "px";
      track.style.height = (across ? rule : last.y - first.y) + "px";
      fill.style.setProperty("--fill-w", (across ? here.x - first.x : rule) + "px");
      fill.style.setProperty("--fill-h", (across ? rule : here.y - first.y) + "px");
      marker.style.setProperty("--mx", here.x + "px");
      marker.style.setProperty("--my", here.y + "px");
    };
    var show = function (i, announce) {
      var moved = i !== at;
      at = i;
      steps.forEach(function (s, j) {
        s.classList.toggle("is-done", j < i);
        if (j === i) s.setAttribute("aria-current", "step");
        else s.removeAttribute("aria-current");
      });
      bugDemo.classList.toggle("is-pass", steps[i].getAttribute("data-tone") === "pass");
      if (moved && !still) {
        bugDemo.classList.add("is-moving");
        clearTimeout(moveTimer);
        moveTimer = setTimeout(function () { bugDemo.classList.remove("is-moving"); }, 700);
      }
      var text = steps[i].querySelector(".bug-text").textContent;
      count.textContent = "Step " + (i + 1) + " of " + steps.length;
      roleEl.textContent = steps[i].querySelector(".bug-role").textContent;
      sentence.textContent = text;
      detail.classList.remove("swap");
      detail.getBoundingClientRect();
      detail.classList.add("swap");
      prev.setAttribute("aria-disabled", i === 0);
      next.setAttribute("aria-disabled", i === steps.length - 1);
      place();
      if (announce) bugStatus.textContent = "Step " + (i + 1) + " of " + steps.length + ". " + text;
    };
    var stop = function () {
      clearInterval(timer);
      timer = null;
      play.setAttribute("aria-pressed", "false");
      play.textContent = "Play";
    };
    prev.addEventListener("click", function () { stop(); if (at > 0) show(at - 1, true); });
    next.addEventListener("click", function () { stop(); if (at < steps.length - 1) show(at + 1, true); });
    play.addEventListener("click", function () {
      if (timer) { stop(); return; }
      if (at === steps.length - 1) show(0, true);
      play.setAttribute("aria-pressed", "true");
      play.textContent = "Pause";
      timer = setInterval(function () {
        if (at < steps.length - 1) show(at + 1, true);
        if (at === steps.length - 1) stop();
      }, stepMs);
    });
    detail.hidden = false;
    bugDemo.querySelector(".bug-controls").hidden = false;
    bugDemo.classList.add("instant");
    show(0, false);
    requestAnimationFrame(function () { bugDemo.classList.remove("instant"); });
    var queuedBug = false;
    window.addEventListener("resize", function () {
      if (queuedBug) return;
      queuedBug = true;
      requestAnimationFrame(function () {
        queuedBug = false;
        bugDemo.classList.add("instant");
        place();
        requestAnimationFrame(function () { bugDemo.classList.remove("instant"); });
      });
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  }

  // Contrast ratios. The HTML carries them already; this recalculates from the colours.

  [].forEach.call(document.querySelectorAll("[data-fg]"), function (el) {
    var fg = hexToRgb(el.getAttribute("data-fg")), bg = hexToRgb(el.getAttribute("data-bg"));
    if (fg && bg) el.textContent = contrast(fg, bg).toFixed(2) + ":1";
  });
})();
