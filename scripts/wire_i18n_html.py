#!/usr/bin/env python3
"""Wire the strings hardcoded in web/index.html into the i18n layer.

Upstream left ~40 visible strings without a data-i18n / data-i18n-title
attribute, so App.applyI18n skipped them and they kept showing Chinese or
Japanese in every UI language. Chrome showed this live: with lang=en the
drawer still read ライザ / 离线重建版 · 不连接官方服务器 and the title overlay
still read ライザと話す.

Rules observed here:
  * data-i18n        rewrites .textContent          -> static label text
  * data-i18n-title  rewrites the title attribute   -> tooltips
  * a string the JS writes itself (drawer-day, log-name, log-sub, the
    posture buttons, voice-pill-label, hud level/money numbers) is NOT
    touched, or the two writers would fight each other.

Idempotent: an element that already carries the attribute is skipped.
"""
import re
import sys
from pathlib import Path

HTML = Path('web/index.html')
src = HTML.read_text(encoding='utf-8')

# (anchor substring, attribute to add). The anchor must be unique.
TEXT_ATTR = [
    ('<title>ライザと話す — Ryza Chat</title>',
     '<title data-i18n="app.title">与莱莎交谈</title>'),
    ('<div class="drawer-name">ライザ</div>',
     '<div class="drawer-name" data-i18n="drawer.name">莱莎</div>'),
    ('<div class="drawer-foot">离线重建版 · 不连接官方服务器</div>',
     '<div class="drawer-foot" data-i18n="app.about">离线重建版 · 不连接官方服务器</div>'),
    ('<h1>ライザと話す</h1>',
     '<h1 data-i18n="app.title">与莱莎交谈</h1>'),
    ('<button type="button" class="btn" id="onb-skip">跳过</button>',
     '<button type="button" class="btn" id="onb-skip" data-i18n="onb.skip">跳过</button>'),
    ('<button type="button" class="btn primary" id="onb-next">下一步</button>',
     '<button type="button" class="btn primary" id="onb-next" data-i18n="onb.next">下一步</button>'),
    ('<button class="mini-btn" id="btn-alarm-new">+ 新闹钟</button>',
     '<button class="mini-btn" id="btn-alarm-new" data-i18n="alarm.new">+ 新闹钟</button>'),
    ('<button class="mini-btn" id="btn-settings-reset">恢复默认</button>',
     '<button class="mini-btn" id="btn-settings-reset" data-i18n="settings.reset">恢复默认</button>'),
]

# Tooltips: replace the CJK title="..." with the locale key. Anchored on the
# element id so the exact original text can differ without breaking.
TITLE_KEYS = {
    'btn-menu':         ('メニュー',            'nav.menu'),
    'btn-voice':        ('音声 / テキスト',      'topbar.voiceMode'),
    'btn-expand':       ('メニュー',            'nav.menu'),
    'hud-stamina':      ('スタミナ',            'hud.stamina'),
    'hud-money':        ('所持金',              'hud.money'),
    'hud-level':        ('レベル',              'hud.level'),
    'btn-quick-toggle': ('ボタンを隠す',         'quick.hide'),
    'btn-zoom-in':      ('拡大',                'quick.zoomIn'),
    'btn-zoom-out':     ('縮小',                'quick.zoomOut'),
    'btn-zoom-reset':   ('標準',                'quick.zoomReset'),
    'btn-replay':       ('もう一度聞く',         'quick.replay'),
    'btn-voicefav':     ('お気に入り',           'quick.favorite'),
    'btn-log-toggle':   ('会話履歴',             'quick.history'),
    'btn-quest-sheet':  ('クエスト',             'quick.questSheet'),
    'btn-bag':          ('道具',                'quick.bag'),
    'btn-speed':        ('テキスト速度',         'input.speed'),
    'btn-newtalk':      ('新しい会話',           'input.newTalk'),
    'btn-send':         ('送信',                'input.send'),
}

# Placeholder text (not a title attribute).
PLACEHOLDER = {
    'input': ('和莱莎说点什么…', 'input.hint'),
}


def add_title(html, elem_id, old_text, key):
    """Turn title="<cjk>" into title="<cjk>" data-i18n-title="<key>"."""
    pat = re.compile(
        r'(id="%s"[^>]*?)\s+title="%s"' % (re.escape(elem_id), re.escape(old_text))
    )
    new, n = pat.subn(lambda m: '%s title="%s" data-i18n-title="%s"' % (m.group(1), old_text, key), html)
    return new, n


changed = []

for anchor, repl in TEXT_ATTR:
    if anchor not in src:
        if repl in src:
            continue                      # already applied
        sys.exit('anchor not found: %r' % anchor[:70])
    src = src.replace(anchor, repl, 1)
    changed.append(repl)

for elem_id, (old, key) in TITLE_KEYS.items():
    if 'id="%s"' % elem_id not in src:
        sys.exit('element not found: %s' % elem_id)
    if re.search(r'id="%s"[^>]*data-i18n-title' % re.escape(elem_id), src):
        continue                          # already has one
    src, n = add_title(src, elem_id, old, key)
    if n != 1:
        sys.exit('title not matched for %s (%s) -> %d hits' % (elem_id, old, n))
    changed.append('%s -> %s' % (elem_id, key))

for elem_id, (old, key) in PLACEHOLDER.items():
    if 'id="%s"' % elem_id not in src:
        sys.exit('element not found: %s' % elem_id)
    if re.search(r'id="%s"[^>]*data-i18n-ph' % re.escape(elem_id), src):
        continue
    pat = re.compile(r'(id="%s"[^>]*?)\s+placeholder="%s"' % (re.escape(elem_id), re.escape(old)))
    src, n = pat.subn(lambda m: '%s placeholder="%s" data-i18n-ph="%s"' % (m.group(1), old, key), src)
    if n != 1:
        sys.exit('placeholder not matched for %s -> %d' % (elem_id, n))
    changed.append('%s placeholder -> %s' % (elem_id, key))

HTML.write_text(src, encoding='utf-8')
print('index.html: %d edits' % len(changed))
for c in changed:
    print('   ', c[:100])
