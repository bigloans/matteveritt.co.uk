#!/usr/bin/env python3
"""Verify the case study page against the rebuild brief.

Usage: python3 scripts/check_case_study.py [path/to/page.html]

Exits non-zero when any blocking check fails.
"""

import math
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "index.html"

ALLOWED_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP_TEXT = {"script", "style", "head", "title", "noscript", "template"}
DIGIT_EXEMPT_TAGS = {"code", "pre", "style", "script"}
WORDS_PER_MIN = 230

# Digit sequences that are not claims.

MONTHS = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
ALLOW = [
    r"\b2\.5\.8\b",
    r"\b2\.2\b",
    r"\b4\.5:1\b",
    r"\b3:1\b",
    r"\b1\.0\b",
    r"\b0[1-5]\b",
    r"(?:\b\d{1,2}\s+)?\b" + MONTHS + r"\s+\d{4}\b",
    r"\bArticle\s+50\b",
    r"\b[vV]1\b",
    r"\b\d+\s+min read\b",
]


# DOM -----------------------------------------------------------------------

class Node:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []

    @property
    def classes(self):
        return set((self.attrs.get("class") or "").split())

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def iter(self):
        yield self
        for c in self.elements():
            yield from c.iter()

    def ancestors(self):
        n = self.parent
        while n is not None:
            yield n
            n = n.parent

    def has(self, attr):
        return attr in self.attrs

    def own_text(self):
        return "".join(c for c in self.children if isinstance(c, str))


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(html):
    b = Builder()
    b.feed(html)
    return b.root


# CSS -----------------------------------------------------------------------

class Rule:
    def __init__(self, selector, decls, media, order):
        self.selector = selector
        self.decls = decls
        self.media = media
        self.order = order


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def split_top(s, sep=","):
    out, depth, buf = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == sep and depth == 0:
            out.append(buf)
            buf = ""
        else:
            buf += ch
    out.append(buf)
    return [x.strip() for x in out if x.strip()]


def parse_decls(body):
    decls = {}
    for part in split_top(body, ";"):
        if ":" in part:
            k, v = part.split(":", 1)
            decls[k.strip().lower()] = v.replace("!important", "").strip()
    return decls


def parse_css(css, media=None, rules=None, counter=None):
    rules = [] if rules is None else rules
    counter = counter if counter is not None else [0]
    i = 0
    while i < len(css):
        j = css.find("{", i)
        if j == -1:
            break
        head = css[i:j].strip()
        depth, k = 1, j + 1
        while k < len(css) and depth:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        body = css[j + 1:k - 1]
        if head.startswith("@media"):
            parse_css(body, head, rules, counter)
        elif head.startswith("@"):
            pass
        else:
            for sel in split_top(head):
                counter[0] += 1
                rules.append(Rule(sel, parse_decls(body), media, counter[0]))
        i = k
    return rules


# Selectors -----------------------------------------------------------------

STATE_PSEUDO = {"hover", "focus", "focus-visible", "focus-within", "active", "visited"}
ELEMENT_PSEUDO = {"before", "after", "placeholder", "selection"}


def tokenize_compound(comp):
    """Split a compound selector into (kind, value) parts."""
    parts, i = [], 0
    m = re.match(r"[a-zA-Z][\w-]*|\*", comp)
    if m:
        if m.group() != "*":
            parts.append(("tag", m.group().lower()))
        i = m.end()
    while i < len(comp):
        ch = comp[i]
        if ch in ".#":
            m = re.match(r"[\w-]+", comp[i + 1:])
            parts.append(("class" if ch == "." else "id", m.group()))
            i += 1 + m.end()
        elif ch == "[":
            j = comp.index("]", i)
            inner = comp[i + 1:j]
            m = re.match(r'\s*([\w-]+)\s*(?:([~|^$*]?=)\s*["\']?([^"\']*)["\']?)?\s*$', inner)
            parts.append(("attr", (m.group(1), m.group(2), m.group(3))))
            i = j + 1
        elif ch == ":":
            el = comp.startswith("::", i)
            i += 2 if el else 1
            m = re.match(r"[\w-]+", comp[i:])
            name = m.group().lower()
            i += m.end()
            arg = None
            if i < len(comp) and comp[i] == "(":
                depth, j = 1, i + 1
                while depth:
                    depth += {"(": 1, ")": -1}.get(comp[j], 0)
                    j += 1
                arg = comp[i + 1:j - 1]
                i = j
            parts.append(("pseudo", (name, arg)))
        else:
            i += 1
    return parts


