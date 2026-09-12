/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require ui';

/*
 * Dove 运行态：core 进程状态 + `dove identity` + 配置校验。
 * 刷新用自管 setInterval（节点移除后自清）；LuCI 的 poll 在部分版本上会静默失效。
 */

var NAME = 'dove';
var REFRESH_MS = 5000;

var callGetInitStatus = rpc.declare({ object: 'luci.dove', method: 'getInitStatus', params: [ 'name' ], expect: {} });
var callGetIdentity   = rpc.declare({ object: 'luci.dove', method: 'getIdentity', expect: {} });
var callValidate      = rpc.declare({ object: 'luci.dove', method: 'validateConfig', params: [ 'content' ], expect: {} });

function fmtUptime(sec) {
	sec = parseInt(sec || 0, 10);
	if (!sec) return '—';
	var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
	if (d) return d + _('天') + ' ' + h + _('小时');
	if (h) return h + _('小时') + ' ' + m + _('分');
	if (m) return m + _('分') + ' ' + (sec % 60) + _('秒');
	return sec + _('秒');
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(callGetInitStatus(NAME), {}),
			L.resolveDefault(callGetIdentity(), {})
		]);
	},

	render: function (data) {
		var st = (data[0] && data[0][NAME]) || {};
		var id = data[1] || {};

		function metric(label, valueEl) {
			return E('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-color-medium, #ddd);' }, [
				E('span', { style: 'color:var(--secondary-color-high, #888);font-size:13px;' }, [ label ]),
				valueEl
			]);
		}
		function val(text, mono) {
			return E('span', { style: 'font-weight:600;font-size:13px;' + (mono ? 'font-family:monospace;' : ''), title: text }, [ text ]);
		}

		var runEl  = E('span', { style: 'font-weight:600;' }, [ st.running ? _('运行中') : _('已停止') ]);
		var verEl  = E('span', { style: 'font-weight:600;font-size:12px;word-break:break-all;' }, [ st.version || _('未安装') ]);
		var memEl  = E('span', { style: 'font-weight:600;font-size:13px;' }, [ (st.mem || '0') + ' MB' ]);
		var upEl   = E('span', { style: 'font-weight:600;font-size:13px;' }, [ fmtUptime(st.uptime) ]);
		var pidEl  = E('span', { style: 'font-weight:600;font-size:13px;font-family:monospace;' }, [ st.pid || '—' ]);
		var cfgEl  = E('span', { style: 'font-weight:600;font-size:12px;font-family:monospace;' }, [ st.config || '—' ]);
		var logEl  = E('span', { style: 'font-weight:600;font-size:12px;font-family:monospace;' }, [ st.log || '—' ]);
		var noteEl = E('span', { style: 'font-size:12px;color:#c33;' }, [ st.running ? '' : _('服务未运行：到「配置」页点启动，或 /etc/init.d/dove start') ]);

		function apply(s, i) {
			runEl.textContent = s.running ? _('运行中') : _('已停止');
			verEl.textContent = s.version || _('未安装');
			memEl.textContent = (s.mem || '0') + ' MB';
			upEl.textContent  = fmtUptime(s.uptime);
			pidEl.textContent = s.pid || '—';
			cfgEl.textContent = s.config || '—';
			logEl.textContent = s.log || '—';
			noteEl.textContent = s.running ? '' : _('服务未运行：到「配置」页点启动，或 /etc/init.d/dove start');
		}
		apply(st, id);

		var idPre = E('pre', {
			style: 'margin:6px 0 0;padding:8px;max-height:16em;overflow:auto;font-size:11px;white-space:pre-wrap;' +
				'background:var(--background-color-low, #f5f5f5);border-radius:4px;'
		}, [ id.raw || _('（identity 不可用）') ]);

		var checkEl = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-left:8px;' }, [ '' ]);
		var checkBtn = E('button', {
			class: 'cbi-button', style: 'padding:5px 12px;',
			click: function () {
				checkEl.textContent = _('校验中…');
				return callValidate('').then(function (r) {
					if (r && r.ok) { checkEl.textContent = _('配置校验通过'); ui.addNotification(null, E('p', {}, [ _('配置校验通过') ]), 'info'); }
					else { checkEl.textContent = _('校验失败'); ui.addNotification(null, E('p', {}, [ _('校验失败: ') + ((r && r.error) || '') ]), 'error'); }
				}).catch(function () { checkEl.textContent = _('校验异常'); });
			}
		}, [ _('校验当前配置') ]);

		function refresh() {
			return Promise.all([
				L.resolveDefault(callGetInitStatus(NAME), {}),
				L.resolveDefault(callGetIdentity(), {})
			]).then(function (d) {
				var s = (d[0] && d[0][NAME]) || {};
				var i = d[1] || {};
				apply(s, i);
				idPre.textContent = i.raw || _('（identity 不可用）');
			});
		}

		var card = E('div', { class: 'cbi-section', style: 'padding:10px 12px;max-width:760px;' }, [
			metric(_('服务状态'), runEl),
			metric(_('版本'), verEl),
			metric(_('内存 (RSS)'), memEl),
			metric(_('运行时长'), upEl),
			metric(_('进程 PID'), pidEl),
			metric(_('配置文件'), cfgEl),
			metric(_('日志文件'), logEl),
			E('div', { style: 'margin-top:10px;' }, [ checkBtn, checkEl ]),
			E('div', { style: 'margin-top:8px;' }, [ noteEl ]),
			E('details', { style: 'margin-top:10px;' }, [
				E('summary', { style: 'cursor:pointer;font-size:12px;color:var(--secondary-color-high, #888);' }, [ _('dove identity 原始输出') ]),
				idPre
			])
		]);

		var timer = setInterval(function () {
			if (!document.body.contains(card)) { clearInterval(timer); return; }
			refresh();
		}, REFRESH_MS);

		return E('div', {}, [
			E('h2', {}, [ _('Dove 运行态') ]),
			E('div', { class: 'cbi-map-descr' }, [ _('每 %s 秒自动刷新。').format(REFRESH_MS / 1000) ]),
			card
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
