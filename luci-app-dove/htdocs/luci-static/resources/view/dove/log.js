'use strict';
'require fs';
'require rpc';
'require poll';
'require ui';
'require baseclass';

var NAME = 'dove';
var LOG  = '/var/log/dove.log';

var SVG_PAUSE     = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx=".5"/><rect x="9.5" y="2" width="3.5" height="12" rx=".5"/></svg>';
var SVG_PLAY      = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>';
var SVG_SORT_DESC = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="6" y2="12"/></svg>';
var SVG_SORT_ASC  = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="4" x2="6" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>';
var SVG_TRASH     = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 3.5 4 14 4"/><path d="M13 4l-.867 9.5H3.867L3 4"/><path d="M6.5 7v5m3-5v5"/><path d="M5.5 4V3a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v1"/></svg>';

var LEVEL_CFG = {
	error: { tagBg: '#c0392b', rowBgDark: 'rgba(192,57,43,.09)', rowBgLight: 'rgba(192,57,43,.07)', border: '#c0392b',    textColor: '' },
	warn:  { tagBg: '#e67e22', rowBgDark: 'rgba(230,126,34,.09)', rowBgLight: 'rgba(230,126,34,.07)', border: '#e67e22',    textColor: '' },
	info:  { tagBg: '#2980b9', rowBgDark: '',                      rowBgLight: '',                      border: 'transparent', textColor: '' },
	debug: { tagBg: '#7f8c8d', rowBgDark: '',                      rowBgLight: '',                      border: 'transparent', textColor: null },
};
var LEVEL_LABEL = { error: 'E', warn: 'W', info: 'I', debug: 'D' };

var clearLogRpc = rpc.declare({ object: 'luci.' + NAME, method: 'clearLog', expect: { result: false } });

function lineLevel(raw) {
	var lm = raw.match(/\blevel="?([a-zA-Z]+)"?\b/);
	if (lm) {
		var ll = lm[1].toLowerCase();
		if (ll === 'warning') ll = 'warn';
		if (ll === 'err' || ll === 'fatal') ll = 'error';
		if (LEVEL_CFG[ll]) return ll;
	}

	var u = raw.toUpperCase();
	if (u.indexOf('[ERROR]') !== -1 || u.indexOf('ERROR:') !== -1) return 'error';
	if (u.indexOf('[WARN]')  !== -1 || u.indexOf('WARN:')  !== -1) return 'warn';
	if (u.indexOf('[DEBUG]') !== -1 || u.indexOf('DEBUG:') !== -1) return 'debug';
	return 'info';
}

function parseLogfmt(raw) {
	if (!raw || raw.indexOf('=') === -1) return null;
	/* 快速判断：避免对非 logfmt 行做重解析 */
	if (raw.indexOf('msg=') === -1 && raw.indexOf('time=') === -1) return null;

	var o = {};
	var i = 0;
	var len = raw.length;

	while (i < len) {
		while (i < len && raw.charCodeAt(i) <= 32) i++;
		if (i >= len) break;

		var ks = i;
		while (i < len && raw[i] !== '=' && raw.charCodeAt(i) > 32) i++;
		if (i >= len || raw[i] !== '=') {
			while (i < len && raw.charCodeAt(i) > 32) i++;
			continue;
		}

		var key = raw.slice(ks, i);
		i++; /* skip '=' */

		var val = '';
		if (raw[i] === '"') {
			i++;
			var sb = '';
			var esc = false;
			while (i < len) {
				var ch = raw[i];
				if (esc) {
					sb += ch;
					esc = false;
					i++;
					continue;
				}
				if (ch === '\\') {
					esc = true;
					i++;
					continue;
				}
				if (ch === '"') break;
				sb += ch;
				i++;
			}
			val = sb;
			if (i < len && raw[i] === '"') i++;
		} else {
			var vs = i;
			while (i < len && raw.charCodeAt(i) > 32) i++;
			val = raw.slice(vs, i);
		}

		o[key] = val;
	}

	return o;
}

