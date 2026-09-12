/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require ui';

/*
 * Dove 运行态页：init 层（进程/内存/自启）+ daed 控制面（REST）关键字段。
 * 刷新用自管 setInterval 并在节点移除后自清（LuCI poll 在部分版本上会静默失效）。
 */

var callGetInitStatus = rpc.declare({ object: 'luci.dove', method: 'getInitStatus', params: [ 'name' ], expect: {} });
var callGetApiStatus  = rpc.declare({ object: 'luci.dove', method: 'getApiStatus', expect: {} });
var callOverview      = rpc.declare({ object: 'luci.dove', method: 'getRuntimeOverview', expect: {} });
var callSetInitAction = rpc.declare({ object: 'luci.dove', method: 'setInitAction', params: [ 'name', 'action' ] });

var NAME = 'dove';
var REFRESH_MS = 5000;

function fmtUptime(sec) {
	sec = parseInt(sec || 0, 10);
	if (!sec) return '—';
	var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
	if (d) return d + _('天') + ' ' + h + _('小时');
	if (h) return h + _('小时') + ' ' + m + _('分');
	if (m) return m + _('分') + ' ' + (sec % 60) + _('秒');
	return sec + _('秒');
}

/* 从 daed 的 runtime overview 里挑出关键字段（结构随版本变化，取不到就显示 —） */
function pick(overview, paths) {
	var v = overview;
	for (var i = 0; i < paths.length; i++) {
		if (v == null) return null;
		v = v[paths[i]];
	}
	return (v === undefined || v === null) ? null : v;
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(callGetInitStatus(NAME), {}),
			L.resolveDefault(callGetApiStatus(), {}),
			L.resolveDefault(callOverview(), {})
		]);
	},

	render: function (data) {
		var st = (data && data[0] && data[0][NAME]) || {};
		var api = (data && data[1]) || {};
		var ov = {};
		try { ov = JSON.parse(((data && data[2]) || {}).raw || '{}'); } catch (e) { ov = {}; }

		function metric(label, valueEl) {
			return E('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-color-medium, #ddd);' }, [
				E('span', { style: 'color:var(--secondary-color-high, #888);font-size:13px;' }, [ label ]),
				valueEl
			]);
		}
		function val(text, mono) {
			return E('span', { style: 'font-weight:600;font-size:13px;' + (mono ? 'font-family:monospace;' : ''), title: text }, [ text ]);
		}

		var runEl = E('span', { style: 'font-weight:600;' }, [ '—' ]);
		var verEl = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var memEl = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var upEl  = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var apiEl = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var healthEl = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var connEl = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var udpEl  = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var dnsEl  = E('span', { style: 'font-weight:600;font-size:13px;' }, [ '—' ]);
		var errEl  = E('span', { style: 'font-size:12px;color:#c33;' }, [ '' ]);

		function apply(st, api, ov) {
			runEl.textContent = st.running ? _('运行中') : _('已停止');
			verEl.textContent = st.version || _('未安装');
			memEl.textContent = (st.mem || '0') + ' MB';
			upEl.textContent  = fmtUptime(st.uptime);
			apiEl.textContent = (api.endpoint || st.endpoint || '-') + (api.authenticated ? ' ✓' : ' (未认证)');
			healthEl.textContent = (api.health || '000') + ((api.health == '200') ? ' OK' : '');

			var tcp = pick(ov, [ 'residentDataplane', 'metrics', 'activeTcpConnections' ]);
			var tcp2 = pick(ov, [ 'residentDataplane', 'activeTcpConnections' ]);
			connEl.textContent = (tcp != null ? tcp : (tcp2 != null ? tcp2 : '—'));
			var udp = pick(ov, [ 'residentDataplane', 'metrics', 'activeUdpSessions' ]);
			var udp2 = pick(ov, [ 'residentDataplane', 'activeUdpSessions' ]);
			udpEl.textContent = (udp != null ? udp : (udp2 != null ? udp2 : '—'));
			var dns = pick(ov, [ 'residentDataplane', 'metrics', 'dnsCacheEntries' ]);
			dnsEl.textContent = (dns != null ? dns : '—');
			errEl.textContent = !st.running ? _('服务未运行：先到「配置」页点启动') : '';
		}
		apply(st, api, ov);

		function refresh() {
			return Promise.all([
				L.resolveDefault(callGetInitStatus(NAME), {}),
				L.resolveDefault(callGetApiStatus(), {}),
				L.resolveDefault(callOverview(), {})
			]).then(function (d) {
				var s = (d && d[0] && d[0][NAME]) || {};
				var a = (d && d[1]) || {};
				var o = {};
				try { o = JSON.parse(((d && d[2]) || {}).raw || '{}'); } catch (e) { o = {}; }
				apply(s, a, o);
			});
		}

		var card = E('div', { class: 'cbi-section', style: 'padding:10px 12px;max-width:720px;' }, [
			metric(_('服务状态'), runEl),
			metric(_('版本'), verEl),
			metric(_('内存 (RSS)'), memEl),
			metric(_('运行时长'), upEl),
			metric(_('控制面 / API'), apiEl),
			metric(_('API 健康检查'), healthEl),
			metric(_('TCP 活动连接'), connEl),
			metric(_('UDP 活动会话'), udpEl),
			metric(_('DNS 缓存条目'), dnsEl),
			E('div', { style: 'margin-top:8px;' }, [ errEl ])
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
