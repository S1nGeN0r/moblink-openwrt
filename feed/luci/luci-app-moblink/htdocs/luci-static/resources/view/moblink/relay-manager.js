'use strict';
'require form';
'require fs';
'require network';
'require poll';
'require rpc';
'require uci';
'require view';

var GLOBAL_SETTINGS_COLLAPSED_KEY = 'moblink.relayManager.globalSettingsCollapsed';
var GLOBAL_SETTINGS_NODE_ID = 'cbi-moblink-relay-service-globals';
var RUNTIME_POLL_INTERVAL = 5;
var callSystemInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });

function addLogLevelOption(section, optionName) {
	var o = section.option(form.ListValue, optionName || 'log_level', _('Log level'));
	o.value('error', _('error'));
	o.value('warn', _('warn'));
	o.value('info', _('info'));
	o.value('debug', _('debug'));
	o.value('trace', _('trace'));
	o.default = 'info';
}

function isPolicyRoutedUplink(device, proto) {
	return /^(?:modem|ppp|rmnet|wwan|wwp)/i.test(String(device || '')) ||
		/^(?:3g|mbim|modemmanager|ncm|ppp|qmi)$/i.test(String(proto || ''));
}

function isVpnUplink(device, proto) {
	return /^(?:wg|awg|tun|tap|tailscale|zt)/i.test(String(device || '')) ||
		/^(?:wg.*|wireguard|amneziawg|.*vpn.*|tailscale)$/i.test(String(proto || ''));
}

function collectAvailableInterfaces(networks, excludeVpnUplinks) {
	var candidates = [];
	var seen = {};

	(networks || []).forEach(function(net) {
		if (!net || !net.isUp || net.isUp() !== true)
			return;

		var l3Device = net.getL3Device ? net.getL3Device() : null;
		var device = l3Device ? l3Device.getName() : net.getIfname();
		var proto = net.getProtocol ? net.getProtocol() : '';
		var hasDefaultRoute = !!(net.getGatewayAddr && net.getGatewayAddr()) ||
			!!(net.getGateway6Addr && net.getGateway6Addr());

		if (!device || device === 'lo')
			return;

		if (excludeVpnUplinks && isVpnUplink(device, proto))
			return;

		if (!seen[device]) {
			seen[device] = {
				autoEligible: false,
				device: device,
				networks: [],
				proto: ''
			};
			candidates.push(seen[device]);
		}

		seen[device].networks.push(net.getName());
		seen[device].autoEligible = seen[device].autoEligible ||
			hasDefaultRoute || isPolicyRoutedUplink(device, proto);
		if (!seen[device].proto)
			seen[device].proto = proto;
	});

	candidates.sort(function(a, b) {
		return String(a.device).localeCompare(String(b.device));
	});

	return candidates;
}

function buildCandidateLabel(candidate) {
	var details = [];

	if (candidate.networks.length)
		details.push(candidate.networks.join(', '));

	if (candidate.proto && !/^dhcpv?6?$/.test(candidate.proto) && details.indexOf(candidate.proto) === -1)
		details.push(candidate.proto);

	if (!candidate.autoEligible)
		details.push(_('manual only'));

	return details.length ? '%s (%s)'.format(candidate.device, details.join('; ')) : candidate.device;
}

function candidateMap(candidates) {
	var map = {};

	candidates.forEach(function(candidate) {
		map[candidate.device] = candidate;
	});

	return map;
}

function relayInterfaceChoices(candidates, config) {
	var choices = [];
	var seen = {};

	(candidates || []).forEach(function(candidate) {
		seen[candidate.device] = true;
		choices.push({
			label: buildCandidateLabel(candidate),
			value: candidate.device
		});
	});

	relaySections(config).forEach(function(section_id) {
		var device = (config[section_id] || {}).interface;

		if (device && !seen[device]) {
			seen[device] = true;
			choices.push({
				label: _('%s (currently unavailable)').format(device),
				value: device
			});
		}
	});

	return choices;
}

