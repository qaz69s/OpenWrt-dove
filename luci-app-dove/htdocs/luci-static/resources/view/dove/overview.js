'use strict';
'require view';
'require rpc';
'require fs';
'require ui';
'require view.dove.status';
'require view.dove.log';

var NAME = 'dove';
var CONF = '/etc/dove/config.dae';

var SVG_COMMENT = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M14 1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2v3l3-3h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm-2 3H4V3h8v1zm0 3H4V6h8v1zm-3 3H4V9h5v1z"/></svg>';
var SVG_MINUS   = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="2" y="7.5" width="12" height="1.5" rx=".75"/></svg>';
var SVG_PLUS    = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="2" y="7.5" width="12" height="1.5" rx=".75"/><rect x="7.5" y="2" width="1.5" height="12" rx=".75"/></svg>';
var SVG_SAVE    = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.5L10.5 1H2zm8 0v3.5H13L10 1zM3 8h10v1H3V8zm0 3h7v1H3v-1z"/></svg>';

var setInitAction = rpc.declare({
	object: 'luci.' + NAME,
	method: 'setInitAction',
	params: ['name', 'action'],
	expect: { result: false },
});

/* ── 配置编辑器 ── */
function renderConfigCard() {
	var isTouch  = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
	var isNarrow = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
	var isMobile = !!(isTouch || isNarrow);

	var originalVal = '', dirty = false, fontSize = isMobile ? 10 : 13, saveGen = 0;
	var minFontSize = 10;
	var maxFontSize = isMobile ? 24 : 22;
	var editorMinHeight = isMobile ? 320 : 260;
	var editorHeightOffset = isMobile ? 280 : 340;
	var editorPadding   = isMobile ? '8px 10px' : '14px 16px';
	var editorLineH     = isMobile ? 1.6 : 1.8;
	var toolBtnPadding  = isMobile ? '8px 12px' : '3px 9px';
	var toolBtnRadius   = isMobile ? '6px' : '4px';
	var toolBtnFontSize = isMobile ? '13px' : '12px';
	var metaFontSize    = isMobile ? '12px' : '11px';
	var saveBtnPadding  = isMobile ? '10px 16px' : '5px 14px';
	var saveBtnRadius   = isMobile ? '7px' : '5px';
	var saveBtnFontSize = isMobile ? '14px' : '12px';

	function updateVvh() {
		var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
		document.documentElement.style.setProperty('--jy-vvh', h + 'px');
	}
	updateVvh();
	if (window.visualViewport && !window.visualViewport._jyVvhBound) {
		window.visualViewport._jyVvhBound = true;
		window.visualViewport.addEventListener('resize', updateVvh);
	}

	var textarea = E('textarea', {
		class: 'jy-editor',
		placeholder: _('加载中…'),
		spellcheck: false, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
		style: [
			'display:block;width:100%;box-sizing:border-box;',
			'padding:' + editorPadding + ';',
			'font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;',
			'font-size:' + fontSize + 'px;line-height:' + editorLineH + ';tab-size:2;resize:none;',
			'height:calc(var(--jy-vvh,100vh) - ' + editorHeightOffset + 'px);min-height:' + editorMinHeight + 'px;',
			'border:none;outline:none;',
			'background:var(--jy-editor-bg);color:var(--jy-text);',
		].join(''),
	});

	textarea.addEventListener('keydown', function (e) {
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			if (!saveBtn.disabled) saveBtn.click();
			return;
		}
		if (e.key !== 'Tab') return;
		e.preventDefault();
		var s = this.selectionStart, en = this.selectionEnd;
		if (e.shiftKey) {
			var ls       = this.value.lastIndexOf('\n', s - 1) + 1;
			var line     = this.value.slice(ls, s);
			var stripped = line.replace(/^(\t|  )/, '');
			var diff     = line.length - stripped.length;
			if (diff > 0) {
				this.value = this.value.slice(0, ls) + stripped + this.value.slice(ls + line.length);
				this.selectionStart = this.selectionEnd = s - diff;
				this.dispatchEvent(new Event('input'));
			}
		} else {
			if (s === en) {
				this.value = this.value.slice(0, s) + '\t' + this.value.slice(en);
				this.selectionStart = this.selectionEnd = s + 1;
			} else {
				var ls2      = this.value.lastIndexOf('\n', s - 1) + 1;
				var sel      = this.value.slice(ls2, en);
				var indented = sel.replace(/^/mg, '\t');
				this.value = this.value.slice(0, ls2) + indented + this.value.slice(en);
				this.selectionStart = s + 1;
				this.selectionEnd   = en + (indented.length - sel.length);
			}
			this.dispatchEvent(new Event('input'));
		}
	});

	var linesEl = E('span', { style: 'font-size:' + metaFontSize + ';color:var(--jy-dim);' }, ['0 ' + _('行')]);
	var dirtyEl = E('span', { style: 'font-size:' + metaFontSize + ';' }, ['']);

	function updateLineCnt() {
		linesEl.textContent = textarea.value.split('\n').length + ' ' + _('行');
	}
	textarea.addEventListener('input', function () {
		updateLineCnt();
		if (textarea.value !== originalVal) {
			if (!dirty) {
				dirty = true;
				dirtyEl.textContent = '● ' + _('未保存');
				dirtyEl.style.color = '#e67e22';
			}
		} else {
			dirty = false; dirtyEl.textContent = ''; dirtyEl.style.color = '';
		}
	});

	function mkEditorBtn(svgOrText, title) {
		var btn = E('button', { type: 'button', title: title, style: [
			'padding:' + toolBtnPadding + ';border-radius:' + toolBtnRadius + ';cursor:pointer;',
			'border:1px solid var(--jy-border);',
			'background:transparent;color:var(--jy-muted);',
			'font-size:' + toolBtnFontSize + ';font-family:inherit;',
			'display:inline-flex;align-items:center;gap:4px;',
			'-webkit-tap-highlight-color:transparent;touch-action:manipulation;',
			'transition:background .12s,color .12s;',
		].join('') });
		btn.innerHTML = svgOrText;
		btn.addEventListener('mouseenter', function () {
			btn.style.background = 'rgba(128,128,128,.12)';
			btn.style.color = 'var(--jy-text)';
		});
		btn.addEventListener('mouseleave', function () {
			btn.style.background = 'transparent';
			btn.style.color = 'var(--jy-muted)';
		});
		return btn;
	}

	var commentBtn = mkEditorBtn(SVG_COMMENT + ' ' + _('注释'), _('注释/取消注释当前行'));
	commentBtn.addEventListener('click', function () {
		var s  = textarea.selectionStart;
		var ls = textarea.value.lastIndexOf('\n', s - 1) + 1;
		var le = textarea.value.indexOf('\n', s);
		le = le < 0 ? textarea.value.length : le;
		var line    = textarea.value.slice(ls, le);
		var newLine = line.trimStart().charAt(0) === '#'
			? line.replace(/^(\s*)#\s?/, '$1')
			: line.replace(/^(\s*)/, '$1# ');
		textarea.value = textarea.value.slice(0, ls) + newLine + textarea.value.slice(le);
		textarea.selectionStart = textarea.selectionEnd = s + (newLine.length - line.length);
		textarea.dispatchEvent(new Event('input'));
	});

	var fontValEl  = E('span', { style: 'min-width:18px;text-align:center;font-size:' + (isMobile ? '13px' : '12px') + ';display:inline-block;color:var(--jy-muted);' }, [String(fontSize)]);
	var fontDecBtn = mkEditorBtn(SVG_MINUS, _('缩小字号'));
	var fontIncBtn = mkEditorBtn(SVG_PLUS,  _('放大字号'));
	fontDecBtn.addEventListener('click', function () {
		fontSize = Math.max(minFontSize, fontSize - 1);
		textarea.style.fontSize = fontSize + 'px';
		fontValEl.textContent   = String(fontSize);
	});
	fontIncBtn.addEventListener('click', function () {
		fontSize = Math.min(maxFontSize, fontSize + 1);
		textarea.style.fontSize = fontSize + 'px';
		fontValEl.textContent   = String(fontSize);
	});

	var saveBtn = E('button', { type: 'button', style: [
		'padding:' + saveBtnPadding + ';border:none;border-radius:' + saveBtnRadius + ';cursor:pointer;',
		'background:#2980b9;color:#fff;',
		'font-size:' + saveBtnFontSize + ';font-weight:500;font-family:inherit;',
		'display:inline-flex;align-items:center;gap:5px;',
		'-webkit-tap-highlight-color:transparent;touch-action:manipulation;',
		'transition:background .15s;',
	].join('') });
	saveBtn.innerHTML = SVG_SAVE + ' ' + _('保存');
	saveBtn.addEventListener('mouseenter', function () { if (!saveBtn.disabled) saveBtn.style.background = '#2372a4'; });
	saveBtn.addEventListener('mouseleave', function () { saveBtn.style.background = '#2980b9'; });

	saveBtn.addEventListener('click', function () {
		saveBtn.disabled = true; saveBtn.style.opacity = '.6';
		dirtyEl.style.color = 'var(--jy-muted)'; dirtyEl.textContent = _('保存中…');
		var val = (textarea.value || '').replace(/\s+$/, '') + '\n';
		fs.write(CONF, val)
			.then(function () {
				textarea.value = val;
				originalVal = val; dirty = false;
				return L.resolveDefault(setInitAction(NAME, 'reload_config'), false);
			})
			.then(function (reloaded) {
				saveBtn.disabled = false; saveBtn.style.opacity = '1';
				var gen = ++saveGen;
				dirtyEl.style.color = '#5cb85c';
				dirtyEl.textContent = reloaded ? _('✓ 已保存并重载') : _('✓ 已保存');
				setTimeout(function () {
					if (saveGen === gen) { dirtyEl.textContent = ''; dirtyEl.style.color = ''; }
				}, 3000);
			})
			.catch(function (err) {
				saveBtn.disabled = false; saveBtn.style.opacity = '1';
				dirtyEl.style.color = '#e74c3c';
				dirtyEl.textContent = _('保存失败：%s').format(err);
			});
	});

	fs.trimmed(CONF)
		.then(function (val) {
			textarea.value = val || ''; textarea.placeholder = '';
			originalVal = textarea.value; updateLineCnt();
		})
		.catch(function (err) { textarea.placeholder = _('读取失败：%s').format(err); });

	return E('div', { style: 'border:1px solid var(--jy-border);border-radius:5px;overflow:hidden;' }, [
		E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px 10px;border-bottom:1px solid var(--jy-border);background:var(--jy-bg3);' }, [
			commentBtn,
			E('div', { style: 'display:flex;align-items:center;gap:3px;' }, [fontDecBtn, fontValEl, fontIncBtn]),
			E('div', { style: 'margin-left:auto;display:flex;align-items:center;gap:10px;' }, [linesEl, dirtyEl]),
		]),
		textarea,
		E('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;padding-bottom:calc(7px + env(safe-area-inset-bottom));border-top:1px solid var(--jy-border);background:var(--jy-bg3);' }, [
			E('code', { style: 'font-size:11px;color:var(--jy-dim);background:none;padding:0;' }, [CONF]),
			saveBtn,
		]),
	]);
}

