#!/usr/bin/env python3
"""Second pass: the remaining static strings in web/index.html.

These are the ones that either sit in an element the JS never writes, or
whose only CJK was a tooltip. Elements the JS does write (hud-place, hud-tod,
hud-mode, drawer-day, log-name, log-sub, the posture buttons) are left alone
here — app.js already routes those through I18n.* keys, and its output at
runtime is correct; adding data-i18n would make two writers fight.
"""
import re
import sys
from pathlib import Path

HTML = Path('web/index.html')
src = HTML.read_text(encoding='utf-8')

# Plain: (anchor, replacement)
PLAIN = [
    # NPC sheet heading — static, JS only fills #npc-sheet-list.
    ('<h3 id="npc-sheet-title">この場所にいる人</h3>',
     '<h3 id="npc-sheet-title" data-i18n="world.herePeople">此处的人</h3>'),
    # World header buttons: the label lives in a <span> inside the button.
    ('<button class="mini-btn" id="btn-world-mode">🗺 <span>地图</span></button>',
     '<button class="mini-btn" id="btn-world-mode">🗺 <span data-i18n="world.map">地图</span></button>'),
]

# Tooltips whose CJK is the only reason the line is flagged. The element's
# visible text is written by the JS, so only title= is wired.
TITLES = [
    ('hud-place', '所在地',   'scene.place'),
    ('hud-tod',   '時間帯',   'world.tod'),
    ('hud-mode',  '対話モード', 'mode.label'),
    ('btn-map',   'ワールドマップ', 'world.mapShort'),
]

# Visible initial text for the JS-written chips: translated now so the first
# paint is right, then overwritten by app.js with the live value.
INITIAL = [
    ('<button type="button" class="hud-chip" id="hud-tod" title="時間帯">昼</button>',
     '<button type="button" class="hud-chip" id="hud-tod" title="時間帯" data-i18n-title="world.tod">时段</button>'),
    ('<button type="button" class="hud-chip" id="hud-mode" title="対話モード">雑談</button>',
     '<button type="button" class="hud-chip" id="hud-mode" title="対話モード" data-i18n-title="mode.label">闲聊</button>'),
]

changed = []

for anchor, repl in PLAIN:
    if anchor in src:
        src = src.replace(anchor, repl, 1)
        changed.append(repl[:80])
    elif repl in src:
        pass
    else:
        sys.exit('anchor not found: %r' % anchor[:70])

for anchor, repl in INITIAL:
    if anchor in src:
        src = src.replace(anchor, repl, 1)
        changed.append(repl[:80])
    elif repl in src:
        pass
    else:
        sys.exit('initial-text anchor not found: %r' % anchor[:70])

for elem_id, old, key in TITLES:
    if re.search(r'id="%s"[^>]*data-i18n-title' % re.escape(elem_id), src):
        continue
    pat = re.compile(r'(id="%s"[^>]*?)\s+title="%s"' % (re.escape(elem_id), re.escape(old)))
    src, n = pat.subn(lambda m: '%s title="%s" data-i18n-title="%s"' % (m.group(1), old, key), src)
    if n != 1:
        sys.exit('title anchor not matched: %s (%s) -> %d' % (elem_id, old, n))
    changed.append('%s -> %s' % (elem_id, key))

HTML.write_text(src, encoding='utf-8')
print('pass 2: %d edits' % len(changed))
for c in changed:
    print('   ', c)