function buildConfigModel() {
	var model = {};

	uci.sections('moblink-relay-service').forEach(function(section) {
		model[section['.name']] = section;
	});

	return model;
}

function relayConfigValue(section_id, option, fallback) {
	var value = uci.get('moblink-relay-service', section_id, option);

	return value == null || value === '' ? fallback : value;
}

function relaySections(config) {
	return Object.keys(config || {}).filter(function(name) {
		return config[name] && config[name]['.type'] === 'relay';
	}).sort();
}

function showInactiveRelays(config) {
	var globals = config.globals || {};
	return String(globals.show_inactive_relays || '0') === '1';
}

function sanitizeName(value) {
	return String(value || '').replace(/[^A-Za-z0-9_]/g, '_');
}

function runtimeStatusPath(section_id) {
	return '/tmp/moblink-relay-status/%s.json'.format(sanitizeName(section_id));
}

function defaultRelayDatabase(section_id) {
	return '/etc/moblink-relay-%s.json'.format(sanitizeName(section_id));
}

function loadRelayStatuses(config) {
	var sections = relaySections(config);

	return Promise.all(sections.map(function(section_id) {
		return L.resolveDefault(fs.read(runtimeStatusPath(section_id)), null).then(function(raw) {
			var parsed = null;

			if (raw) {
				try {
					parsed = JSON.parse(raw);
				} catch (e) {
					parsed = null;
				}
			}

			return [ section_id, parsed ];
		});
	})).then(function(results) {
		var statuses = {};

		results.forEach(function(result) {
			statuses[result[0]] = result[1];
		});

		return statuses;
	});
}

function relayRuntimeDetails(section_id, isActive, statuses, routerUptime, config) {
	var section = (config || {})[section_id] || {};
	var globals = (config || {}).globals || {};
	var status = statuses[section_id] || null;
	var result = { connection: _('waiting for streamer'), streamerIp: '-', status: _('active') };

	if (String(globals.enabled || '0') !== '1' || String(section.enabled == null ? '1' : section.enabled) !== '1')
		return { connection: _('disabled'), streamerIp: '-', status: _('disabled') };
	if (!isActive)
		return { connection: _('inactive'), streamerIp: '-', status: _('inactive') };
	if (!status)
		return result;
	if (status.schema_version !== 2 || !Number.isFinite(routerUptime) ||
		!Number.isFinite(status.updated_uptime) || status.updated_uptime <= 0 ||
		routerUptime - status.updated_uptime > 15 || status.updated_uptime - routerUptime > 5) {
		result.connection = _('status unavailable');
		return result;
	}

	var relays = Array.isArray(status.relays) ? status.relays : [];
	var connected = relays.filter(function(relay) { return relay.connected === true; });
	if (connected.length) {
		var peers = connected.map(function(relay) { return relay.streamer_ip || relay.streamer_host || ''; })
			.filter(function(peer, index, peers) { return peer && peers.indexOf(peer) === index; });
		result.streamerIp = peers.join(', ') || '-';
		result.connection = peers.length ? _('connected (%s)').format(peers.join(', ')) : _('connected');
	}
	else if (relays.some(function(relay) { return relay.wrong_password === true; })) {
		result.connection = _('wrong password');
	}
	else if (relays.length) {
		result.connection = _('connecting');
	}
	return result;
}

function validateStreamerUrl(value) {
	if (!value)
		return _('Enter a WebSocket URL for manual mode');
	try {
		var url = new URL(value);
		if (url.protocol === 'ws:' && url.hostname && !url.username && !url.password && !url.hash &&
			!/\s/.test(value))
			return true;
	} catch (e) {}
	return _('Enter a ws:// URL without credentials or fragments');
}

function storageGet(key) {
	try {
		return window.localStorage ? window.localStorage.getItem(key) : null;
	} catch (e) {
		return null;
	}
}

function storageSet(key, value) {
	try {
		if (window.localStorage)
			window.localStorage.setItem(key, value);
	} catch (e) {}
}

function findSectionByNodeId(root, nodeId) {
	var node = root ? root.querySelector('#' + nodeId) : null;

	return node ? node.closest('.cbi-section') : null;
}

