/* @ds-bundle: {"format":4,"namespace":"Katsudo","components":[{"name":"Button"},{"name":"Kbd"},{"name":"Input"},{"name":"Segmented"},{"name":"Switch"},{"name":"Badge"},{"name":"Icon"},{"name":"Panel"},{"name":"Meter"},{"name":"StatTile"},{"name":"Sparkline"},{"name":"Timeline"},{"name":"CalendarHeatmap"},{"name":"KeyboardHeatmap"},{"name":"UsageList"},{"name":"ImportSource"},{"name":"NavItem"},{"name":"StatusBar"}]} */
(function () {
  var R = window.React;
  var h = R.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(p, keys) {
    var o = {};
    for (var k in p) if (keys.indexOf(k) < 0) o[k] = p[k];
    return o;
  }

  // ---- formatting -------------------------------------------------------
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    if (hh) return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
    if (mm) return mm + 'm';
    return ss + 's';
  }
  function formatClock(hours) {
    var hh = Math.floor(hours), mm = Math.round((hours - hh) * 60);
    if (mm === 60) { hh += 1; mm = 0; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function formatCount(n) {
    return Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---- Icon: 16px grid, 1.5 stroke, square caps -------------------------
  var ICONS = {
    clock: [['circle', { cx: 8, cy: 8, r: 6 }], ['path', { d: 'M8 4.5V8l2.5 1.5' }]],
    keyboard: [['rect', { x: 1.5, y: 4, width: 13, height: 8, rx: 1 }], ['path', { d: 'M4 6.75h1M7.5 6.75h1M11 6.75h1M5 9.5h6' }]],
    mouse: [['rect', { x: 4.5, y: 1.5, width: 7, height: 13, rx: 3.5 }], ['path', { d: 'M8 4v2.5' }]],
    network: [['path', { d: 'M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5' }]],
    timeline: [['path', { d: 'M2 4.5h6M5 8h9M2 11.5h4M9 11.5h3' }]],
    calendar: [['rect', { x: 2, y: 3, width: 12, height: 11 }], ['path', { d: 'M2 6.5h12M5 1.5v3M11 1.5v3' }]],
    apps: [['rect', { x: 2, y: 2, width: 5, height: 5 }], ['rect', { x: 9, y: 2, width: 5, height: 5 }], ['rect', { x: 2, y: 9, width: 5, height: 5 }], ['rect', { x: 9, y: 9, width: 5, height: 5 }]],
    tag: [['path', { d: 'M2 2h6l6 6-6 6-6-6z' }], ['circle', { cx: 5.25, cy: 5.25, r: 1 }]],
    import: [['path', { d: 'M8 2v8M5 7l3 3 3-3M2.5 11v2.5h11V11' }]],
    export: [['path', { d: 'M8 10V2M5 5l3-3 3 3M2.5 11v2.5h11V11' }]],
    backup: [['rect', { x: 2, y: 3, width: 12, height: 3 }], ['path', { d: 'M3 6v7.5h10V6M6.5 9h3' }]],
    database: [['ellipse', { cx: 8, cy: 4, rx: 5.5, ry: 2 }], ['path', { d: 'M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2' }]],
    lock: [['rect', { x: 3, y: 7, width: 10, height: 7 }], ['path', { d: 'M5 7V5a3 3 0 0 1 6 0v2' }]],
    search: [['circle', { cx: 7, cy: 7, r: 4.5 }], ['path', { d: 'M10.5 10.5L14 14' }]],
    settings: [['path', { d: 'M2 5h7M12 5h2M2 11h2M7 11h7' }], ['circle', { cx: 10.5, cy: 5, r: 1.5 }], ['circle', { cx: 5.5, cy: 11, r: 1.5 }]],
    check: [['path', { d: 'M3 8.5l3 3 7-7' }]],
    alert: [['path', { d: 'M8 2l6.5 12h-13z' }], ['path', { d: 'M8 6.5V10M8 12v.5' }]],
    pause: [['path', { d: 'M5.5 3v10M10.5 3v10' }]],
    play: [['path', { d: 'M5 3l8 5-8 5z' }]],
    chevron: [['path', { d: 'M6 3l5 5-5 5' }]],
    star: [['path', { d: 'M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3L1.8 6.3l4.3-.5z' }]],
    rhythm: [['path', { d: 'M1.5 9h2l1.5-4 2.5 8 2-9 2 7 1-2h2' }]],
    flag: [['path', { d: 'M3.5 14.5V2M3.5 2.5h9l-2 3 2 3h-9' }]],
    dot: [['rect', { x: 5, y: 5, width: 6, height: 6, fill: 'currentColor', stroke: 'none' }]]
  };
  function Icon(p) {
    var size = p.size || 16, glyph = ICONS[p.name] || ICONS.dot;
    return h('svg', {
      className: cx('kt-icon', p.className), width: size, height: size, viewBox: '0 0 16 16',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square', strokeLinejoin: 'miter',
      role: p.title ? 'img' : undefined, 'aria-hidden': p.title ? undefined : true, focusable: 'false'
    },
      p.title ? h('title', null, p.title) : null,
      glyph.map(function (g, i) { return h(g[0], Object.assign({ key: i }, g[1])); }));
  }
  Icon.names = Object.keys(ICONS);

  // ---- Actions ------------------------------------------------------------
  function Button(p) {
    var variant = p.variant || 'quiet', size = p.size || 'md';
    var rest = omit(p, ['variant', 'size', 'icon', 'className', 'children']);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('kt-btn', 'kt-btn-' + variant, 'kt-btn-' + size, !p.children && 'is-icon', p.className)
    }),
      p.icon ? h(Icon, { name: p.icon, size: size === 'sm' ? 14 : 16 }) : null,
      p.children != null ? h('span', null, p.children) : null);
  }

  function Kbd(p) {
    return h('kbd', { className: cx('kt-kbd', p.className) }, p.children);
  }

  // ---- Inputs -------------------------------------------------------------
  function Input(p) {
    var rest = omit(p, ['icon', 'className', 'kbd']);
    return h('label', { className: cx('kt-input', p.className) },
      p.icon ? h(Icon, { name: p.icon, size: 14 }) : null,
      h('input', Object.assign({ type: 'text' }, rest)),
      p.kbd ? h(Kbd, null, p.kbd) : null);
  }

  function optVal(o) { return o != null && typeof o === 'object' ? o.value : o; }
  function optLab(o) { return o != null && typeof o === 'object' ? o.label : o; }

  function Segmented(p) {
    var opts = p.options || [];
    var st = R.useState(p.defaultValue != null ? p.defaultValue : optVal(opts[0]));
    var val = p.value != null ? p.value : st[0];
    return h('div', { className: cx('kt-seg', p.size === 'sm' && 'kt-seg-sm', p.className), role: 'radiogroup', 'aria-label': p.label },
      opts.map(function (o) {
        var v = optVal(o), on = v === val;
        return h('button', {
          key: v, type: 'button', role: 'radio', 'aria-checked': on, className: cx('kt-seg-opt', on && 'is-on'),
          onClick: function () { st[1](v); if (p.onChange) p.onChange(v); }
        }, optLab(o));
      }));
  }

  function Switch(p) {
    var st = R.useState(!!p.defaultChecked);
    var on = p.checked != null ? p.checked : st[0];
    return h('label', { className: cx('kt-switch', p.disabled && 'is-disabled', p.className) },
      h('button', {
        type: 'button', role: 'switch', 'aria-checked': on, disabled: p.disabled,
        className: cx('kt-switch-track', on && 'is-on'),
        onClick: function () { st[1](!on); if (p.onChange) p.onChange(!on); }
      }, h('span', { className: 'kt-switch-thumb' })),
      (p.label || p.hint) ? h('span', { className: 'kt-switch-text' },
        p.label ? h('span', { className: 'kt-switch-label' }, p.label) : null,
        p.hint ? h('span', { className: 'kt-switch-hint' }, p.hint) : null) : null);
  }

  // ---- Display ------------------------------------------------------------
  function Badge(p) {
    return h('span', { className: cx('kt-badge', 'kt-badge-' + (p.tone || 'neutral'), p.className) },
      p.dot ? h('span', { className: 'kt-badge-dot', 'aria-hidden': true }) : null,
      p.children);
  }

  function Panel(p) {
    return h('section', { className: cx('kt-panel', p.className) },
      (p.title || p.action) ? h('header', { className: 'kt-panel-head' },
        h('h3', { className: 'kt-label' }, p.title),
        p.action || null) : null,
      h('div', { className: cx('kt-panel-body', p.flush && 'is-flush') }, p.children));
  }

  function Meter(p) {
    var n = p.segments || 24, v = Math.max(0, Math.min(1, p.value || 0)), lit = Math.round(v * n), tone = p.tone || 'amber';
    var segs = [];
    for (var i = 0; i < n; i++) segs.push(h('span', { key: i, className: cx('kt-meter-seg', i < lit && 'kt-fill-' + tone) }));
    return h('div', { className: cx('kt-meter', p.className) },
      (p.label || p.valueText !== false) ? h('div', { className: 'kt-meter-head' },
        h('span', { className: 'kt-label' }, p.label || ''),
        p.valueText !== false ? h('span', { className: 'data-sm kt-muted' }, p.valueText || Math.round(v * 100) + '%') : null) : null,
      h('div', {
        className: 'kt-meter-track', role: 'progressbar', 'aria-label': p.label,
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v * 100)
      }, segs));
  }

  // ---- Data -----------------------------------------------------------------
  function Sparkline(p) {
    var d = p.data || [], w = p.width || 120, ht = p.height || 28, tone = p.tone || 'amber', pad = 2;
    if (d.length < 2) return h('svg', { width: w, height: ht, 'aria-hidden': true });
    var max = Math.max.apply(null, d), min = Math.min.apply(null, d), span = (max - min) || 1;
    var pts = d.map(function (v, i) {
      return [(i / (d.length - 1)) * (w - pad * 2) + pad, ht - pad - ((v - min) / span) * (ht - pad * 2)];
    });
    var line = pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('');
    var last = pts[pts.length - 1];
    var area = line + 'L' + last[0].toFixed(1) + ' ' + ht + 'L' + pts[0][0].toFixed(1) + ' ' + ht + 'Z';
    return h('svg', { className: cx('kt-spark', 'kt-tone-' + tone, p.className), width: w, height: ht, viewBox: '0 0 ' + w + ' ' + ht, 'aria-hidden': true },
      p.fill !== false ? h('path', { className: 'kt-spark-area', d: area }) : null,
      h('path', { className: 'kt-spark-line', d: line }),
      h('rect', { className: 'kt-spark-end', x: last[0] - 2, y: last[1] - 2, width: 4, height: 4 }));
  }

  function StatTile(p) {
    var tone = p.tone || 'amber', delta = p.delta != null ? String(p.delta) : null;
    return h('div', { className: cx('kt-stat', p.className) },
      h('div', { className: 'kt-stat-head' },
        p.icon ? h('span', { className: 'kt-ink-' + tone }, h(Icon, { name: p.icon, size: 14 })) : null,
        h('span', { className: 'kt-label' }, p.label)),
      h('div', { className: 'kt-stat-value' },
        h('span', { className: 'counter-xl' }, p.value),
        p.unit ? h('span', { className: 'kt-stat-unit data-md' }, p.unit) : null),
      h('div', { className: 'kt-stat-foot' },
        delta ? h('span', { className: 'kt-delta data-sm' }, (delta.charAt(0) === '-' ? '▼ ' + delta.slice(1) : '▲ ' + delta.replace(/^\+/, '')) + (p.deltaLabel ? ' ' + p.deltaLabel : '')) : h('span'),
        p.data ? h(Sparkline, { data: p.data, tone: tone, width: 96, height: 24 }) : null));
  }

  function Timeline(p) {
    var s = p.start != null ? p.start : 0, e = p.end != null ? p.end : 24, span = e - s;
    var step = p.tickEvery || (span > 12 ? 3 : 1);
    function pct(x) { return ((Math.max(s, Math.min(e, x)) - s) / span * 100) + '%'; }
    var ticks = [];
    for (var t = Math.ceil(s / step) * step; t <= e; t += step) ticks.push(t);
    return h('div', { className: cx('kt-tl', p.className) },
      h('div', { className: 'kt-tl-row kt-tl-ruler' },
        h('div', { className: 'kt-tl-label' }),
        h('div', { className: 'kt-tl-track' }, ticks.map(function (t) {
          return h('span', { key: t, className: cx('kt-tl-tick', 'data-sm', t === s && 'is-first', t === e && 'is-last'), style: { left: pct(t) } }, formatClock(t));
        }))),
      (p.lanes || []).map(function (l, i) {
        return h('div', { key: i, className: 'kt-tl-row' },
          h('div', { className: 'kt-tl-label' }, l.label),
          h('div', { className: 'kt-tl-track kt-tl-lane' },
            ticks.map(function (t) { return h('span', { key: 'g' + t, className: 'kt-tl-grid', style: { left: pct(t) } }); }),
            (l.segments || []).map(function (g, j) {
              var label = (g.title ? g.title + ' · ' : '') + formatClock(g.from) + '–' + formatClock(g.to);
              return h('span', {
                key: j, className: 'kt-tl-seg kt-fill-' + (g.tone || 'amber'), title: label, 'aria-label': label,
                style: { left: pct(g.from), width: ((Math.min(e, g.to) - Math.max(s, g.from)) / span * 100) + '%' }
              });
            }),
            p.now != null ? h('span', { className: 'kt-tl-now', style: { left: pct(p.now) } }) : null));
      }));
  }

  function heatLevel(v, max, sqrt) {
    if (!v) return 0;
    var r = v / max;
    return Math.min(4, Math.max(1, Math.ceil((sqrt ? Math.sqrt(r) : r) * 4)));
  }

  function CalendarHeatmap(p) {
    var vals = p.values || [], max = p.max || Math.max.apply(null, vals.concat([1])), off = p.startWeekday || 0;
    var cells = [];
    for (var i = 0; i < off; i++) cells.push(null);
    cells = cells.concat(vals);
    var weeks = [];
    for (var k = 0; k < cells.length; k += 7) weeks.push(cells.slice(k, k + 7));
    var fmt = p.format || formatCount;
    return h('div', { className: cx('kt-cal', p.className) },
      h('div', { className: 'kt-cal-body' },
        h('div', { className: 'kt-cal-days data-sm' }, ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(function (d, i) { return h('span', { key: i }, d); })),
        h('div', { className: 'kt-cal-grid' }, weeks.map(function (w, wi) {
          return h('div', { key: wi, className: 'kt-cal-week' }, w.map(function (v, di) {
            return v === null
              ? h('span', { key: di, className: 'kt-cal-cell is-pad' })
              : h('span', { key: di, className: 'kt-cal-cell kt-heat-' + heatLevel(v, max), 'data-tip': fmt(v), 'aria-label': fmt(v) });
          }));
        }))),
      p.legend !== false ? h('div', { className: 'kt-cal-legend data-sm' },
        h('span', null, 'Less'),
        [0, 1, 2, 3, 4].map(function (l) { return h('span', { key: l, className: 'kt-cal-cell kt-heat-' + l }); }),
        h('span', null, 'More')) : null);
  }

  // Keyboard geometry in key units (1u = one letter key). Each key: [label, id, width, tip].
  // The main block is a standard 60% board; TKL adds the F-row and navigation cluster, full
  // adds the numpad. Laid out on a quarter-unit grid so 1.25u and 2.25u keys line up exactly.
  var KB_MAIN = [
    [['`'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'], ['-'], ['='], ['Bksp', 'backspace', 2, 'Backspace']],
    [['Tab', 'tab', 1.5], ['Q'], ['W'], ['E'], ['R'], ['T'], ['Y'], ['U'], ['I'], ['O'], ['P'], ['['], [']'], ['\\', '\\', 1.5]],
    [['Caps', 'capslock', 1.75, 'Caps Lock'], ['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L'], [';'], ["'"], ['Enter', 'enter', 2.25]],
    [['Shift', 'lshift', 2.25, 'Left Shift'], ['Z'], ['X'], ['C'], ['V'], ['B'], ['N'], ['M'], [','], ['.'], ['/'], ['Shift', 'rshift', 2.75, 'Right Shift']],
    [['Ctrl', 'lctrl', 1.25, 'Left Ctrl'], ['Win', 'meta', 1.25, 'Windows'], ['Alt', 'lalt', 1.25, 'Left Alt'], ['', 'space', 6.25, 'Space'],
      ['Alt', 'ralt', 1.25, 'Right Alt'], ['Fn', 'fn', 1.25], ['Menu', 'menu', 1.25], ['Ctrl', 'rctrl', 1.25, 'Right Ctrl']]
  ];
  var KB_FROW = [['Esc', 'escape', 1, 'Escape'], null, ['F1', 'f1'], ['F2', 'f2'], ['F3', 'f3'], ['F4', 'f4'], 0.5,
    ['F5', 'f5'], ['F6', 'f6'], ['F7', 'f7'], ['F8', 'f8'], 0.5, ['F9', 'f9'], ['F10', 'f10'], ['F11', 'f11'], ['F12', 'f12']];
  // [label, id, x, row, w, h, tip] with x relative to the cluster and row 0 = the F-row.
  var KB_NAV = [
    ['PrtSc', 'printscreen', 0, 0, 1, 1, 'Print Screen'], ['ScrLk', 'scrolllock', 1, 0, 1, 1, 'Scroll Lock'], ['Pause', 'pause', 2, 0],
    ['Ins', 'insert', 0, 1, 1, 1, 'Insert'], ['Home', 'home', 1, 1], ['PgUp', 'pageup', 2, 1, 1, 1, 'Page Up'],
    ['Del', 'delete', 0, 2, 1, 1, 'Delete'], ['End', 'end', 1, 2], ['PgDn', 'pagedown', 2, 2, 1, 1, 'Page Down'],
    ['\u2191', 'up', 1, 4, 1, 1, 'Up'], ['\u2190', 'left', 0, 5, 1, 1, 'Left'], ['\u2193', 'down', 1, 5, 1, 1, 'Down'], ['\u2192', 'right', 2, 5, 1, 1, 'Right']
  ];
  var KB_PAD = [
    ['Num', 'numlock', 0, 1, 1, 1, 'Num Lock'], ['/', 'num/', 1, 1], ['*', 'num*', 2, 1], ['-', 'num-', 3, 1],
    ['7', 'num7', 0, 2], ['8', 'num8', 1, 2], ['9', 'num9', 2, 2], ['+', 'num+', 3, 2, 1, 2],
    ['4', 'num4', 0, 3], ['5', 'num5', 1, 3], ['6', 'num6', 2, 3],
    ['1', 'num1', 0, 4], ['2', 'num2', 1, 4], ['3', 'num3', 2, 4], ['Enter', 'numenter', 3, 4, 1, 2],
    ['0', 'num0', 0, 5, 2, 1], ['.', 'num.', 2, 5]
  ];
  var KB_WIDTH = { compact: 15, tkl: 18.5, full: 23 };

  function kbKeys(layout) {
    var keys = [];
    function put(label, id, x, row, w, hgt, tip) {
      keys.push({ label: label, id: id || label.toLowerCase(), x: x, row: row, w: w || 1, h: hgt || 1, tip: tip || label || 'Space' });
    }
    if (layout !== 'compact') {
      var fx = 0;
      KB_FROW.forEach(function (k) {
        if (k === null) fx += 1; else if (typeof k === 'number') fx += k; else { put(k[0], k[1], fx, 0, k[2], 1, k[3]); fx += k[2] || 1; }
      });
    }
    KB_MAIN.forEach(function (row, ri) {
      var x = 0;
      row.forEach(function (k) { put(k[0], k[1], x, ri + 1, k[2], 1, k[3]); x += k[2] || 1; });
    });
    if (layout !== 'compact') KB_NAV.forEach(function (k) { put(k[0], k[1], 15.5 + k[2], k[3], k[4], k[5], k[6]); });
    if (layout === 'full') KB_PAD.forEach(function (k) { put(k[0], k[1], 19 + k[2], k[3], k[4], k[5], k[6] || 'Num ' + k[0]); });
    return keys;
  }

  function KeyboardHeatmap(p) {
    var counts = p.counts || {}, max = 1, layout = KB_WIDTH[p.layout] ? p.layout : 'compact', units = KB_WIDTH[layout];
    for (var k in counts) if (counts[k] > max) max = counts[k];
    var compact = layout === 'compact';
    var rows = compact ? 'repeat(5, var(--kt-kb-row))' : 'var(--kt-kb-row) var(--kt-kb-fgap) repeat(5, var(--kt-kb-row))';
    return h('div', { className: cx('kt-kb', 'kt-kb-' + layout, p.className), role: 'img', 'aria-label': p.label || 'Keyboard heatmap' },
      h('div', { className: 'kt-kb-rows', style: { '--kt-kb-units': units, gridTemplateColumns: 'repeat(' + units * 4 + ', 1fr)', gridTemplateRows: rows } },
        kbKeys(layout).map(function (key, i) {
          var n = counts[key.id] || 0, lv = heatLevel(n, max, true);
          // Grid rows: compact has the five main rows; otherwise the F-row, a small gap, then those.
          var row = compact ? key.row : key.row === 0 ? 1 : key.row + 2;
          var top = compact ? key.row === 1 : key.row === 0;
          return h('span', {
            key: i, className: cx('kt-kb-key', 'kt-heat-' + lv, 'data-sm', top && 'is-top'),
            style: { gridColumn: (Math.round(key.x * 4) + 1) + ' / span ' + Math.round(key.w * 4), gridRow: row + ' / span ' + key.h },
            'data-tip': key.tip + ' \u00b7 ' + formatCount(n), 'aria-label': key.tip + ': ' + formatCount(n)
          }, key.label);
        })));
  }

  function UsageList(p) {
    var items = p.items || [];
    var max = Math.max.apply(null, items.map(function (i) { return i.seconds || 0; }).concat([1]));
    return h('ol', { className: cx('kt-usage', p.className) }, items.map(function (it, i) {
      var tone = it.tone || 'amber';
      return h('li', { key: i, className: 'kt-usage-row' },
        h('span', { className: 'kt-usage-chip kt-fill-' + tone, 'aria-hidden': true }, (it.name || '?').charAt(0).toUpperCase()),
        h('span', { className: 'kt-usage-name' },
          h('span', { className: 'kt-usage-title' }, it.name),
          it.meta ? h('span', { className: 'kt-usage-meta' }, it.meta) : null),
        h('span', { className: 'kt-usage-bar', 'aria-hidden': true }, h('span', { className: 'kt-fill-' + tone, style: { width: ((it.seconds || 0) / max * 100) + '%' } })),
        h('span', { className: 'kt-usage-time data-md' }, it.value != null ? it.value : formatDuration(it.seconds)));
    }));
  }

  // ---- Import ---------------------------------------------------------------
  var SOURCES = {
    manictime: { name: 'ManicTime', mono: 'MT', tone: 'amber', hint: 'ManicTime data folder or backup' },
    whatpulse: { name: 'WhatPulse', mono: 'WP', tone: 'cyan', hint: 'WhatPulse database (whatpulse.db)' },
    csv: { name: 'CSV file', mono: 'CSV', tone: 'sky', hint: 'Exported timeline or pulse history' }
  };
  var STATUS = {
    idle: { tone: 'neutral', label: 'Not started' },
    scanning: { tone: 'neutral', label: 'Scanning' },
    ready: { tone: 'cyan', label: 'Ready' },
    importing: { tone: 'amber', label: 'Importing' },
    done: { tone: 'success', label: 'Imported' },
    error: { tone: 'danger', label: 'Failed' }
  };

  function ImportSource(p) {
    var status = p.status || 'idle';
    var src = SOURCES[p.source] || { name: p.name || p.source || 'Source', mono: String(p.name || p.source || '?').slice(0, 2).toUpperCase(), tone: 'sky' };
    var st = STATUS[status] || STATUS.idle;
    return h('div', { className: cx('kt-import', 'is-' + status, p.className) },
      h('div', { className: 'kt-import-top' },
        h('span', { className: 'kt-import-mono kt-fill-' + src.tone, 'aria-hidden': true }, src.mono),
        h('div', { className: 'kt-import-id' },
          h('div', { className: 'kt-import-name' }, p.name || src.name),
          h('div', { className: 'kt-import-file data-sm' }, p.file || src.hint)),
        h(Badge, { tone: st.tone, dot: true }, st.label)),
      status === 'importing'
        ? h(Meter, { value: p.progress || 0, label: p.detail || 'Importing', tone: src.tone })
        : (p.detail ? h('p', { className: cx('kt-import-detail', status === 'error' && 'is-error') }, status === 'error' ? h(Icon, { name: 'alert', size: 14 }) : null, p.detail) : null),
      p.stats ? h('dl', { className: 'kt-import-stats' }, p.stats.map(function (s, i) {
        return h('div', { key: i }, h('dt', { className: 'kt-label' }, s.label), h('dd', { className: 'data-md' }, s.value));
      })) : null,
      p.actionLabel ? h('div', { className: 'kt-import-actions' },
        h(Button, { variant: status === 'ready' ? 'primary' : 'quiet', size: 'sm', onClick: p.onAction }, p.actionLabel)) : null);
  }

  // ---- Shell ----------------------------------------------------------------
  function NavItem(p) {
    return h(p.href ? 'a' : 'button', {
      type: p.href ? undefined : 'button', href: p.href, onClick: p.onClick,
      className: cx('kt-nav', p.active && 'is-active', p.className), 'aria-current': p.active ? 'page' : undefined
    },
      p.icon ? h(Icon, { name: p.icon }) : null,
      h('span', { className: 'kt-nav-label' }, p.label),
      p.count != null ? h('span', { className: 'kt-nav-count data-sm' }, p.count) : null,
      p.kbd ? h(Kbd, null, p.kbd) : null);
  }

  function StatusBar(p) {
    var paused = p.tracking === false;
    return h('footer', { className: cx('kt-status', p.className) },
      h('span', { className: cx('kt-status-rec', paused && 'is-paused') },
        h('span', { className: 'kt-status-dot', 'aria-hidden': true }), paused ? 'Paused' : 'Tracking'),
      (p.items || []).map(function (it, i) {
        return h('span', { key: i, className: 'kt-status-item' }, it.icon ? h(Icon, { name: it.icon, size: 12 }) : null, it.label);
      }),
      p.right ? h('span', { className: 'kt-status-right' }, p.right) : null);
  }

  window.Katsudo = Object.assign(window.Katsudo || {}, {
    Button: Button, Kbd: Kbd, Input: Input, Segmented: Segmented, Switch: Switch,
    Badge: Badge, Icon: Icon, Panel: Panel, Meter: Meter,
    StatTile: StatTile, Sparkline: Sparkline, Timeline: Timeline, CalendarHeatmap: CalendarHeatmap,
    KeyboardHeatmap: KeyboardHeatmap, UsageList: UsageList, ImportSource: ImportSource,
    NavItem: NavItem, StatusBar: StatusBar,
    formatDuration: formatDuration, formatClock: formatClock, formatCount: formatCount
  });
})();
