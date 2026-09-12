/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
'require view';
'require rpc';
'require fs';
'require ui';

/*
 * Dove 配置页 —— joey 形态：直接编辑文本配置 /etc/dove/config.dae。
 *
 * Dove 跑的是 DaeNext 的 core-only 二进制（无 SQLite / 无 REST / 无 Web UI），
 * 配置就是这份文本：语法与上游 dae 的 config.dae 一致。
 * 保存 = fs.write + /etc/init.d/dove hot_reload（先 validate，再 SIGUSR1 热重载）。
 * 「仅校验」走 rpcd validateConfig，校验的是编辑器里**未保存**的文本。
 */

var CONF = '/etc/dove/config.dae';
var NAME = 'dove';

var callGetInitStatus = rpc.declare({ object: 'luci.dove', method: 'getInitStatus', params: [ 'name' ], expect: {} });
var callSetInitAction = rpc.declare({ object: 'luci.dove', method: 'setInitAction', params: [ 'name', 'action' ] });
var callValidate      = rpc.declare({ object: 'luci.dove', method: 'validateConfig', params: [ 'content' ], expect: {} });

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(fs.read(CONF), null),
			L.resolveDefault(callGetInitStatus(NAME), {})
		]);
	},

	render: function (data) {
		var self = this;
		var fileMissing = (data[0] == null);
		var st = (data[1] && data[1][NAME]) || {};

		this.dirty = false;

		/* ── 状态条 ── */
		var stateEl = E('span', { style: 'font-weight:600;' }, [ st.running ? _('运行中') : _('已停止') ]);
		var metaEl = E('span', { style: 'color:var(--secondary-color-high, #888);margin-left:8px;font-size:12px;overflow:hidden;text-overflow:ellipsis;' }, [
			(st.version ? st.version : _('未安装')),
			st.running ? ' · RSS ' + (st.mem || 0) + ' MB' : '',
			st.pid ? ' · PID ' + st.pid : ''
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

		var bs = 'margin-right:6px;padding:5px 12px;';
		var btnStop    = E('button', { class: 'cbi-button', style: bs, click: act('stop') }, [ _('停止') ]);
		var btnStart   = E('button', { class: 'cbi-button cbi-button-apply', style: bs, click: act('start') }, [ _('启动') ]);
		var btnRestart = E('button', { class: 'cbi-button', style: bs, click: act('restart') }, [ _('重启') ]);
		var btnAuto    = E('button', {
			class: 'cbi-button' + (st.enabled ? ' cbi-button-negative' : ' cbi-button-positive'),
			style: bs, click: act(st.enabled ? 'disable' : 'enable')
		}, [ st.enabled ? _('取消自启') : _('开机自启') ]);

		/* ── 编辑器 ── */
		var editor = E('textarea', {
			style: 'width:100%;min-height:52vh;font-family:monospace;font-size:12px;line-height:1.55;' +
				'tab-size:2;white-space:pre;overflow:auto;',
			spellcheck: 'false',
			input: function () { self.dirty = true; statusEl.textContent = _('已修改，未保存'); }
		});
		editor.value = fileMissing ? '' : (data[0] || '');

		var statusEl = E('span', { style: 'font-size:12px;color:var(--secondary-color-high, #888);' },
			[ fileMissing ? _('配置文件不存在（保存后会自动创建）') : _('已加载 %s').format(CONF) ]);

		var saveBtn  = E('button', { class: 'cbi-button cbi-button-apply', style: 'padding:5px 14px;margin-right:6px;' }, [ _('保存并热重载') ]);
		var checkBtn = E('button', { class: 'cbi-button', style: 'padding:5px 14px;margin-right:6px;' }, [ _('仅校验') ]);
		var loadBtn  = E('button', { class: 'cbi-button', style: 'padding:5px 14px;' }, [ _('放弃修改并重新载入') ]);

		function setBusy(b, text) {
			saveBtn.disabled = checkBtn.disabled = loadBtn.disabled = b;
			if (text) statusEl.textContent = text;
		}

		function doSave() {
			setBusy(true, _('正在保存并热重载…'));
			return fs.write(CONF, editor.value, 384 /* 0600：配置里可能有节点密码 */).then(function () {
				return callSetInitAction(NAME, 'hot_reload');
			}).then(function (r) {
				if (!r || !r.result) {
					ui.addNotification(null, E('p', {}, [ _('已保存，但热重载失败：请到「日志」页看 /etc/init.d/dove hot_reload 的报错') ]), 'warning');
					statusEl.textContent = _('已保存（重载失败，详见日志）');
					return;
				}
				self.dirty = false;
				statusEl.textContent = _('已保存并热重载');
				ui.addNotification(null, E('p', {}, [ _('已保存并热重载 (SIGUSR1，连接不断)') ]), 'info');
				setTimeout(function () { location.reload(); }, 1200);
			}).catch(function (e) {
				statusEl.textContent = _('保存失败');
				ui.addNotification(null, E('p', {}, [ _('保存失败: ') + (e && e.message ? e.message : e) ]), 'error');
			}).then(function () { setBusy(false); });
		}

		saveBtn.addEventListener('click', doSave);
		checkBtn.addEventListener('click', function () {
			setBusy(true, _('正在校验（未保存的文本）…'));
			return callValidate(editor.value).then(function (r) {
				if (!r || !r.ok) {
					ui.addNotification(null, E('p', {}, [ _('校验失败') + ': ' + ((r && r.error) || '') ]), 'error');
					statusEl.textContent = _('校验失败');
					return;
				}
				ui.addNotification(null, E('p', {}, [ _('校验通过') ]), 'info');
				statusEl.textContent = _('校验通过');
			}).catch(function () { statusEl.textContent = _('校验异常'); })
			  .then(function () { setBusy(false); });
		});
		loadBtn.addEventListener('click', function () {
			if (self.dirty && !confirm(_('会丢弃当前未保存的修改，继续？'))) return;
			return L.resolveDefault(fs.read(CONF), '').then(function (text) {
				editor.value = text || '';
				self.dirty = false;
				statusEl.textContent = _('已重新载入');
			});
		});

		/* Ctrl+S / Cmd+S 保存 */
		document.addEventListener('keydown', function (ev) {
			if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); doSave(); }
		});

		return E('div', { class: 'cbi-map' }, [
			E('h2', {}, [ _('Dove 配置') ]),
			E('div', { class: 'cbi-map-descr' }, [
				_('Dove 使用 DaeNext 的 core-only 引擎：配置是下面这份文本（语法同上游 dae 的 config.dae）。' +
				  '保存后自动 hot reload（SIGUSR1，不中断已有连接）。')
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
				E('div', { style: 'margin-bottom:6px;' }, [ saveBtn, checkBtn, loadBtn, E('span', { style: 'margin-left:10px;' }, [ statusEl ]) ]),
				editor,
				E('div', { style: 'font-size:12px;color:var(--secondary-color-high, #888);margin-top:6px;' }, [
					_('提示：routing 里务必保留本机网段直连规则（dip(192.168.0.0/16) -> must_direct 等），' +
					  '否则数据面会劫持到路由器自身的 SSH / LuCI 流量。Ctrl+S 可保存。')
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
