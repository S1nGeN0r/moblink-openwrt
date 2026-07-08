'use strict';
'require form';
'require fs';
'require network';
'require poll';
'require uci';
'require view';

var GLOBAL_SETTINGS_COLLAPSED_KEY = 'moblink.relayManager.globalSettingsCollapsed';
var GLOBAL_SETTINGS_NODE_ID = 'cbi-moblink-relay-service-globals';
var RUNTIME_POLL_INTERVAL = 5;

function addLogLevelOption(section, optionName) {
	var o = section.option(form.ListValue, optionName || 'log_level', _('Log level'));
	o.value('error', _('error'));
	o.value('warn', _('warn'));
	o.value('info', _('info'));
	o.value('debug', _('debug'));
	o.value('trace', _('trace'));
	o.default = 'info';
}

function collectUplinkCandidates(networks) {
	var candidates = [];
	var seen = {};

	(networks || []).forEach(function(net) {
		if (!net || !net.isUp || net.isUp() !== true)
			return;

		var l3Device = net.getL3Device ? net.getL3Device() : null;
		var device = l3Device ? l3Device.getName() : net.getIfname();
		var hasDefaultRoute = !!(net.getGatewayAddr && net.getGatewayAddr()) ||
			!!(net.getGateway6Addr && net.getGateway6Addr());

		if (!device || device === 'lo')
			return;

		if (!hasDefaultRoute)
			return;

		if (!seen[device]) {
			seen[device] = {
				device: device,
				networks: [],
				proto: ''
			};
			candidates.push(seen[device]);
		}

		seen[device].networks.push(net.getName());
		if (net.getProtocol && !seen[device].proto)
			seen[device].proto = net.getProtocol();
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

	return details.length ? '%s (%s)'.format(candidate.device, details.join('; ')) : candidate.device;
}

function candidateMap(candidates) {
	var map = {};

	candidates.forEach(function(candidate) {
		map[candidate.device] = candidate;
	});

	return map;
}

function buildConfigModel() {
	var model = {};

	uci.sections('moblink-relay-service').forEach(function(section) {
		model[section['.name']] = section;
	});

	return model;
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

function loadConntrack() {
	return L.resolveDefault(fs.read('/proc/net/nf_conntrack'), null).then(function(raw) {
		if (raw)
			return raw;

		return L.resolveDefault(fs.read('/proc/net/ip_conntrack'), '');
	});
}

function relayHasActiveUplink(section, candidatesByDevice) {
	return !!(section && section.interface && candidatesByDevice[section.interface]);
}

function conntrackHasHost(tokens, host) {
	for (var i = 0; i < tokens.length; i++) {
		if (tokens[i] === 'src=' + host || tokens[i] === 'dst=' + host)
			return true;
	}

	return false;
}

function hasStreamerConnection(conntrack, host) {
	var lines = String(conntrack || '').split(/\n/);

	if (!host)
		return null;

	if (!conntrack)
		return null;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];

		if (!/(^|\s)tcp(\s|$)/.test(line) || line.indexOf('ESTABLISHED') === -1)
			continue;

		var tokens = line.split(/\s+/);

		if (conntrackHasHost(tokens, host))
			return true;
	}

	return false;
}

function relayRuntimeDetails(section_id, isActive, statuses, conntrack) {
	var status = statuses[section_id] || null;
	var relays = status && Array.isArray(status.relays) ? status.relays : [];
	var streamerHost = relays.length ? relays[0].streamer_host : '';
	var streamerConnected = hasStreamerConnection(conntrack, streamerHost);

	if (!isActive)
		return {
			connection: _('inactive'),
			streamerIp: '-',
			status: _('inactive')
		};

	if (!status)
		return {
			connection: _('waiting for streamer'),
			streamerIp: '-',
			status: _('active')
		};

	if ((status.connected === true || status.connected === 1) && streamerConnected !== false)
		return {
			connection: streamerHost ? _('connected (%s)').format(streamerHost) : _('connected'),
			streamerIp: streamerHost || '-',
			status: _('active')
		};

	return {
		connection: _('waiting for streamer'),
		streamerIp: streamerHost || '-',
		status: _('active')
	};
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

function runtimeValue(section_id, field, isActive, statuses, conntrack) {
	var details = relayRuntimeDetails(section_id, isActive, statuses, conntrack);

	return details[field] || '-';
}

function runtimeSpan(section_id, field, isActive, statuses, conntrack) {
	return E('span', {
		'data-moblink-runtime-section': section_id,
		'data-moblink-runtime-field': field,
		'data-moblink-runtime-active': isActive ? '1' : '0'
	}, runtimeValue(section_id, field, isActive, statuses, conntrack));
}

function updateRuntimeFields(root, config) {
	return Promise.all([
		loadRelayStatuses(config),
		loadConntrack()
	]).then(function(data) {
		var statuses = data[0] || {};
		var conntrack = data[1] || '';
		var nodes = root ? root.querySelectorAll('[data-moblink-runtime-section]') : [];

		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			var section_id = node.getAttribute('data-moblink-runtime-section');
			var field = node.getAttribute('data-moblink-runtime-field');
			var isActive = node.getAttribute('data-moblink-runtime-active') === '1';

			node.textContent = runtimeValue(section_id, field, isActive, statuses, conntrack);
		}
	});
}

function startRuntimePoll(root, config) {
	if (!root || root.getAttribute('data-moblink-runtime-poll') === '1')
		return;

	root.setAttribute('data-moblink-runtime-poll', '1');
	poll.add(function() {
		return updateRuntimeFields(root, config);
	}, RUNTIME_POLL_INTERVAL);
}

function addRelayGrid(m, options) {
	var s, o;

	s = m.section(form.GridSection, 'relay', options.title, options.description);
	s.anonymous = true;
	s.addremove = false;
	s.nodescriptions = true;
	s.sortable = false;
	s.modaltitle = options.modalTitle;
	s.sectiontitle = function(section_id) {
		var section = options.config[section_id] || {};
		var iface = section.interface || section_id;
		var label = section.custom_label || section.detected_label || iface;

		return '%s -> %s'.format(iface, label);
	};
	s.cfgsections = function() {
		return options.sections;
	};

	o = s.option(form.Flag, 'enabled', _('Enabled'));
	o.rmempty = false;

	o = s.option(form.DummyValue, 'interface', _('Interface'));
	o.cfgvalue = function(section_id) {
		return (options.config[section_id] || {}).interface || '-';
	};

	o = s.option(form.DummyValue, '_detected_label', _('Detected as'));
	o.cfgvalue = function(section_id) {
		var section = options.config[section_id] || {};
		var candidate = options.candidatesByDevice[section.interface || ''];

		if (candidate)
			return buildCandidateLabel(candidate);

		return section.detected_label || '-';
	};

	o = s.option(form.Value, 'custom_label', _('Relay label'));
	o.rmempty = true;

	o = s.option(form.ListValue, '_streamer_mode', _('Streamer source'));
	o.value('auto', _('Automatic discovery'));
	o.value('manual', _('Manual URL'));
	o.rmempty = false;
	o.cfgvalue = function(section_id) {
		return String((options.config[section_id] || {}).use_manual_streamer_url || '0') === '1'
			? 'manual'
			: 'auto';
	};
	o.write = function(section_id, value) {
		return uci.set('moblink-relay-service', section_id, 'use_manual_streamer_url',
			value === 'manual' ? '1' : '0');
	};

	o = s.option(form.Value, 'streamer_url', _('Manual streamer URL'));
	o.rmempty = true;
	o.depends('_streamer_mode', 'manual');

	o = s.option(form.Value, 'password', _('Password'));
	o.password = true;
	o.rmempty = false;
	o.placeholder = (options.config.globals || {}).default_password || '1234';

	o = s.option(form.Value, 'database', _('Identity database'));
	o.rmempty = false;
	o.placeholder = options.databasePlaceholder;

	o = s.option(form.DummyValue, '_connection', _('Connection'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'connection', options.active, options.runtimeStatuses, options.conntrack);
	};

	o = s.option(form.DummyValue, '_streamer_ip', _('Streamer IP'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'streamerIp', options.active, options.runtimeStatuses, options.conntrack);
	};

	o = s.option(form.DummyValue, '_status', _('Status'));
	o.cfgvalue = function(section_id) {
		return runtimeSpan(section_id, 'status', options.active, options.runtimeStatuses, options.conntrack);
	};
}

return view.extend({
	load: function() {
		return uci.load('moblink-relay-service').then(function() {
			var config = buildConfigModel();

			return Promise.all([
				network.getNetworks(),
				loadRelayStatuses(config),
				loadConntrack()
			]);
		});
	},

	render: function(data) {
		var config = buildConfigModel();
		var networks = Array.isArray(data && data[0]) ? data[0] : [];
		var runtimeStatuses = data && data[1] ? data[1] : {};
		var conntrack = data && data[2] ? data[2] : '';
		var candidates = collectUplinkCandidates(networks);
		var candidatesByDevice = candidateMap(candidates);
		var allRelaySections = relaySections(config);
		var activeRelaySections = allRelaySections.filter(function(name) {
			return relayHasActiveUplink(config[name] || {}, candidatesByDevice);
		});
		var inactiveRelaySections = allRelaySections.filter(function(name) {
			return !relayHasActiveUplink(config[name] || {}, candidatesByDevice);
		});
		var m, s, o;

			m = new form.Map('moblink-relay-service', _('Moblink Relay Manager'),
				_('Runs one independent Moblink relay process per available relay uplink so the client can manage priority and bonding separately.'));

			s = m.section(form.NamedSection, 'globals', 'globals', _('Global settings'));
			s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable Moblink relay manager'));
		o.rmempty = false;

		o = s.option(form.Flag, 'auto_create_relays', _('Auto-create relays for available uplinks'),
			_('Automatically create one relay section per active interface that currently exposes a usable default route, including backup or fallback links.'));
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
			active: true,
			candidatesByDevice: candidatesByDevice,
			config: config,
			conntrack: conntrack,
			databasePlaceholder: '/etc/moblink-relay.json',
			description: candidates.length
				? _('One running relay process will be started for each active enabled relay section and can use backup links even when the router itself prefers another WAN.')
				: _('No active relay uplinks are detected right now. Existing relay sections remain stored below when enabled.'),
			modalTitle: _('Relay settings'),
			runtimeStatuses: runtimeStatuses,
			sections: activeRelaySections,
			title: _('Active relays')
		});

		addRelayGrid(m, {
			active: false,
			candidatesByDevice: candidatesByDevice,
			config: config,
			conntrack: conntrack,
			databasePlaceholder: '/etc/moblink-relay.json',
			description: _('Stored relay sections that currently have no default-route uplink. Enable "Show inactive relays" above to display them.'),
			modalTitle: _('Inactive relay settings'),
			runtimeStatuses: runtimeStatuses,
			sections: showInactiveRelays(config) ? inactiveRelaySections : [],
			title: _('Inactive relays')
		});

			return m.render().then(function(node) {
				enableCollapsibleSections(node);
				startRuntimePoll(node, config);
				return node;
			});
	}
});
