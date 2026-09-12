/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * Dove 配置页（joey 风格：直接编辑 dae 配置文本 + 保存重载）
 *
 * 与 joey 的区别：joey 编辑的是 /etc/joey/config.dae（dae 直接读文件），
 * Dove 编辑的是 daed 的配置 —— daed 把它存在 SQLite 里，所以这里走 REST：
 *   getConfig     → GET  /api/user/me/dae-config-file（导出当前生效的 dae 文本）
 *   previewConfig → POST /api/user/me/dae-config-file/preview（只校验）
 *   setConfig     → PUT 导入 + POST /api/profiles/select + POST /api/runtime/reload
 */

var callGetInitStatus = rpc.declare({ object: 'luci.dove', method: 'getInitStatus', params: [ 'name' ], expect: {} });
var callSetInitAction = rpc.declare({ object: 'luci.dove', method: 'setInitAction', params: [ 'name', 'action' ] });
var callGetApiStatus  = rpc.declare({ object: 'luci.dove', method: 'getApiStatus', expect: {} });
var callGetConfig     = rpc.declare({ object: 'luci.dove', method: 'getConfig', expect: {} });
var callSetConfig     = rpc.declare({ object: 'luci.dove', method: 'setConfig', params: [ 'content', 'reload' ], expect: {} });
var callPreviewConfig = rpc.declare({ object: 'luci.dove', method: 'previewConfig', params: [ 'content' ], expect: {} });
var callLogin         = rpc.declare({ object: 'luci.dove', method: 'login', params: [ 'username', 'password', 'remember' ], expect: {} });
var callForget        = rpc.declare({ object: 'luci.dove', method: 'forget', expect: {} });

var NAME = 'dove';