def parse_selector(sel):
    """Return a list of (combinator, parts) from left to right."""
    sel = re.sub(r"\s*([>+~])\s*", r" \1 ", sel.strip())
    out, comb = [], " "
    for tok in sel.split():
        if tok in ">+~":
            comb = tok
            continue
        out.append((comb, tokenize_compound(tok)))
        comb = " "
    return out


def specificity(sel):
    a = b = c = 0
    for _, parts in parse_selector(sel):
        for kind, val in parts:
            if kind == "id":
                a += 1
            elif kind in ("class", "attr"):
                b += 1
            elif kind == "tag":
                c += 1
            elif kind == "pseudo":
                name, arg = val
                if name in ELEMENT_PSEUDO:
                    c += 1
                elif name == "not" and arg:
                    sa, sb, sc = specificity(arg)
                    a, b, c = a + sa, b + sb, c + sc
                else:
                    b += 1
    return (a, b, c)


def nth_match(expr, idx):
    expr = expr.replace(" ", "")
    if expr == "odd":
        expr = "2n+1"
    if expr == "even":
        expr = "2n"
    if "n" not in expr:
        return idx == int(expr)
    a, b = expr.split("n")
    a = -1 if a == "-" else int(a or 1)
    b = int(b or 0)
    if a == 0:
        return idx == b
    return (idx - b) / a >= 0 and (idx - b) % a == 0


def match_compound(node, parts):
    if not isinstance(node, Node) or node.tag.startswith("#"):
        return False
    for kind, val in parts:
        if kind == "tag" and node.tag != val:
            return False
        if kind == "class" and val not in node.classes:
            return False
        if kind == "id" and node.attrs.get("id") != val:
            return False
        if kind == "attr":
            name, op, want = val
            if name not in node.attrs:
                return False
            have = node.attrs.get(name) or ""
            if op == "=" and have != want:
                return False
            if op == "~=" and want not in have.split():
                return False
        if kind == "pseudo":
            name, arg = val
            sibs = node.parent.elements() if node.parent else [node]
            idx = sibs.index(node) + 1
            if name in STATE_PSEUDO or name in ELEMENT_PSEUDO:
                continue
            if name == "last-child" and idx != len(sibs):
                return False
            if name == "first-child" and idx != 1:
                return False
            if name == "nth-child" and not nth_match(arg, idx):
                return False
            if name == "not" and match_compound(node, tokenize_compound(arg)):
                return False
            if name == "root" and node.tag != "html":
                return False
    return True


def matches(node, chain):
    if not chain or not match_compound(node, chain[-1][1]):
        return False
    if len(chain) == 1:
        return True
    comb = chain[-1][0]
    rest = chain[:-1]
    if comb == ">":
        return matches(node.parent, rest)
    if comb == "+":
        sibs = node.parent.elements()
        i = sibs.index(node)
        return i > 0 and matches(sibs[i - 1], rest)
    return any(matches(a, rest) for a in node.ancestors())


def selector_flags(sel):
    state = element = False
    for _, parts in parse_selector(sel):
        for kind, val in parts:
            if kind == "pseudo":
                state |= val[0] in STATE_PSEUDO
                element |= val[0] in ELEMENT_PSEUDO
    return state, element


# Colour --------------------------------------------------------------------

NAMED = {"white": (255, 255, 255, 1), "black": (0, 0, 0, 1), "transparent": (0, 0, 0, 0)}


def parse_color(s):
    s = s.strip().lower()
    if s in NAMED:
        return NAMED[s]
    m = re.fullmatch(r"#([0-9a-f]{3,8})", s)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return (r, g, b, a)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", s)
    if m:
        p = [x for x in re.split(r"[\s,/]+", m.group(1)) if x]
        r, g, b = (float(x) for x in p[:3])
        a = float(p[3]) if len(p) > 3 else 1
        return (r, g, b, a)
    return None


COLOR_TOKEN = r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|transparent)\b"


def blend(fg, bg):
    a = fg[3]
    return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3)) + (1,)