function extractHms(s) {
	/*
	 * 时间戳已对齐 honk：2026-09-13T06:40:12.123456+08:00。
	 * ISO 的 T 与数字之间没有词边界，原来带 \b 的写法会抓不到，
	 * 去掉 \b（旧的空格格式 "2026-09-13 06:40:12" 同样匹配）。
	 */
	var m = String(s || '').match(/(\d{2}:\d{2}:\d{2})/);
	return m ? m[1] : '';
}

function shortenIPv6(ip) {
	if (!ip || ip.indexOf(':') === -1) return ip;
	if (ip.length <= 22) return ip;
	var parts = ip.split(':').filter(function (p) { return p.length; });
	if (parts.length <= 6) return ip;
	return parts.slice(0, 4).join(':') + ':…:' + parts[parts.length - 1];
}

function shortenEndpoint(ep) {
	if (!ep) return ep;
	var m = ep.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
	if (m) {
		var ip = shortenIPv6(m[1]);
		return '[' + ip + ']' + (m[2] ? ':' + m[2] : '');
	}
	return ep;
}

function splitArrowMsg(msg) {
	var parts = String(msg || '').split(/\s*<->\s*/);
	return (parts.length === 2) ? { left: parts[0], right: parts[1] } : null;
}

function looksLikeIpEndpoint(ep) {
	return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ep) || /^\[[0-9a-fA-F:]+\]:\d+$/.test(ep);
}