/* 首次打开时给新用户看的模板：daed 的配置语言和 dae 一致 */
var TEMPLATE = [
	'global {',
	'\tdisable_waiting_network: true',
	'}',
	'routing {',
	'\t# 本机管理流量必须直连，否则 SSH / LuCI 会被数据面劫持',
	'\tdip(192.168.0.0/16) -> must_direct',
	'\tdip(224.0.0.0/3, "ff00::/8") -> must_direct',
	'\tdport(67, 68) -> must_direct',
	'\tdip(geoip:private) -> must_direct',
	'\tfallback: direct',
	'}'
].join('\n');

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(callGetInitStatus(NAME), {}),
			L.resolveDefault(callGetApiStatus(), {})
		]);
	},

	render: function (data) {
		var st = (data && data[0] && data[0][NAME]) || {};
		var api = data && data[1] || {};
		var self = this;

		this.dirty = false;
		this.content = '';
		this.loaded = false;

		/* ── 服务状态条 ── */
		var stateEl = E('span', { style: 'font-weight:600;' }, [
			st.running ? _('运行中') : _('已停止')
		]);
		var metaEl = E('span', { style: 'color:var(--secondary-color-high, #888);margin-left:8px;font-size:12px;' }, [
			(st.version ? _('版本') + ' ' + st.version : _('未安装')),
			st.running ? ' · RSS ' + (st.mem || 0) + ' MB' : '',
			' · ' + _('API') + ' ' + (api.endpoint || st.endpoint || '-')
		]);

		function act(action) {
			return function () {
				ui.showModal(_('请稍候…'), [ E('p', { class: 'spinning' }, [ _('正在执行 %s …').format(action) ]) ]);
				return callSetInitAction(NAME, action).then(function (r) {
					ui.hideModal();
					if (!r || !r.result) { ui.addNotification(null, E('p', {}, [ _('操作失败') ]), 'error'); return; }
					setTimeout(function () { location.reload(); }, 1200);
				}).catch(function () { ui.hideModal(); ui.addNotification(null, E('p', {}, [ _('操作失败') ]), 'error'); });
			};
		}

		var btnStyle = 'margin-right:6px;padding:5px 12px;';
		var btnStop  = E('button', { class: 'cbi-button', style: btnStyle, click: act('stop') }, [ _('停止') ]);
		var btnStart = E('button', { class: 'cbi-button cbi-button-apply', style: btnStyle, click: act('start') }, [ _('启动') ]);
		var btnRestart = E('button', { class: 'cbi-button', style: btnStyle, click: act('restart') }, [ _('重启') ]);
		var btnAuto = E('button', {
			class: 'cbi-button' + (st.enabled ? ' cbi-button-negative' : ' cbi-button-positive'),
			style: btnStyle,
			click: act(st.enabled ? 'disable' : 'enable')
		}, [ st.enabled ? _('取消自启') : _('开机自启') ]);

		/* ── 登录区（只有需要时才显示）── */
		var authBox = E('div');
		function renderAuth() {
			while (authBox.firstChild) authBox.removeChild(authBox.firstChild);
			if (api.authenticated) {
				authBox.appendChild(E('div', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin:4px 0 10px;' }, [
					_('已通过 daed API 认证') + ' · ' + _('用户数') + ' ' + (api.numberUsers || 0) + ' · ',
					E('button', {
						class: 'cbi-button cbi-button-link', style: 'font-size:12px;',
						click: function () {
							return callForget().then(function () { ui.addNotification(null, E('p', {}, [ _('已清除本地 API 凭据') ]), 'info'); setTimeout(function () { location.reload(); }, 800); });
						}
					}, [ _('清除本地凭据') ])
				]));
				return;
			}
			authBox.appendChild(E('div', { style: 'background:rgba(200,120,0,.12);border-left:3px solid #d18b00;padding:8px 10px;margin:0 0 10px;font-size:13px;' }, [
				E('strong', {}, [ _('需要 daed API 凭据：') ]),
				' ' + _('这台设备上已有面板账号，请用面板的账号登录一次；若你从没建过账号，daed 服务启动后本页会自动创建一个本地账号。')
			]));
			var user = E('input', { type: 'text', placeholder: _('用户名'), style: 'margin-right:6px;' });
			var pass = E('input', { type: 'password', placeholder: _('密码'), style: 'margin-right:6px;' });
			var remember = E('input', { type: 'checkbox', id: 'dv-remember' });
			authBox.appendChild(E('div', { style: 'margin:0 0 10px;' }, [
				user, pass,
				E('label', { for: 'dv-remember', style: 'margin-left:6px;font-size:12px;' }, [ remember, ' ' + _('记住（存到 /etc/dove/api.cred）') ]),
				E('button', {
					class: 'cbi-button cbi-button-apply', style: 'margin-left:8px;',
					click: function () {
						return callLogin(user.value, pass.value, remember.checked ? '1' : '0').then(function (r) {
							if (!r || !r.ok) { ui.addNotification(null, E('p', {}, [ (r && r.error) || _('登录失败') ]), 'error'); return; }
							setTimeout(function () { location.reload(); }, 600);
						});
					}
				}, [ _('登录') ])
			]));
		}
		renderAuth();

		/* ── 配置编辑区 ── */
		var editor = E('textarea', {
			style: 'width:100%;min-height:52vh;font-family:monospace;font-size:12px;line-height:1.55;tab-size:2;white-space:pre;overflow:auto;',
			spellcheck: 'false',
			input: function () { self.dirty = true; statusEl.textContent = _('已修改，未保存'); }
		});
		var statusEl = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);' }, [ _('未加载') ]);
		var saveBtn = E('button', { class: 'cbi-button cbi-button-apply', style: 'padding:5px 14px;margin-right:6px;' }, [ _('保存并重载') ]);
		var checkBtn = E('button', { class: 'cbi-button', style: 'padding:5px 14px;margin-right:6px;' }, [ _('仅校验') ]);
		var loadBtn = E('button', { class: 'cbi-button', style: 'padding:5px 14px;' }, [ _('从 daed 重新导出') ]);

		function setBusy(b, text) {
			saveBtn.disabled = checkBtn.disabled = loadBtn.disabled = b;
			if (text) statusEl.textContent = text;
		}

		function doLoad() {
			setBusy(true, _('正在从 daed 导出配置（首次物化可能较慢）…'));
			return callGetConfig().then(function (r) {
				if (!r || !r.ok) { statusEl.textContent = (r && r.error) || _('导出失败'); return; }
				var text = r.content || '';
				if (r.empty || !text.trim()) {
					text = TEMPLATE;
					statusEl.textContent = _('当前没有已生效的配置，已填入模板；改完保存即可导入');
				} else {
					statusEl.textContent = _('已加载 %s').format(r.filename || 'generated.dae');
				}
				editor.value = text;
				self.content = text;
				self.dirty = false;
			}).catch(function () { statusEl.textContent = _('导出失败：ubus 调用异常'); })
			  .then(function () { setBusy(false); });
		}

		checkBtn.addEventListener('click', function () {
			setBusy(true, _('正在校验…'));
			return callPreviewConfig(editor.value).then(function (r) {
				if (!r || !r.ok) { ui.addNotification(null, E('p', {}, [ (r && r.error) || _('校验失败') ]), 'error'); return; }
				var warn = (r.warnings || '').trim();
				ui.addNotification(null, E('p', {}, [ warn ? _('校验通过，但有警告：') + ' ' + warn : _('校验通过') ]), warn ? 'warning' : 'info');
				statusEl.textContent = warn ? _('校验通过（有警告）') : _('校验通过');
			}).catch(function () { statusEl.textContent = _('校验异常'); })
			  .then(function () { setBusy(false); });
		});

	saveBtn.addEventListener('click', function () {
			if (self.dirty && !confirm(_('保存会导入并立即重载运行时（可能短暂中断连接），继续？'))) return;
			setBusy(true, _('正在导入并重载（daed 物化运行时，可能十几秒）…'));
			return callSetConfig(editor.value, '1').then(function (r) {
				if (!r || !r.ok) {
					var msg = [ (r && r.error) || '', r && r.selectError ? _('选中失败: ') + r.selectError : '' ].filter(Boolean).join(' | ');
					ui.addNotification(null, E('p', {}, [ msg || _('导入失败') ]), 'error');
					statusEl.textContent = _('导入失败');
					return;
				}
				var lines = [ _('导入成功') ];
				if (r.selected) lines.push(_('已选中 config/dns/routing'));
				if (r.reloaded) lines.push(_('运行时已重载'));
				if (r.reloadError) lines.push(_('重载失败: ') + r.reloadError);
				if ((r.warnings || '').trim()) lines.push(_('警告: ') + r.warnings);
				ui.addNotification(null, E('p', {}, [ lines.join(' · ') ]), r.reloadError ? 'warning' : 'info');
				statusEl.textContent = lines.join(' · ');
				self.dirty = false;
				self.content = editor.value;
			}).catch(function () { statusEl.textContent = _('导入异常（ubus 调用失败，可能超时）'); })
			  .then(function () { setBusy(false); });
		});

		loadBtn.addEventListener('click', function () {
			if (self.dirty && !confirm(_('会丢弃当前未保存的修改，继续？'))) return;
			return doLoad();
		});

		/* 首屏自动导出（失败不阻塞页面） */
		setTimeout(function () { doLoad(); }, 50);

		return E('div', { class: 'cbi-map' }, [
			E('h2', {}, [ _('Dove') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Dove 跑的是 DaeNext 的 daed：配置实体存在 daed.db（SQLite）里，' +
				  '本页通过 daed 的 REST 接口导出 / 导入 dae 配置文本并重载运行时。')
			]),
			E('div', { class: 'cbi-section', style: 'padding:10px 12px;' }, [
				E('div', {}, [ stateEl, metaEl ]),
				E('div', { style: 'margin-top:8px;' }, [
					st.running ? btnStop : btnStart, btnRestart, btnAuto,
					E('a', { href: L.url('admin/services/dove/status'), style: 'margin-left:10px;font-size:12px;' }, [ _('运行态') ]),
					E('a', { href: L.url('admin/services/dove/log'), style: 'margin-left:10px;font-size:12px;' }, [ _('日志') ])
				])
			]),
			E('div', { class: 'cbi-section', style: 'padding:10px 12px;' }, [
				authBox,
				E('div', { style: 'margin-bottom:6px;' }, [ saveBtn, checkBtn, loadBtn, E('span', { style: 'margin-left:10px;' }, [ statusEl ]) ]),
				editor,
				E('div', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-top:6px;' }, [
					_('提示：routing 里务必保留本机网段（如 dip(192.168.0.0/16) -> must_direct）直连规则，' +
					  '否则 daed 的数据面会劫持到路由器自身的 SSH / LuCI 流量。')
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
