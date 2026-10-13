// Paste into the devtools console, or evaluate with Playwright, at 1444 x 862, 390 x 844 and 320 x 568 in both colour schemes.
// Set html{scroll-behavior:auto} first, so contentsReachable measures after the jump rather than mid-animation.

(() => {
  scrollTo(0, 0);
  const cs = e => getComputedStyle(e);
  const els = [...document.querySelectorAll('body *')].filter(e => cs(e).display !== 'none');
  const hasText = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const uniq = f => [...new Set(els.flatMap(f))].sort((a, b) => parseFloat(a) - parseFloat(b));
  const rgb = c => {
    const n = (c.match(/[\d.]+/g) || []).map(Number);
    return c.startsWith('color(srgb') ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : n;
  };
  const lin = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const mix = (f, b) => { const a = f[3] ?? 1; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)); };
  const bgOf = e => {
    const layers = [];
    for (let n = e; n; n = n.parentElement) {
      const c = rgb(cs(n).backgroundColor);
      if (c.length && (c[3] ?? 1) > 0) { layers.push(c); if ((c[3] ?? 1) === 1) break; }
    }
    return layers.reverse().reduce((acc, c) => mix(c, acc), [255, 255, 255]);
  };
  const text = els.filter(hasText);
  const lowContrast = text.flatMap(e => {
    const f = rgb(cs(e).color);
    if ((f[3] ?? 1) === 0) return [];
    const b = bgOf(e), [hi, lo] = [lum(mix(f, b)), lum(b)].sort((x, y) => y - x);
    const r = (hi + 0.05) / (lo + 0.05), s = parseFloat(cs(e).fontSize), w = +cs(e).fontWeight;
    const need = s >= 24 || (s >= 18.66 && w >= 700) ? 3 : 4.5;
    return r < need ? [`${r.toFixed(2)}:1 ${e.textContent.trim().slice(0, 30)}`] : [];
  });
  const tl = els.find(e => e.textContent.trim() === 'Timeline');
  // Quoted artefacts keep their original punctuation, so character checks skip them.

  const quoted = [...document.querySelectorAll('[data-artefact]')].map(e => e.innerText).join(' ');
  let body = document.body.innerText;
  for (const q of quoted.split(/\n+/).filter(Boolean)) body = body.replace(q, ' ');
  return {
    sizes: uniq(e => hasText(e) ? [cs(e).fontSize] : []),
    spacing: uniq(e => ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap']
      .map(k => cs(e)[k]).filter(v => v && !['0px', 'normal', 'auto'].includes(v))),
    radii: uniq(e => cs(e).borderTopLeftRadius === '0px' ? [] : [cs(e).borderTopLeftRadius]),
    small: text.filter(e => parseFloat(cs(e).fontSize) < 14).map(e => `${cs(e).fontSize} ${e.textContent.trim().slice(0, 30)}`),
    lowContrast,
    foldOK: tl ? tl.parentElement.getBoundingClientRect().bottom <= innerHeight : 'Timeline label not found',
    hScroll: document.documentElement.scrollWidth > innerWidth,
    caps: text.filter(e => cs(e).textTransform === 'uppercase').length,
    middots: (body.match(/·/g) || []).length,
    arrows: (body.match(/→/g) || []).length,
    dashes: (body.match(/[–—]/g) || []).length,
    words: body.split(/\s+/).length,
    fonts: [...new Set(els.filter(hasText).map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g, '').trim()))],
    docH: document.documentElement.scrollHeight,
    specShown: +(document.querySelector('.spec-layer.is-on')?.dataset.count || 0),
    untokenised: +(document.querySelector('.spec-layer.is-on')?.dataset.untokenised || 0),
    fold: (() => {
      const h1 = document.querySelector('h1'), next = document.querySelector('.hero .btn-primary, .summary dt') || h1;
      return !!h1 && !!next && h1.getBoundingClientRect().top >= 0 && next.getBoundingClientRect().bottom <= innerHeight;
    })(),
    contentsReachable: (() => {
      scrollTo(0, document.documentElement.scrollHeight / 2);
      const c = [...document.querySelectorAll('nav, button, summary')].find(e => /contents/i.test(e.textContent));
      const r = c && c.getBoundingClientRect();
      return !!r && r.bottom > 0 && r.top < innerHeight;
    })()
  };
})();