function setSectionCollapsed(section, title, collapsed) {
	var heading = section ? section.querySelector('h2, h3, h4') : null;
	var indicator;

	if (!section || !heading)
		return;

	for (var node = heading.nextElementSibling; node; node = node.nextElementSibling)
		node.style.display = collapsed ? 'none' : '';

	indicator = heading.querySelector('.moblink-collapse-indicator');
	if (!indicator) {
		indicator = E('span', {
			'class': 'moblink-collapse-indicator',
			'aria-hidden': 'true',
			'style': 'margin-left:.4em'
		});
		heading.appendChild(indicator);
	}

	heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	heading.classList.toggle('moblink-collapsed', collapsed);
	indicator.textContent = collapsed ? '>' : 'v';
}

function enableSectionCollapse(root, options) {
	var section = findSectionByNodeId(root, options.nodeId);
	var heading = section ? section.querySelector('h2, h3, h4') : null;
	var stored = storageGet(options.storageKey);
	var collapsed = stored == null ? !!options.defaultCollapsed : stored === '1';

	if (!section || !heading)
		return;

	heading.style.cursor = 'pointer';
	heading.setAttribute('tabindex', '0');
	heading.setAttribute('role', 'button');
	heading.setAttribute('title', _('Toggle section'));

	if (heading.getAttribute('data-moblink-collapse-bound') !== '1') {
		heading.setAttribute('data-moblink-collapse-bound', '1');

		function toggle() {
			var isCollapsed = heading.getAttribute('aria-expanded') === 'false';

			storageSet(options.storageKey, isCollapsed ? '0' : '1');
			setSectionCollapsed(section, options.title, !isCollapsed);
		}

		heading.addEventListener('click', toggle);
		heading.addEventListener('keydown', function(ev) {
			if (ev.key !== 'Enter' && ev.key !== ' ')
				return;

			ev.preventDefault();
			toggle();
		});
	}

	setSectionCollapsed(section, options.title, collapsed);
}

function enableCollapsibleSections(root) {
	enableSectionCollapse(root, {
		defaultCollapsed: false,
		nodeId: GLOBAL_SETTINGS_NODE_ID,
		storageKey: GLOBAL_SETTINGS_COLLAPSED_KEY,
		title: _('Global settings')
	});
}

function runtimeValue(section_id, field, isActive, statuses, routerUptime, config) {
	return relayRuntimeDetails(section_id, isActive, statuses, routerUptime, config)[field] || '-';
}

function runtimeSpan(section_id, field, isActive, statuses, routerUptime, config) {
	return E('span', {
		'data-moblink-runtime-section': section_id,
		'data-moblink-runtime-field': field
	}, runtimeValue(section_id, field, isActive, statuses, routerUptime, config));
}

function updateRuntimeFields(root) {
	var config = buildConfigModel();
	return Promise.all([
		loadRelayStatuses(config),
		L.resolveDefault(callSystemInfo(), {}),
		L.resolveDefault(network.flushCache().then(function() { return network.getNetworks(); }), [])
	]).then(function(data) {
		var excludeVpn = String((config.globals || {}).exclude_vpn_uplinks || '0') === '1';
		var available = candidateMap(collectAvailableInterfaces(data[2], excludeVpn));
		var nodes = root ? root.querySelectorAll('[data-moblink-runtime-section]') : [];

		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			var section_id = node.getAttribute('data-moblink-runtime-section');
			var field = node.getAttribute('data-moblink-runtime-field');
			var section = config[section_id] || {};
			node.textContent = runtimeValue(section_id, field, !!available[section.interface],
				data[0] || {}, Number(data[1].uptime), config);
		}
	});
}

function startRuntimePoll(root) {
	if (!root || root.getAttribute('data-moblink-runtime-poll') === '1')
		return;
	root.setAttribute('data-moblink-runtime-poll', '1');
	var callback = function() {
		if (!root.isConnected) {
			poll.remove(callback);
			root.removeAttribute('data-moblink-runtime-poll');
			return;
		}
		return updateRuntimeFields(root);
	};
	poll.add(callback, RUNTIME_POLL_INTERVAL);
}

