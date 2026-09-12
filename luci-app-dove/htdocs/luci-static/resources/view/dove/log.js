/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require ui';

/*
 * Dove 日志页：daed 的产品日志是 JSONL（$log_dir/current.jsonl），
 * 这里把它压成单行可读文本 + 关键字过滤 + 自动刷新。
 * 另有 syslog 源（logread 过滤 dove/daed）。
 */

var callGetLog   = rpc.declare({ object: 'luci.dove', method: 'getLog', params: [ 'source' ], expect: {} });
var callClearLog = rpc.declare({ object: 'luci.dove', method: 'clearLog' });

var REFRESH_MS = 4000;
var MAX_LINES = 1000;

function pad(n) { return (n < 10 ? '0' : '') + n; }

function fmtTime(ts) {
	var d;
	if (typeof ts === 'number') d = new Date(ts > 1e12 ? ts : ts * 1000);
	else if (typeof ts === 'string') d = new Date(ts);
	if (!d || isNaN(d.getTime())) return null;
	return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/* JSONL → "MM-DD HH:MM:SS LEVEL message key=val ..."（解析失败原样输出） */
function formatLine(raw) {
	var line = (raw || '').trim();
	if (!line) return '';
	if (line.charAt(0) !== '{') return line;
	var o;
	try { o = JSON.parse(line); } catch (e) { return line; }

	var when = fmtTime(o.time || o.timestamp || o.ts || o.at) || '';
	var level = (o.level || o.severity || '').toString().toLowerCase();
	var msg = o.message || o.msg || o.event || o.kind || '';
	var skip = { time: 1, timestamp: 1, ts: 1, at: 1, level: 1, severity: 1, message: 1, msg: 1, event: 1, kind: 1 };
	var extras = [];
	for (var k in o) {
		if (skip[k] || o[k] === null || o[k] === '') continue;
		var v = o[k];
		if (typeof v === 'object') { try { v = JSON.stringify(v); } catch (e) { v = String(v); } }
		if (typeof v === 'string' && v.length > 200) v = v.substring(0, 200) + '…';
		extras.push(k + '=' + v);
	}
	if (extras.length > 24) extras = extras.slice(0, 24).concat(['…']);

	var out = '';
	if (when) out += when + ' ';
	if (level) out += '[' + level + '] ';
	out += msg || '';
	if (extras.length) out += '  ' + extras.join(' ');
	return out;
}

return view.extend({
	load: function () {
		return L.resolveDefault(callGetLog('product'), {});
	},

	render: function (data) {
		var self = this;
		this.source = 'product';
		this.rawLines = ((data || {}).log || '').split('\n');
		this.auto = true;
		this.filterText = '';

		var pre = E('pre', {
			style: 'margin:0;padding:10px;max-height:62vh;overflow:auto;font-family:monospace;' +
				'font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;' +
				'background:var(--background-color-low, #f5f5f5);border-radius:4px;'
		});
		var countEl = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-left:8px;' });

		function render() {
			var out = [], needle = self.filterText.toLowerCase();
			for (var i = 0; i < self.rawLines.length; i++) {
				var text = formatLine(self.rawLines[i]);
				if (!text) continue;
				if (needle && text.toLowerCase().indexOf(needle) === -1) continue;
				out.push(text);
			}
			if (out.length > MAX_LINES) out = out.slice(out.length - MAX_LINES);
			pre.textContent = out.length ? out.join('\n') : _('（无日志 / 已被过滤）');
			countEl.textContent = _('显示 %s 行').format(out.length);
			pre.scrollTop = pre.scrollHeight;
		}

		function fetchLog() {
			return callGetLog(self.source).then(function (r) {
				self.rawLines = ((r || {}).log || '').split('\n');
				render();
			}).catch(function () { /* 忽略单次失败 */ });
		}

		var srcSel = E('select', {
			change: function () { self.source = srcSel.value; return fetchLog(); }
		}, [
			E('option', { value: 'product', selected: 'selected' }, [ _('产品日志 (JSONL)') ]),
			E('option', { value: 'syslog' }, [ _('系统日志 (logread)') ])
		]);

		var filterInput = E('input', {
			type: 'text', placeholder: _('过滤关键字'), style: 'margin-left:8px;min-width:160px;',
			input: function () { self.filterText = filterInput.value; render(); }
		});

		var autoBox = E('input', { type: 'checkbox', id: 'dv-log-auto', checked: 'checked' });
		autoBox.addEventListener('change', function () { self.auto = autoBox.checked; });

		render();

		var timer = setInterval(function () {
			if (!document.body.contains(pre)) { clearInterval(timer); return; }
			if (self.auto) fetchLog();
		}, REFRESH_MS);

		return E('div', {}, [
			E('h2', {}, [ _('Dove 日志') ]),
			E('div', { class: 'cbi-section', style: 'padding:10px 12px;' }, [
				E('div', { style: 'margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;' }, [
					srcSel,
					filterInput,
					E('label', { for: 'dv-log-auto', style: 'margin-left:8px;font-size:12px;' }, [ autoBox, ' ' + _('自动刷新') ]),
					E('button', { class: 'cbi-button', click: function () { return fetchLog(); } }, [ _('刷新') ]),
					E('button', {
						class: 'cbi-button cbi-button-negative',
						click: function () {
							if (!confirm(_('清空产品日志文件？'))) return;
							return callClearLog().then(function () { return fetchLog(); });
						}
					}, [ _('清空') ]),
					countEl
				]),
				pre
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
