#!/usr/bin/env python3
"""Add the missing i18n keys for strings hardcoded in web/index.html.

Upstream left ~40 visible strings without a data-i18n attribute, so
App.applyI18n never touched them and they stayed Chinese/Japanese in every
UI language. This inserts the corresponding keys into the T table.

Idempotent: re-running skips keys that already exist.
"""
import re
import sys
from pathlib import Path

I18N = Path('web/js/i18n.js')
src = I18N.read_text(encoding='utf-8')

# group -> {locale: text}. Kept in the same spirit as the existing table:
# 'app.about' is the archival subtitle, the drawer/log keys are identity,
# the hud/quick keys are the on-sprite control panel.
NEW = {
    'app.title': {
        'zh': '与莱莎交谈',
        'ja': 'ライザと話す',
        'en': 'Talk with Ryza',
    },
    'nav.menu': {
        'zh': '菜单',
        'ja': 'メニュー',
        'en': 'Menu',
    },
    'posture.tip': {
        'zh': '坐下/站起',
        'ja': '座る/立つ',
        'en': 'Sit / stand',
    },
    'posture.variantTip': {
        'zh': '盘腿坐/普通坐',
        'ja': 'あぐら/普通座り',
        'en': 'Cross-legged / normal sit',
    },
    'scene.place': {
        'zh': '所在地',
        'ja': '所在地',
        'en': 'Location',
    },
    'mode.label': {
        'zh': '对话模式',
        'ja': '対話モード',
        'en': 'Mode',
    },
    'topbar.voiceMode': {
        'zh': '语音 / 文本',
        'ja': '音声 / テキスト',
        'en': 'Voice / text',
    },
    'app.subtitle': {
        'zh': 'Atelier Ryza',
        'ja': 'Atelier Ryza',
        'en': 'Atelier Ryza',
    },
    'app.about': {
        'zh': '离线重建版 · 不连接官方服务器',
        'ja': 'オフライン再構築版 · 公式サーバーに接続しません',
        'en': 'Offline rebuild · never connects to official servers',
    },
    'drawer.name': {
        'zh': '莱莎',
        'ja': 'ライザ',
        'en': 'Ryza',
    },
    'hud.stamina': {
        'zh': '体力',
        'ja': 'スタミナ',
        'en': 'Stamina',
    },
    'hud.money': {
        'zh': '所持金',
        'ja': '所持金',
        'en': 'Cole',
    },
    'hud.level': {
        'zh': '等级',
        'ja': 'レベル',
        'en': 'Level',
    },
    'quick.hide': {
        'zh': '隐藏按钮',
        'ja': 'ボタンを隠す',
        'en': 'Hide buttons',
    },
    'quick.zoomIn': {
        'zh': '放大',
        'ja': '拡大',
        'en': 'Zoom in',
    },
    'quick.zoomOut': {
        'zh': '缩小',
        'ja': '縮小',
        'en': 'Zoom out',
    },
    'quick.zoomReset': {
        'zh': '标准',
        'ja': '標準',
        'en': 'Reset zoom',
    },
    'quick.sit': {
        'zh': '坐下',
        'ja': '座る',
        'en': 'Sit',
    },
    'quick.gather': {
        'zh': '采集',
        'ja': '採取',
        'en': 'Gather',
    },
    'quick.replay': {
        'zh': '再听一次',
        'ja': 'もう一度聞く',
        'en': 'Replay voice',
    },
    'quick.favorite': {
        'zh': '收藏',
        'ja': 'お気に入り',
        'en': 'Favourite',
    },
    'quick.history': {
        'zh': '会话记录',
        'ja': '会話履歴',
        'en': 'Chat history',
    },
    'quick.questSheet': {
        'zh': '任务',
        'ja': 'クエスト',
        'en': 'Quests',
    },
    'quick.bag': {
        'zh': '道具',
        'ja': '道具',
        'en': 'Items',
    },
    'mode.chatSub': {
        'zh': '自由闲聊模式',
        'ja': '自由に雑談を楽しむモード',
        'en': 'Free-flowing chat mode',
    },
    'input.speed': {
        'zh': '文本速度',
        'ja': 'テキスト速度',
        'en': 'Text speed',
    },
    'input.newTalk': {
        'zh': '新的对话',
        'ja': '新しい会話',
        'en': 'New chat',
    },
    'input.send': {
        'zh': '发送',
        'ja': '送信',
        'en': 'Send',
    },
    'world.map': {
        'zh': '地图',
        'ja': '地図',
        'en': 'Map',
    },
    'world.tod': {
        'zh': '时段',
        'ja': '時間帯',
        'en': 'Time of day',
    },
    'alarm.new': {
        'zh': '+ 新建闹钟',
        'ja': '+ 新しいアラーム',
        'en': '+ New alarm',
    },
    'scene.home': {
        'zh': '莱莎的家',
        'ja': 'ライザの家',
        'en': 'Ryza\u2019s house',
    },
    'tod.day': {
        'zh': '白天',
        'ja': '昼',
        'en': 'Day',
    },
    'mode.chat': {
        'zh': '闲聊',
        'ja': '雑談',
        'en': 'Chat',
    },
    'world.mapShort': {
        'zh': '世界地图',
        'ja': 'ワールドマップ',
        'en': 'World map',
    },
    'world.herePeople': {
        'zh': '此处的人',
        'ja': 'この場所にいる人',
        'en': 'People here',
    },
    'onb.skip': {
        'zh': '跳过',
        'ja': 'スキップ',
        'en': 'Skip',
    },
    'settings.reset': {
        'zh': '恢复默认',
        'ja': '初期設定に戻す',
        'en': 'Restore defaults',
    },
}

# Key already present anywhere in T -> leave alone.
existing = set(re.findall(r"'([a-zA-Z0-9._-]+)':", src))

added, skipped = [], []
for key, texts in NEW.items():
    if key in existing:
        skipped.append(key)
        continue
    added.append(key)

if not added:
    print('nothing to add; all keys present')
    sys.exit(0)

# Build one line per locale to insert right before each block's closing brace.
def line_for(locale):
    parts = []
    for key in added:
        val = NEW[key][locale].replace('\\', '\\\\').replace("'", "\\'")
        parts.append("      '%s': '%s'" % (key, val))
    return ',\n'.join(parts) + '\n'

# Locate the three top-level T blocks by their exact opening lines.
blocks = {}
for locale in ('zh', 'ja', 'en'):
    m = re.search(r"\n    %s: \{\n" % locale, src)
    if not m:
        sys.exit('could not locate T.%s block' % locale)
    blocks[locale] = m.end()

# Each block ends at the first "\n    },\n" after its start (the next locale
# or the closing of T), so splice before that brace, offset per block.
out = src
for locale in ('en', 'ja', 'zh'):          # edit back-to-front so offsets hold
    start = blocks[locale]
    m = re.compile(r"\n    \}", re.M).search(out, start)
    if not m:
        sys.exit('could not find end of T.%s' % locale)
    payload = line_for(locale)
    # the previous entry ends without a comma; add one, then the new lines
    out = out[:m.start()] + ',\n' + payload.rstrip('\n') + out[m.start():]

I18N.write_text(out, encoding='utf-8')
print('added %d keys to zh/ja/en:' % len(added))
for k in added:
    print('   ', k)
if skipped:
    print('skipped (already present): %s' % ', '.join(skipped))