function attachRuntimeLifecycle(map) {
	var renderContents = map.renderContents;
	map.renderContents = function() {
		return Promise.resolve(renderContents.apply(this, arguments)).then(function(root) {
			enableCollapsibleSections(root);
			startRuntimePoll(root);
			return updateRuntimeFields(root).then(function() { return root; });
		});
	};
}

function addRelayGrid(m, options) {
	var s, o;

	s = m.section(form.GridSection, 'relay', options.title, options.description);
	s.anonymous = true;
	s.addremove = !!options.addremove;
	s.nodescriptions = true;
	s.sortable = false;
	s.modaltitle = options.modalTitle;
	s.sectiontitle = function(section_id) {
		var iface = relayConfigValue(section_id, 'interface', section_id);
		var label = relayConfigValue(section_id, 'custom_label', '') ||
			relayConfigValue(section_id, 'detected_label', '') || iface;

		return '%s -> %s'.format(iface, label);
	};
	s.filter = function(section_id) {
		var device = relayConfigValue(section_id, 'interface', '');
		var active = !!options.candidatesByDevice[device];

		return active === options.active && (active || showInactiveRelays(buildConfigModel()));
	};

	o = s.option(form.Flag, 'enabled', _('Enabled'));
	o.rmempty = false;
	o.default = '1';

	o = s.option(form.ListValue, 'interface', _('Interface'));
	(options.interfaceChoices || []).forEach(function(choice) {
		o.value(choice.value, choice.label);
	});
	o.rmempty = false;
	o.validate = function(section_id, value) {
		return value ? true : _('Select an uplink interface');
	};

	o = s.option(form.DummyValue, '_detected_label', _('Detected as'));
	o.cfgvalue = function(section_id) {
		var device = relayConfigValue(section_id, 'interface', '');
		var candidate = options.candidatesByDevice[device];

		if (candidate)
			return buildCandidateLabel(candidate);

		return relayConfigValue(section_id, 'detected_label', '-');
	};

	o = s.option(form.Value, 'custom_label', _('Relay label'));
	o.rmempty = true;

	o = s.option(form.ListValue, '_streamer_mode', _('Streamer source'));
	o.value('auto', _('Automatic discovery'));
	o.value('manual', _('Manual URL'));
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return String(relayConfigValue(section_id, 'use_manual_streamer_url', '0')) === '1'
			? 'manual'
			: 'auto';
	};
	o.write = function(section_id, value) {
		return uci.set('moblink-relay-service', section_id, 'use_manual_streamer_url',
			value === 'manual' ? '1' : '0');
	};

	o = s.option(form.Value, 'streamer_url', _('Manual streamer URL'));
	o.placeholder = 'ws://streamer.lan:7777';
	o.rmempty = false;
	o.retain = true;
	o.depends('_streamer_mode', 'manual');
	o.description = _('DNS hostnames are supported and avoid coupling a relay to a changing client IP address.');
	o.validate = function(section_id, value) {
		var mode = this.section.formvalue(section_id, '_streamer_mode');

		return mode === 'manual' ? validateStreamerUrl(value) : true;
	};

	o = s.option(form.Value, 'password', _('Password'));
	o.password = true;
	o.rmempty = false;
	o.placeholder = (options.config.globals || {}).default_password || '1234';
	o.cfgvalue = function(section_id) {
		return relayConfigValue(section_id, 'password',
			relayConfigValue('globals', 'default_password', '1234'));
	};

	o = s.option(form.Value, 'database', _('Identity database'));
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return relayConfigValue(section_id, 'database', defaultRelayDatabase(section_id));
	};

	o = s.option(form.DummyValue, '_connection', _('Connection'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'connection', options.active, options.runtimeStatuses, options.routerUptime, buildConfigModel());
	};
	// GridSection uses textvalue(), whose default would stringify the live DOM node.
	o.textvalue = o.cfgvalue;

	o = s.option(form.DummyValue, '_streamer_ip', _('Streamer IP'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'streamerIp', options.active, options.runtimeStatuses, options.routerUptime, buildConfigModel());
	};
	o.textvalue = o.cfgvalue;

	o = s.option(form.DummyValue, '_status', _('Status'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'status', options.active, options.runtimeStatuses, options.routerUptime, buildConfigModel());
	};
	o.textvalue = o.cfgvalue;
}

