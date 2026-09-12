/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require fs';
'require ui';

/*
 * Dove 日志页：core 的 --logfile 输出（默认 /var/log/dove.log）。
 * core 没有内建轮转，滚动由 init 在启动时按 UCI 的 maxsize/maxbackups 做。
 */

var NAME = 'dove';
var REFRESH_MS = 4000;
var MAX_LINES = 1000;

var callGetInitStatus = rpc.declare({ object: 'luci.dove', method: 'getInitStatus', params: [ 'name' ], expect: {} });
var callGetLog        = rpc.declare({ object: 'luci.dove', method: 'getLog', params: [ 'source' ], expect: {} });
var callClearLog      = rpc.declare({ object: 'luci.dove', method: 'clearLog' });

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(callGetLog('core'), {}),
			L.resolveDefault(callGetInitStatus(NAME), {})
		]);
	},

	render: function (data) {
		var self = this;
		var st = (data[1] && data[1][NAME]) || {};
		this.source = 'core';
		this.auto = true;
		this.filterText = '';

		var pre = E('pre', {
			style: 'margin:0;padding:10px;max-height:62vh;overflow:auto;font-family:monospace;' +
				'font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;' +
				'background:var(--background-color-low, #f5f5f5);border-radius:4px;'
		});
		var countEl = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-left:8px;' });
		var pathEl  = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-left:8px;font-family:monospace;' }, [ st.log || '' ]);

		function render() {
			var raw = self.rawText || '';
			var lines = raw.split('\n');
			var needle = self.filterText.toLowerCase();
			var out = [];
			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				if (!line.trim()) continue;
				if (needle && line.toLowerCase().indexOf(needle) === -1) continue;
				out.push(line);
			}
			if (out.length > MAX_LINES) out = out.slice(out.length - MAX_LINES);
			pre.textContent = out.length ? out.join('\n') : (raw.trim() ? _('（无匹配行）') : _('（日志为空）'));
			countEl.textContent = _('显示 %s 行').format(out.length);
			pre.scrollTop = pre.scrollHeight;
		}

		function fetchLog() {
			return callGetLog(self.source).then(function (r) {
				self.rawText = (r && r.log) || '';
				if (r && r.path) pathEl.textContent = r.path;
				render();
			}).catch(function () { /* 单次失败忽略 */ });
		}

		self.rawText = (data[0] && data[0].log) || '';
		render();

		var srcSel = E('select', {
			change: function () { self.source = srcSel.value; return fetchLog(); }
		}, [
			E('option', { value: 'core', selected: 'selected' }, [ _('core 日志文件') ]),
			E('option', { value: 'syslog' }, [ _('系统日志 (logread)') ])
		]);

		var filterInput = E('input', {
			type: 'text', placeholder: _('过滤关键字'), style: 'margin-left:8px;min-width:160px;',
			input: function () { self.filterText = filterInput.value; render(); }
		});

		var autoBox = E('input', { type: 'checkbox', id: 'dv-log-auto', checked: 'checked' });
		autoBox.addEventListener('change', function () { self.auto = autoBox.checked; });

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
							if (!confirm(_('清空日志文件？'))) return;
							return callClearLog().then(function () { return fetchLog(); });
						}
					}, [ _('清空') ]),
					countEl,
					pathEl
				]),
				pre,
				E('div', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-top:6px;' }, [
					_('日志轮转由 init 在启动时执行（UCI: logfile_maxsize / logfile_maxbackups）；core 没有内建轮转。'),
					E('br'),
					_('注意：core 版没有装日志渲染器，这个文件里只有 init/validate 的输出和 service ready/stopping 标记；' +
					  '运行时明细请切到「系统日志 (logread)」——daed 那套阶段耗时/日志流属于产品层，core 里不存在。')
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