/* ── View 主体 ── */
return view.extend({
	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null,

	load: function () {
		return Promise.all([
			L.require('view.dove.status'),
			L.require('view.dove.log'),
		]);
	},

	render: function (mods) {
		var statusMod = mods[0];
		var logMod    = mods[1];

		/* 注入全局样式（仅一次） */
		if (!document.getElementById('dove-global-style')) {
			var s = document.createElement('style');
			s.id  = 'dove-global-style';
			s.textContent = [
				/* ── CSS 主题变量：深色默认，明亮模式自动切换 ── */
				':root{',
				'--jy-bg:#2a2a2a;',
				'--jy-bg2:#333333;',
				'--jy-bg3:#3a3a3a;',
				'--jy-editor-bg:#2a2a2a;',
				'--jy-border:#444444;',
				'--jy-text:#e8e8e8;',
				'--jy-title:#ffffff;',
				'--jy-muted:#aaaaaa;',
				'--jy-dim:#666666;',
				'--jy-scroll-track:#2a2a2a;',
				'--jy-scroll-thumb:#555555;',
				'--jy-scroll-thumb-h:#777777;',
				'--jy-log-divider:rgba(255,255,255,.05);',
				'}',

				/* ── 明亮模式覆盖 ── */
				'@media(prefers-color-scheme:light){:root{',
				'--jy-bg:#ffffff;',
				'--jy-bg2:#f5f6f8;',
				'--jy-bg3:#eaecef;',
				'--jy-editor-bg:#f8f9fa;',
				'--jy-border:#d0d2d8;',
				'--jy-text:#1a1a1a;',
				'--jy-title:#000000;',
				'--jy-muted:#606268;',
				'--jy-dim:#909399;',
				'--jy-scroll-track:#f0f1f3;',
				'--jy-scroll-thumb:#c0c2c8;',
				'--jy-scroll-thumb-h:#a0a2a8;',
				'--jy-log-divider:rgba(0,0,0,.06);',
				'}}',

				/* ── 卡片 ── */
				'.jy-card{',
				'background:var(--jy-bg);border:1px solid var(--jy-border);',
				'border-radius:8px;padding:20px;color:var(--jy-text);',
				'font-weight:450;',
				'}',

				/* ── 导航栏 ── */
				'.jy-nav{display:flex;position:relative;margin-bottom:20px;',
				'overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
				'.jy-nav::-webkit-scrollbar{display:none;}',
				'.jy-nav::after{content:"";position:absolute;bottom:0;left:0;right:0;',
				'height:2px;background:rgba(128,128,128,.18);pointer-events:none;}',

				/* ── 标签按钮：强制覆盖 LuCI 框架蓝色 ── */
				'.jy-tab{',
				'padding:10px 16px !important;',
				'border:none !important;border-top:none !important;border-left:none !important;',
				'border-right:none !important;border-bottom:2px solid transparent !important;',
				'border-radius:0 !important;',
				'background:none !important;background-color:transparent !important;',
				'box-shadow:none !important;outline:none !important;',
				'cursor:pointer !important;',
				'font-size:14px !important;font-family:inherit !important;',
				'color:var(--jy-text) !important;opacity:.55;font-weight:600;',
				'white-space:nowrap;flex-shrink:0;position:relative;z-index:1;',
				'-webkit-tap-highlight-color:transparent;',
				'transition:opacity .15s,border-color .15s;}',

				'.jy-tab:focus{outline:none !important;box-shadow:none !important;}',
				'.jy-tab:hover{opacity:.8 !important;border-bottom-color:transparent !important;background:none !important;background-color:transparent !important;}',

				/* ── 仅绿色，完全覆盖蓝色框架 ── */
				'.jy-tab.jy-active{',
				'opacity:1 !important;',
				'color:#5cb85c !important;',
				'border-bottom:2px solid #5cb85c !important;',
				'background:none !important;background-color:transparent !important;',
				'box-shadow:none !important;}',

				/* ── 动画 ── */
				'@keyframes jy-spin{to{transform:rotate(360deg)}}',
				'.jy-spin{display:inline-block;animation:jy-spin .65s linear infinite;}',
				'@keyframes jy-blink{0%,100%{opacity:1}50%{opacity:.35}}',
				'@keyframes jy-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
				'.jy-lat-loading{animation:jy-pulse 1s ease-in-out infinite;}',
				'@keyframes jy-rock{0%{transform:rotate(-16deg)}38%{transform:rotate(23deg)}48%{transform:rotate(14deg)}55%{transform:rotate(16deg)}88%{transform:rotate(-23deg)}96%{transform:rotate(-14deg)}100%{transform:rotate(-16deg)}}',

				/* ── 响应式 ── */
				'@media(max-width:480px){.jy-card{padding:12px;} .jy-nav{margin-bottom:12px;} .jy-tab{padding:9px 12px !important;font-size:13px !important;} .jy-metrics{grid-template-columns:1fr 1fr !important;}}',

				/* ── 编辑器滚动条（深色/明亮模式自适应） ── */
				'textarea.jy-editor{',
				'scrollbar-width:thin;',
				'scrollbar-color:var(--jy-scroll-thumb) var(--jy-scroll-track);',
				'}',
				'textarea.jy-editor::-webkit-scrollbar{width:7px;height:7px;}',
				'textarea.jy-editor::-webkit-scrollbar-track{background:var(--jy-scroll-track);border-radius:4px;}',
				'textarea.jy-editor::-webkit-scrollbar-thumb{background:var(--jy-scroll-thumb);border-radius:4px;}',
				'textarea.jy-editor::-webkit-scrollbar-thumb:hover{background:var(--jy-scroll-thumb-h);}',
				'textarea.jy-editor::-webkit-scrollbar-corner{background:var(--jy-scroll-track);}',

				/* ── 日志区滚动条 ── */
				'.jy-log-body::-webkit-scrollbar{width:7px;height:7px;}',
				'.jy-log-body::-webkit-scrollbar-track{background:var(--jy-bg2);border-radius:4px;}',
				'.jy-log-body::-webkit-scrollbar-thumb{background:var(--jy-scroll-thumb);border-radius:4px;}',
				'.jy-log-body::-webkit-scrollbar-thumb:hover{background:var(--jy-scroll-thumb-h);}',
				'.jy-log-body::-webkit-scrollbar-corner{background:var(--jy-bg2);}',

				/* ── 搜索框 placeholder 颜色 ── */
				'.jy-log-search::placeholder{color:var(--jy-dim);}',
			].join('');
			document.head.appendChild(s);
		}

		var tabs = [
			{ label: _('控制'), fn: function () { return statusMod.render(); } },
			{ label: _('配置'), fn: renderConfigCard },
			{ label: _('日志'), fn: function () { return logMod.getRuntimeLog(); }, lazy: true, isLog: true },
		];

		var navBtns     = [];
		var tabPanels   = [];
		var logPanel    = null;
		var statusPanel = null;  /* 控制面板引用，用于 _setVisible 钩子 */

		tabs.forEach(function (t, i) {
			var isFirst = (i === 0);
			var ready   = !t.lazy;
			var panel   = E('div', { style: 'display:' + (isFirst ? 'block' : 'none') + ';' },
				(isFirst || !t.lazy) ? [t.fn()] : []);

			/* 保存控制面板引用 */
			if (i === 0) statusPanel = panel.firstChild || null;
			if (t.isLog && !t.lazy) logPanel = panel.firstChild || null;

			var btn = E('button', { class: 'jy-tab' + (isFirst ? ' jy-active' : '') }, [t.label]);

			btn.addEventListener('click', function () {
				/* 隐藏所有面板的可见性 */
				if (logPanel    && logPanel._setVisible)    logPanel._setVisible(false);
				if (statusPanel && statusPanel._setVisible) statusPanel._setVisible(false);

				navBtns.forEach(function (b)  { b.classList.remove('jy-active'); });
				tabPanels.forEach(function (p) { p.style.display = 'none'; });
				btn.classList.add('jy-active');
				panel.style.display = 'block';

				if (!ready) {
					ready = true;
					var node = t.fn();
					if (node) {
						panel.appendChild(node);
						if (t.isLog) logPanel = node;
						if (i === 0) statusPanel = node;
					}
				}

				/* 通知目标面板变为可见 */
				if (t.isLog && logPanel && logPanel._setVisible) logPanel._setVisible(true);
				if (i === 0 && statusPanel && statusPanel._setVisible) statusPanel._setVisible(true);
			});

			navBtns.push(btn);
			tabPanels.push(panel);
		});

		return E('div', { class: 'jy-card' }, [
			E('div', { class: 'jy-nav' }, navBtns),
			E('div', {}, tabPanels),
		]);
	},
});