return view.extend({
	load: function() {
		return uci.load('moblink-relay-service').then(function() {
			var config = buildConfigModel();

			return Promise.all([
				network.getNetworks(),
				loadRelayStatuses(config),
				L.resolveDefault(callSystemInfo(), {})
			]);
		});
	},

	render: function(data) {
		var config = buildConfigModel();
		var networks = Array.isArray(data && data[0]) ? data[0] : [];
		var runtimeStatuses = data && data[1] ? data[1] : {};
		var routerUptime = Number(data && data[2] ? data[2].uptime : NaN);
		var excludeVpnUplinks = String((config.globals || {}).exclude_vpn_uplinks || '0') === '1';
		var candidates = collectAvailableInterfaces(networks, excludeVpnUplinks);
		var candidatesByDevice = candidateMap(candidates);
		var interfaceChoices = relayInterfaceChoices(candidates, config);
		var m, s, o;

			m = new form.Map('moblink-relay-service', _('Moblink Relay Manager'),
				_('Runs one independent Moblink relay process per available relay uplink so the client can manage priority and bonding separately.'));

			s = m.section(form.NamedSection, 'globals', 'globals', _('Global settings'));
			s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable Moblink relay manager'));
		o.rmempty = false;

		o = s.option(form.Flag, 'auto_create_relays', _('Auto-create relays for available uplinks'),
			_('Automatically create one relay section per default-route uplink or active policy-routed modem interface.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'exclude_vpn_uplinks', _('Exclude VPN uplinks'),
			_('Leave disabled if WireGuard or other VPN uplinks should also become independent relay sections alongside physical or backup links.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Flag, 'show_inactive_relays', _('Show inactive relays'),
			_('Inactive relay sections are kept for safety and hidden by default.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'default_password', _('Default password for new relays'));
		o.password = true;
		o.rmempty = false;
		o.default = '1234';

		addLogLevelOption(s, 'log_level');

		o = s.option(form.Flag, 'no_log_timestamps', _('Disable log timestamps'));
		o.default = '1';

		o = s.option(form.Value, 'status_executable', _('Status executable'));
		o.placeholder = '/usr/bin/moblink-status.sh';

		o = s.option(form.Value, 'status_file', _('Status file'));
		o.placeholder = '/tmp/moblink-status.json';

			o = s.option(form.DynamicList, 'network_interfaces_to_ignore', _('Ignore interface regex'));
			o.placeholder = 'tailscale.*';

		addRelayGrid(m, {
			addremove: true,
			active: true,
			candidatesByDevice: candidatesByDevice,
			config: config,
			routerUptime: routerUptime,
			interfaceChoices: interfaceChoices,
			description: candidates.length
				? _('Each enabled relay section starts an independent process. Multiple relays may intentionally share one uplink interface.')
				: _('No active relay uplinks are detected right now. Existing relay sections remain stored below when enabled.'),
			modalTitle: _('Relay settings'),
			runtimeStatuses: runtimeStatuses,
			title: _('Active relays')
		});

		addRelayGrid(m, {
			addremove: false,
			active: false,
			candidatesByDevice: candidatesByDevice,
			config: config,
			routerUptime: routerUptime,
			interfaceChoices: interfaceChoices,
			description: _('Stored relay sections whose uplink is currently unavailable. Enable "Show inactive relays" above to display them.'),
			modalTitle: _('Inactive relay settings'),
			runtimeStatuses: runtimeStatuses,
			visible: showInactiveRelays(config),
			title: _('Inactive relays')
		});

			attachRuntimeLifecycle(m);
			return m.render();
	}
});