function compactLogfmt(fields) {
	var msg = fields && fields.msg ? fields.msg : '';
	if (!fields) return msg;

	/* DNS：优先展示 qtype + qname，避免手机上被大量字段淹没 */
	if (fields._qname) {
		var qname = String(fields._qname).replace(/\.$/, '');
		var qtype = fields.qtype ? String(fields.qtype) : '';
		var server = '';
		var a = splitArrowMsg(msg);
		if (a && a.right) {
			server = a.right;
			/* 常见 DNS 53 端口可省略 */
			server = server.replace(/^\[([^\]]+)\]:53$/, '[$1]');
			server = server.replace(/:53$/, '');
			server = shortenEndpoint(server);
		}

		var out = 'DNS';
		if (qtype) out += ' ' + qtype;
		if (qname) out += ' ' + qname;
		if (server) out += ' @ ' + server;
		return out;
	}

	/* 连接：只保留 msg 主体，并对 IPv6 端点做缩写 */
	var arrow = splitArrowMsg(msg);
	if (arrow) {
		var left = shortenEndpoint(arrow.left);
		var right = shortenEndpoint(arrow.right);

		/* 若远端是 IP 且存在 sniffed 域名，用域名替代更友好 */
		if (fields.sniffed && looksLikeIpEndpoint(right) && msg.indexOf(fields.sniffed) === -1) {
			var pm = right.match(/^(?:\[[0-9a-fA-F:]+\]|\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
			if (pm) right = String(fields.sniffed) + ':' + pm[1];
		}

		return left + ' <-> ' + right;
	}

	return msg;
}

function parseLine(raw) {
	var m;
	var fields = parseLogfmt(raw);
	if (fields && (fields.time || fields.msg)) {
		var ts = extractHms(fields.time);
		var cm = compactLogfmt(fields);
		return {
			ts: ts,
			msg: cm || raw,
			outbound: fields.outbound || '',
			dialer: fields.dialer || '',
		};
	}

	m = raw.match(/^time="?(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}))/);
	if (m) return { ts: m[2], msg: raw.slice(m[0].length).replace(/^[" ]+/, '') };
	m = raw.match(/^\[?(\d{4}[\/\-]\d{2}[\/\-]\d{2})[ T](\d{2}:\d{2}:\d{2})\]?\s*/);
	if (m) return { ts: m[2], msg: raw.slice(m[0].length) };
	return { ts: '', msg: raw };
}

function escHtml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgba(hex, alpha) {
	var m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/);
	if (!m) return '';
	var n = parseInt(m[1], 16);
	var r = (n >> 16) & 255;
	var g = (n >> 8) & 255;
	var b = n & 255;
	return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/* 检测当前是否是明亮模式 */
function isLight() {
	return window.matchMedia && window.matchMedia('(prefers-color-scheme:light)').matches;
}

return baseclass.extend({
	getRuntimeLog: function () {

		var rawLog      = '';
		var paused      = false;
		var reversed    = true;
		var activeLevel = null;
		var tabVisible  = false;
		var wasInDom    = false;
		var prevLines   = [];

		/* ── 搜索框 ── */
		var filterInput = E('input', {
			type: 'text',
			placeholder: _('搜索日志…'),
			class: 'jy-log-search',
			style: [
				'width:100%;box-sizing:border-box;',
				'padding:7px 11px;',
				'border:1px solid var(--jy-border);border-radius:5px;',
				'font-size:13px;font-weight:500;font-family:inherit;outline:none;',
				'background:var(--jy-bg2);color:var(--jy-text);',
				'-webkit-appearance:none;',
				'transition:border-color .15s,box-shadow .15s;',
			].join(''),
		});
		filterInput.addEventListener('focus', function () {
			this.style.borderColor = '#2980b9';
			this.style.boxShadow   = '0 0 0 2px rgba(41,128,185,.25)';
		});
		filterInput.addEventListener('blur', function () {
			this.style.borderColor = 'var(--jy-border)';
			this.style.boxShadow   = 'none';
		});
		filterInput.addEventListener('input', function () { renderLog(true); });

		/* ── 级别筛选按钮 ── */
		var levelBtns = {};
		function makeLevelBtn(lvl, label) {
			var c   = LEVEL_CFG[lvl];
			var btn = E('button', { style: [
				'padding:3px 11px;border-radius:20px;cursor:pointer;',
				'font-size:11px;font-weight:700;letter-spacing:.04em;',
				'border:1.5px solid ' + c.tagBg + ';',
				'color:' + c.tagBg + ';background:transparent;',
				'-webkit-tap-highlight-color:transparent;',
				'transition:background .12s,color .12s;',
			].join('') }, [label]);
			btn.addEventListener('click', function () {
				if (activeLevel === lvl) {
					activeLevel = null;
					btn.style.background = 'transparent';
					btn.style.color      = c.tagBg;
				} else {
					activeLevel = lvl;
					Object.keys(levelBtns).forEach(function (k) {
						levelBtns[k].style.background = 'transparent';
						levelBtns[k].style.color      = LEVEL_CFG[k].tagBg;
					});
					btn.style.background = c.tagBg;
					btn.style.color      = '#fff';
				}
				renderLog(true);
			});
			levelBtns[lvl] = btn;
			return btn;
		}
		var levelRow = E('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;' }, [
			makeLevelBtn('debug', 'DEBUG'),
			makeLevelBtn('info',  'INFO'),
			makeLevelBtn('warn',  'WARN'),
			makeLevelBtn('error', 'ERROR'),
		]);

		/* ── 日志容器 ── */
		var logBody = E('div', {
			class: 'jy-log-body',
			style: [
				'margin-top:10px;',
				'border:1px solid var(--jy-border);border-radius:5px;overflow:hidden;',
				'font-family:"SFMono-Regular",Consolas,monospace;font-size:12px;',
				'line-height:1.6;overflow-y:auto;-webkit-overflow-scrolling:touch;',
				'max-height:calc(100dvh - 300px);min-height:160px;',
				'background:var(--jy-bg2);',
				/* 深色滚动条（CSS变量） */
				'scrollbar-width:thin;scrollbar-color:var(--jy-scroll-thumb) var(--jy-bg2);',
			].join(''),
		});

		var MAX_LINES = 1000;

		/* ── 构建单行 ── */
		function buildRow(line, kw) {
			var lvl    = lineLevel(line);
			var parsed = parseLine(line);
			var msg    = parsed.msg || line;
			var outbound = parsed.outbound || '';
			var dialer   = parsed.dialer || '';
			var metaText = (outbound + ' ' + dialer).toLowerCase();
			/* 搜索命中但紧凑文本未包含时，临时展示原始行，避免“搜到了但看不见/不高亮” */
			if (kw && line.toLowerCase().indexOf(kw) !== -1 && msg.toLowerCase().indexOf(kw) === -1 && metaText.indexOf(kw) === -1)
				msg = line;
			var c      = LEVEL_CFG[lvl];
			var light  = isLight();

			var msgHtml;
			if (kw && msg.toLowerCase().indexOf(kw) !== -1) {
				var re    = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
				var parts = msg.split(re);
				var kwLow = kw.toLowerCase();
				msgHtml = parts.map(function (part) {
					return part.toLowerCase() === kwLow
						? '<mark style="background:#ffec3d;color:#333;border-radius:2px;padding:0 2px;">' + escHtml(part) + '</mark>'
						: escHtml(part);
				}).join('');
			} else {
				msgHtml = escHtml(msg);
			}

			var tagEl = E('span', { style: [
				'flex-shrink:0;width:15px;height:15px;border-radius:3px;',
				'font-size:9px;font-weight:800;',
				'display:inline-flex;align-items:center;justify-content:center;',
				'background:' + c.tagBg + ';color:#fff;',
				'margin-right:7px;margin-top:2px;',
			].join('') }, [LEVEL_LABEL[lvl]]);

			var tsEl = parsed.ts ? E('span', { style: [
				'flex-shrink:0;margin-right:8px;min-width:54px;',
				'font-size:10px;font-weight:600;color:var(--jy-dim);margin-top:1px;',
				'letter-spacing:-.01em;',
			].join('') }, [parsed.ts]) : null;

			/* debug 行文字在明暗模式下不同 */
			var msgColor = (lvl === 'debug')
				? (light ? 'color:rgba(80,80,80,.65);' : 'color:rgba(170,170,170,.7);')
				: 'color:var(--jy-text);';

			var chipBg = hexToRgba(c.tagBg, light ? 0.14 : 0.20) || 'rgba(128,128,128,.12)';

			function makeChip(text, title) {
				var hit = kw && String(text).toLowerCase().indexOf(kw) !== -1;
				return E('span', {
					title: title,
					style: [
						'display:inline-flex;align-items:center;',
						'height:16px;max-width:45vw;',
						'padding:0 7px;border-radius:999px;',
						'border:1px solid ' + (hit ? '#ffec3d' : c.tagBg) + ';',
						hit
							? 'background:#ffec3d;border-color:#ffec3d;color:#333;'
							: ('background:' + chipBg + ';color:' + c.tagBg + ';'),
						'font-size:10px;font-weight:800;letter-spacing:.01em;',
						'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
					].join(''),
				}, [text]);
			}

			var msgEl = E('div', { style: [
				'flex:1;min-width:0;',
				'font-size:12px;', msgColor,
			].join('') });

			if (outbound || dialer) {
				var metaRow = E('div', { style: [
					'display:flex;align-items:center;gap:4px;',
					'flex-wrap:wrap;',
					'margin:0 0 2px 0;',
				].join('') });
				if (outbound) metaRow.appendChild(makeChip(outbound, _('策略组（outbound）')));
				if (dialer)   metaRow.appendChild(makeChip(dialer,   _('节点（dialer）')));
				msgEl.appendChild(metaRow);
			}

			var msgTextEl = E('span', { style: [
				'word-break:break-all;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;',
			].join('') });
			msgTextEl.innerHTML = msgHtml;
			msgEl.appendChild(msgTextEl);

			var rowChildren = [tagEl];
			if (tsEl) rowChildren.push(tsEl);
			rowChildren.push(msgEl);

			var rowBg = light
				? (c.rowBgLight || '')
				: (c.rowBgDark  || '');

			return E('div', { style: [
				'display:flex;align-items:flex-start;',
				'padding:4px 10px;',
				'border-bottom:1px solid var(--jy-log-divider);',
				rowBg ? 'background:' + rowBg + ';' : '',
				'border-left:3px solid ' + c.border + ';',
			].join('') }, rowChildren);
		}

		function emptyEl(msg) {
			return E('div', { style: [
				'display:flex;align-items:center;justify-content:center;',
				'min-height:160px;color:var(--jy-muted);font-size:13px;',
			].join('') }, [msg]);
		}

		/* ── 渲染日志（增量追加） ── */
		function renderLog(forceRedraw) {
			var allLines = rawLog ? rawLog.split('\n').filter(Boolean) : [];
			var capped   = allLines.length > MAX_LINES ? allLines.slice(-MAX_LINES) : allLines;
			var ordered  = reversed ? capped.slice().reverse() : capped;
			var kw       = filterInput.value.trim().toLowerCase();
			var hasFilter = kw || activeLevel;

			var filtered = ordered.filter(function (line) {
				var lvl = lineLevel(line);
				return (!activeLevel || activeLevel === lvl) &&
				       (!kw        || line.toLowerCase().indexOf(kw) !== -1);
			});

			if (!filtered.length) {
				logBody.innerHTML = ''; prevLines = [];
				logBody.appendChild(emptyEl(capped.length ? _('没有匹配的日志') : _('暂无日志')));
				return;
			}

			if (!forceRedraw && !hasFilter && filtered.length > prevLines.length && prevLines.length > 0) {
				var newCount  = filtered.length - prevLines.length;
				var canAppend = true;
				var checkCount = Math.min(prevLines.length, 8);
				if (reversed) {
					var tailStart = filtered.length - prevLines.length;
					for (var ci = 0; ci < checkCount && canAppend; ci++)
						if (filtered[tailStart + ci] !== prevLines[ci]) canAppend = false;
				} else {
					for (var ci2 = 0; ci2 < checkCount && canAppend; ci2++)
						if (filtered[ci2] !== prevLines[ci2]) canAppend = false;
				}
				if (canAppend) {
					var newLines = reversed ? filtered.slice(0, newCount) : filtered.slice(prevLines.length);
					var frag = document.createDocumentFragment();
					newLines.forEach(function (line) { frag.appendChild(buildRow(line, kw)); });
					if (reversed) logBody.insertBefore(frag, logBody.firstChild);
					else          logBody.appendChild(frag);
					prevLines = filtered.slice();
					return;
				}
			}

			if (!forceRedraw && filtered.length === prevLines.length && prevLines.length > 0) {
				var same = true;
				for (var i = 0; i < Math.min(filtered.length, 5) && same; i++)
					if (filtered[i] !== prevLines[i]) same = false;
				if (same) return;
			}

			prevLines = filtered.slice();
			logBody.innerHTML = '';
			var frag2 = document.createDocumentFragment();
			filtered.forEach(function (line) { frag2.appendChild(buildRow(line, kw)); });
			logBody.appendChild(frag2);
		}

		/* ── 读取日志文件 ── */
		var fetchInFlight = false;
		function fetchLog() {
			if (fetchInFlight) return;
			fetchInFlight = true;
			return fs.read_direct(LOG, 'text')
				.then(function (res) {
					fetchInFlight = false;
					var newLog = (res || '').trim();
					if (newLog !== rawLog) { rawLog = newLog; renderLog(false); }
				})
				.catch(function (err) {
					fetchInFlight = false;
					var s = err ? err.toString() : '';
					var newLog = (s.indexOf('NotFoundError') !== -1 || s.indexOf('NoDataError') !== -1)
						? '' : _('读取错误：%s').format(err);
					if (newLog !== rawLog) { rawLog = newLog; renderLog(true); }
				});
		}

		/* ── 轮询控制 ── */
		var pollFn = function () {
			if (document.body.contains(logBody)) { wasInDom = true; }
			else {
				if (wasInDom) {
					poll.remove(pollFn);
					document.removeEventListener('visibilitychange', visibilityHandler);
				}
				return;
			}
			if (paused || document.hidden || !tabVisible) return;
			return fetchLog();
		};
		poll.add(pollFn, 5);
		setTimeout(function () { if (tabVisible && !paused) fetchLog(); }, 80);

		var visibilityHandler = function () {
			if (!document.hidden && tabVisible && !paused) fetchLog();
		};
		document.addEventListener('visibilitychange', visibilityHandler);

		/* ── 工具栏按钮 ── */
		function mkToolBtn(svgStr, title) {
			var btn = E('button', { title: title, style: [
				'width:30px;height:30px;padding:0;',
				'display:inline-flex;align-items:center;justify-content:center;',
				'border-radius:5px;cursor:pointer;',
				'border:1px solid var(--jy-border);',
				'background:transparent;color:var(--jy-muted);',
				'-webkit-tap-highlight-color:transparent;',
				'transition:background .12s,border-color .12s,color .12s;',
			].join('') });
			btn.innerHTML = svgStr;
			btn.addEventListener('mouseenter', function () {
				if (!btn._active) {
					btn.style.background  = 'rgba(128,128,128,.12)';
					btn.style.borderColor = 'var(--jy-muted)';
					btn.style.color       = 'var(--jy-text)';
				}
			});
			btn.addEventListener('mouseleave', function () {
				if (!btn._active) {
					btn.style.background  = 'transparent';
					btn.style.borderColor = 'var(--jy-border)';
					btn.style.color       = 'var(--jy-muted)';
				}
			});
			return btn;
		}

		function setActive(btn, active) {
			btn._active           = active;
			btn.style.background  = active ? 'rgba(41,128,185,.18)' : 'transparent';
			btn.style.borderColor = active ? '#2980b9'              : 'var(--jy-border)';
			btn.style.color       = active ? '#2980b9'              : 'var(--jy-muted)';
		}

		var pauseBtn = mkToolBtn(SVG_PAUSE, _('暂停刷新'));
		pauseBtn.addEventListener('click', function () {
			paused = !paused;
			pauseBtn.innerHTML = paused ? SVG_PLAY : SVG_PAUSE;
			pauseBtn.title     = paused ? _('继续刷新') : _('暂停刷新');
			setActive(pauseBtn, paused);
			if (!paused && tabVisible) fetchLog();
		});

		var sortBtn = mkToolBtn(SVG_SORT_DESC, _('倒序（最新在上）'));
		setActive(sortBtn, true);
		sortBtn.addEventListener('click', function () {
			reversed  = !reversed;
			prevLines = [];
			sortBtn.innerHTML = reversed ? SVG_SORT_DESC : SVG_SORT_ASC;
			sortBtn.title     = reversed ? _('倒序（最新在上）') : _('正序（最新在下）');
			setActive(sortBtn, reversed);
			renderLog(true);
		});

		var clearBtn = mkToolBtn(SVG_TRASH, _('清空日志'));
		clearBtn.addEventListener('mouseenter', function () {
			clearBtn.style.background  = 'rgba(192,57,43,.15)';
			clearBtn.style.borderColor = '#c0392b';
			clearBtn.style.color       = '#c0392b';
		});
		clearBtn.addEventListener('mouseleave', function () {
			clearBtn.style.background  = 'transparent';
			clearBtn.style.borderColor = 'var(--jy-border)';
			clearBtn.style.color       = 'var(--jy-muted)';
		});
		clearBtn.addEventListener('click', function () {
			return clearLogRpc().then(function (result) {
				var doReset = function () { rawLog = ''; prevLines = []; renderLog(true); };
				if (result) { doReset(); }
				else {
					return fs.exec_direct('/bin/sh', ['-c', ': > ' + LOG])
						.then(doReset)
						.catch(function (err) {
							ui.addNotification(null, E('p', [_('清空日志失败：%s').format(err)]), 'danger');
						});
				}
			});
		});

		var toolbar = E('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;' }, [
			E('span', { style: 'font-size:13px;font-weight:700;color:var(--jy-text);' }, [_('运行日志')]),
			E('div', { style: 'display:flex;gap:5px;' }, [pauseBtn, sortBtn, clearBtn]),
		]);

		var panel = E('div', {}, [toolbar, filterInput, levelRow, logBody]);

		panel._setVisible = function (visible) {
			tabVisible = visible;
			if (visible && !paused && !document.hidden) fetchLog();
		};

		return panel;
	},
});