def luminance(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def hexify(c):
    return "#%02x%02x%02x" % tuple(round(v) for v in c[:3])


# Cascade -------------------------------------------------------------------

class Styles:
    def __init__(self, root, rules, scheme):
        self.root = root
        self.scheme = scheme
        self.rules = [r for r in rules if self.media_applies(r.media)]
        self.vars = {}
        for r in self.rules:
            if r.selector.strip() == ":root":
                self.vars.update({k: v for k, v in r.decls.items() if k.startswith("--")})
        self.index = {}
        for node in root.iter():
            if node.tag.startswith("#"):
                continue
            hits = []
            for r in self.rules:
                state, element = selector_flags(r.selector)
                if state or element or "reveal" in r.selector:
                    continue
                if matches(node, parse_selector(r.selector)):
                    hits.append(r)
            self.index[id(node)] = hits

    def media_applies(self, media):
        if media is None:
            return True
        if "prefers-color-scheme" in media:
            return self.scheme == "dark" and "dark" in media
        return False

    def resolve(self, value, depth=0):
        if value is None or depth > 10:
            return value
        def sub(m):
            name, fallback = m.group(1), m.group(3)
            return self.vars.get(name, fallback or "")
        out = re.sub(r"var\(\s*(--[\w-]+)\s*(,\s*([^)]*))?\)", sub, value)
        return self.resolve(out, depth + 1) if "var(" in out else out

    def declared(self, node, props):
        """Winning value for any of props on node, inline style included."""
        best = None
        for r in self.index.get(id(node), []):
            for p in props:
                if p in r.decls:
                    key = (specificity(r.selector), r.order)
                    if best is None or key >= best[0]:
                        best = (key, p, r.decls[p], r.selector)
        style = parse_decls(node.attrs.get("style") or "")
        for p in props:
            if p in style:
                best = ((9, 0, 0), p, style[p], "style attribute")
        if best is None:
            return None
        return best[1], self.resolve(best[2]), best[3]

    def color(self, node):
        for n in [node, *node.ancestors()]:
            if n.tag.startswith("#"):
                continue
            d = self.declared(n, ["color"])
            if d and d[1].strip().lower() not in ("inherit", "currentcolor"):
                return d[1], d[2]
        return "#000000", "UA default"

    def opacity(self, node):
        op = 1.0
        for n in [node, *node.ancestors()]:
            if n.tag.startswith("#"):
                continue
            d = self.declared(n, ["opacity"])
            if d:
                try:
                    op *= float(d[1])
                except ValueError:
                    pass
        return op

    def backgrounds(self, node):
        """Candidate background colours behind node's text."""
        chain = [n for n in [node, *node.ancestors()] if not n.tag.startswith("#")]
        layers = []
        for n in chain:
            d = self.declared(n, ["background", "background-color", "background-image"])
            if not d:
                continue
            cands = background_candidates(d[1])
            if cands is None:
                continue
            layers.append(cands)
            if all(c[3] >= 1 for c in cands):
                break
        base = [(255, 255, 255, 1)]
        for cands in reversed(layers):
            base = [blend(c, b) for c in cands for b in base]
        return base

    def font(self, node):
        size, weight = 16.0, 400
        chain = [n for n in [node, *node.ancestors()] if not n.tag.startswith("#")]
        for n in reversed(chain):
            if n.tag in ("b", "strong", "th"):
                weight = 700
            d = self.declared(n, ["font"])
            if d:
                m = re.match(r"\s*(\d{3})?\s*([\d.]+)px", d[1])
                if m:
                    weight = int(m.group(1) or 400)
                    size = float(m.group(2))
            d = self.declared(n, ["font-size"])
            if d:
                size = css_length(d[1], size)
            d = self.declared(n, ["font-weight"])
            if d and d[1].isdigit():
                weight = int(d[1])
        return size, weight


def css_length(v, parent):
    v = v.strip()
    m = re.match(r"clamp\(\s*([\d.]+)px", v)
    if m:
        return float(m.group(1))
    m = re.match(r"([\d.]+)(px|em|rem|%)", v)
    if not m:
        return parent
    n, unit = float(m.group(1)), m.group(2)
    return {"px": n, "em": n * parent, "rem": n * 16, "%": n / 100 * parent}[unit]


def background_candidates(value):
    """Colours that can sit behind text for a background value, or None if transparent."""
    layers = split_top(value)
    for layer in layers:
        if layer.startswith("radial-gradient"):
            continue
        if layer.startswith(("linear-gradient", "repeating-linear-gradient")):
            stops = [parse_color(c) for c in re.findall(COLOR_TOKEN, layer)]
            stops = [c for c in stops if c and c[3] > 0]
            return stops or None
        cols = [parse_color(c) for c in re.findall(COLOR_TOKEN, layer)]
        cols = [c for c in cols if c]
        if cols:
            return None if cols[0][3] == 0 else [cols[0]]
    return None


# Checks --------------------------------------------------------------------

def body_of(root):
    return next((n for n in root.iter() if n.tag == "body"), root)


def in_attr(node, attr):
    return any(n.has(attr) for n in [node, *node.ancestors()] if isinstance(n, Node))


def visible_texts(root, exclude_illustrative=True):
    """Yield (node, text) for visible text, skipping hidden subtrees."""
    def walk(n):
        if n.tag in SKIP_TEXT or n.has("hidden"):
            return
        if exclude_illustrative and n.has("data-illustrative"):
            return
        for c in n.children:
            if isinstance(c, str):
                if c.strip():
                    yield n, c
            else:
                yield from walk(c)
    yield from walk(body_of(root))


def check_em_dash(root):
    bad = [(n.tag, t.strip()[:80]) for n, t in visible_texts(root, False) if "—" in t]
    return bad


def check_digits(root):
    offenders = []
    for n, t in visible_texts(root, False):
        chain = [n, *n.ancestors()]
        if any(isinstance(a, Node) and (a.tag in DIGIT_EXEMPT_TAGS or a.has("data-fact")
               or a.has("data-ph") or a.has("data-illustrative")) for a in chain):
            continue
        context = " ".join(text_of(n).split())
        stripped = context
        for pat in ALLOW:
            stripped = re.sub(pat, " ", stripped)
        own = t
        for pat in ALLOW:
            own = re.sub(pat, " ", own)
        if re.search(r"\d", own) and re.search(r"\d", stripped):
            offenders.append((n.tag, re.findall(r"\S*\d\S*", own), context[:120]))
    return offenders


def text_of(n):
    return "".join(c if isinstance(c, str) else text_of(c) for c in n.children
                   if isinstance(c, str) or c.tag not in SKIP_TEXT)


def words(root):
    count = 0
    for _, t in visible_texts(root, True):
        count += len(re.findall(r"[A-Za-z0-9£][\w'’.+£:-]*", t))
    return count


def byline_minutes(root):
    for _, t in visible_texts(root, False):
        m = re.search(r"(\d+)\s+min read", t)
        if m:
            return int(m.group(1))
    return None


def placeholders(root):
    return [n.attrs["data-ph"] for n in root.iter() if n.has("data-ph")]


def check_hosts(root):
    bad = []
    for n in root.iter():
        if n.tag not in ("script", "link", "img"):
            continue
        for attr in ("src", "href"):
            url = n.attrs.get(attr)
            if not url:
                continue
            m = re.match(r"(?:https?:)?//([^/:?#]+)", url)
            if m and m.group(1).lower() not in ALLOWED_HOSTS:
                bad.append((n.tag, attr, url))
    return bad


def check_contrast(root, css, scheme):
    styles = Styles(root, css, scheme)
    fails, unresolved, exempt, checked = [], [], [], 0
    seen = set()
    for n, _ in visible_texts(root, False):
        if id(n) in seen or in_attr(n, "aria-hidden") and n.tag == "span" and "cursor" in n.classes:
            continue
        seen.add(id(n))
        if any("sr-only" in a.classes for a in [n, *n.ancestors()] if isinstance(a, Node)):
            continue
        fg_raw, source = styles.color(n)
        fg = parse_color(fg_raw)
        label = describe(n)
        if n.has("data-contrast-exempt"):
            exempt.append(label)
            continue
        if fg is None or fg[3] == 0:
            unresolved.append((label, source, f"color {fg_raw}"))
            continue
        fg = fg[:3] + (fg[3] * styles.opacity(n),)
        size, weight = styles.font(n)
        large = size >= 24 or (size >= 18.66 and weight >= 700)
        need = 3.0 if large else 4.5
        worst = min(ratio(blend(fg, bg), bg) for bg in styles.backgrounds(n))
        checked += 1
        if worst < need:
            bg = min(styles.backgrounds(n), key=lambda b: ratio(blend(fg, b), b))
            fails.append((label, source, hexify(blend(fg, bg)), hexify(bg), worst, need))
    return checked, fails, unresolved, exempt


def describe(n):
    path = []
    for a in [n, *n.ancestors()][:3]:
        if not isinstance(a, Node) or a.tag.startswith("#"):
            break
        cls = "." + ".".join(sorted(a.classes)) if a.classes else ""
        path.append(a.tag + cls)
    text = " ".join(text_of(n).split())[:40]
    return " < ".join(path) + f' "{text}"'


def unmatched_color_rules(root, rules):
    """Rules that set colour on text but match nothing in the static page."""
    out = []
    for r in rules:
        if "color" not in r.decls or r.media:
            continue
        state, element = selector_flags(r.selector)
        if state or element:
            continue
        chain = parse_selector(r.selector)
        if not any(matches(n, chain) for n in root.iter() if not n.tag.startswith("#")):
            out.append(r.selector)
    return out


# Variants ------------------------------------------------------------------

def variant_light_demo(root):
    """The theme demo in its light state."""
    for n in root.iter():
        if n.attrs.get("id") == "stage":
            n.attrs["data-reg"] = "light"
    return "theme demo set to light"


def variant_draft_banner(root):
    """The draft banner the page script injects."""
    body = body_of(root)
    banner = Node("div", [("class", "draft-banner")], body)
    banner.children.append("Draft: 1 placeholders unresolved")
    body.children.insert(0, banner)
    return "draft banner injected"


# Main ----------------------------------------------------------------------

def main():
    html = PAGE.read_text(encoding="utf-8")
    css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, flags=re.S))
    rules = parse_css(strip_comments(css))
    failed = []

    def section(title):
        print(f"\n== {title}")

    section("Em dashes")
    bad = check_em_dash(parse(html))
    for tag, t in bad:
        print(f"  FAIL <{tag}> {t}")
    print("  ok" if not bad else "")
    if bad:
        failed.append("em dashes")

    section("Digits outside facts, placeholders and illustrations")
    bad = check_digits(parse(html))
    for tag, toks, ctx in bad:
        print(f"  FAIL <{tag}> {' '.join(toks)}  ::  {ctx}")
    print("  ok" if not bad else "")
    if bad:
        failed.append("stray digits")

    schemes = ["light"]
    if any(r.media and "prefers-color-scheme" in r.media for r in rules):
        schemes.append("dark")
    variants = [None, variant_light_demo, variant_draft_banner]
    for scheme in schemes:
        for variant in variants:
            root = parse(html)
            name = variant(root) if variant else "page as served"
            section(f"Contrast ({scheme} scheme, {name})")
            checked, fails, unresolved, exempt = check_contrast(root, rules, scheme)
            print(f"  {checked} text nodes checked")
            groups = {}
            for label, src, fg, bg, r, need in fails:
                groups.setdefault((src, fg, bg, round(r, 2), need), []).append(label)
            for (src, fg, bg, r, need), labels in groups.items():
                more = f" (+{len(labels) - 1} more)" if len(labels) > 1 else ""
                print(f"  FAIL {r:.2f}:1 < {need}:1  {fg} on {bg}  [{src}]  {labels[0]}{more}")
            for label, src, why in unresolved:
                print(f"  MANUAL {why}  [{src}]  {label}")
            for label in exempt:
                print(f"  EXEMPT (intentional demo)  {label}")
            if fails:
                failed.append(f"contrast ({scheme}, {name})")

    section("Colour rules with no match in the static page (review manually)")
    for sel in unmatched_color_rules(parse(html), rules):
        print(f"  {sel}")

    section("Placeholders")
    ph = placeholders(parse(html))
    ids = sorted(set(ph), key=lambda s: int(s[1:]))
    print(f"  {len(ph)} instances, {len(ids)} ids: {', '.join(ids) or 'none'}")

    section("Read time")
    root = parse(html)
    n = words(root)
    mins = math.ceil(n / WORDS_PER_MIN)
    shown = byline_minutes(root)
    print(f"  {n} visible words excluding illustrations, {mins} min read, byline says {shown}")
    if shown != mins:
        failed.append("read time")
        print("  FAIL byline read time differs")

    section("External hosts")
    bad = check_hosts(parse(html))
    for tag, attr, url in bad:
        print(f"  FAIL <{tag} {attr}> {url}")
    print("  ok" if not bad else "")
    if bad:
        failed.append("external hosts")

    print("\n" + ("PASS" if not failed else "FAILED: " + ", ".join(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
