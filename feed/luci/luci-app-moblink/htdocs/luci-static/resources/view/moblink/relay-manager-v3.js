'use strict';
'require form';
'require network';
'require uci';
'require view';

function addLogLevelOption(section, optionName) {
	var o = section.option(form.ListValue, optionName || 'log_level', _('Log level'));
	o.value('error', _('error'));
	o.value('warn', _('warn'));
	o.value('info', _('info'));
	o.value('debug', _('debug'));
	o.value('trace', _('trace'));
	o.default = 'info';
}

function isVpnUplink(candidate) {
	var proto = candidate.proto || '';
	var device = candidate.device || '';

	return /^(wg|wireguard)/.test(proto) ||
		/(vpn|tailscale)/.test(proto) ||
		/^(wg|tun|tap|tailscale|zt)/.test(device);
}

function collectUplinkCandidates(networks) {
	var candidates = [];
	var seen = {};

	(networks || []).forEach(function(net) {
		var l3Device = net.getL3Device ? net.getL3Device() : null;
		var device = l3Device ? l3Device.getName() : net.getIfname();
		var hasDefaultRoute = !!(net.getGatewayAddr && net.getGatewayAddr()) ||
			!!(net.getGateway6Addr && net.getGateway6Addr());

		if (!net || !net.isUp || net.isUp() !== true || !device || device === 'lo')
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

function relayIsActive(section) {
	return String(section.active || '0') === '1';
}

function showInactiveRelays(config) {
	var globals = config.globals || {};
	return String(globals.show_inactive_relays || '0') === '1';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('moblink-relay-service'),
			network.getNetworks()
		]);
	},

	render: function(data) {
		var config = buildConfigModel();
		var networks = Array.isArray(data && data[1]) ? data[1] : [];
		var candidates = collectUplinkCandidates(networks);
		var candidatesByDevice = candidateMap(candidates);
		var allRelaySections = relaySections(config);
		var activeRelaySections = allRelaySections.filter(function(name) {
			return relayIsActive(config[name] || {});
		});
		var inactiveRelaySections = allRelaySections.filter(function(name) {
			return !relayIsActive(config[name] || {});
		});
		var m, s, o;

			m = new form.Map('moblink-relay-service', _('Moblink Relay Manager'),
				_('Runs one independent Moblink relay process per available relay uplink so the iPhone can manage priority and bonding separately.'));

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

			s = m.section(form.GridSection, 'relay', _('Active relays'),
				candidates.length
					? _('One running relay process will be started for each active enabled relay section and can use backup links even when the router itself prefers another WAN.')
					: _('No active relay uplinks are detected right now. Existing relay sections remain stored below when enabled.'));
			s.anonymous = true;
			s.addremove = false;
			s.nodescriptions = true;
			s.sortable = false;
			s.modaltitle = _('Relay settings');
			s.sectiontitle = function(section_id) {
				var section = config[section_id] || {};
				var iface = section.interface || section_id;
				var label = section.custom_label || section.detected_label || iface;

				return '%s -> %s'.format(iface, label);
			};
			s.cfgsections = function() {
				return activeRelaySections;
			};

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.rmempty = false;

		o = s.option(form.DummyValue, 'interface', _('Interface'));
		o.cfgvalue = function(section_id) {
			return (config[section_id] || {}).interface || '-';
		};

		o = s.option(form.DummyValue, '_detected_label', _('Detected as'));
		o.cfgvalue = function(section_id) {
			var section = config[section_id] || {};
			var candidate = candidatesByDevice[section.interface || ''];

			if (candidate)
				return buildCandidateLabel(candidate);

			return section.detected_label || '-';
		};

		o = s.option(form.Value, 'custom_label', _('Relay label on iPhone'));
		o.placeholder = 'wi-fi';
		o.rmempty = true;

			o = s.option(form.ListValue, '_streamer_mode', _('Streamer source'));
			o.value('auto', _('Automatic discovery'));
			o.value('manual', _('Manual URL'));
			o.rmempty = false;
			o.cfgvalue = function(section_id) {
				return String((config[section_id] || {}).use_manual_streamer_url || '0') === '1'
					? 'manual'
					: 'auto';
			};
			o.write = function(section_id, value) {
				return uci.set('moblink-relay-service', section_id, 'use_manual_streamer_url',
					value === 'manual' ? '1' : '0');
			};

			o = s.option(form.Value, 'streamer_url', _('Manual streamer URL'));
			o.placeholder = 'ws://172.20.10.1:7777';
			o.rmempty = true;
			o.depends('_streamer_mode', 'manual');

		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;
		o.rmempty = false;
		o.placeholder = (config.globals || {}).default_password || '1234';

		o = s.option(form.Value, 'database', _('Identity database'));
		o.rmempty = false;
		o.placeholder = '/etc/moblink-relay-sta0.json';

			o = s.option(form.DummyValue, '_connection', _('Connection'));
			o.cfgvalue = function(section_id) {
				return (config[section_id] || {}).connection_status || _('waiting for streamer');
			};

			o = s.option(form.DummyValue, '_streamer_ip', _('Streamer IP'));
			o.cfgvalue = function(section_id) {
				return (config[section_id] || {}).streamer_ip || '-';
			};

			o = s.option(form.DummyValue, '_status', _('Status'));
			o.cfgvalue = function() {
				return _('active');
			};

		o = s.option(form.DummyValue, 'last_seen', _('Last seen'));
		o.cfgvalue = function(section_id) {
			return (config[section_id] || {}).last_seen || '-';
		};

			s = m.section(form.GridSection, 'relay', _('Inactive relays'),
				_('Stored relay sections that currently have no default-route uplink. Enable "Show inactive relays" above to display them.'));
			s.anonymous = true;
			s.addremove = false;
			s.nodescriptions = true;
			s.sortable = false;
			s.modaltitle = _('Inactive relay settings');
			s.sectiontitle = function(section_id) {
				var section = config[section_id] || {};
				var iface = section.interface || section_id;
				var label = section.custom_label || section.detected_label || iface;

				return '%s -> %s'.format(iface, label);
			};
			s.cfgsections = function() {
				return showInactiveRelays(config) ? inactiveRelaySections : [];
			};

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.rmempty = false;

		o = s.option(form.DummyValue, 'interface', _('Interface'));
		o.cfgvalue = function(section_id) {
			return (config[section_id] || {}).interface || '-';
		};

		o = s.option(form.DummyValue, '_detected_label', _('Detected as'));
		o.cfgvalue = function(section_id) {
			return (config[section_id] || {}).detected_label || '-';
		};

		o = s.option(form.Value, 'custom_label', _('Relay label on iPhone'));
		o.placeholder = 'helsinki';
		o.rmempty = true;

			o = s.option(form.ListValue, '_streamer_mode', _('Streamer source'));
			o.value('auto', _('Automatic discovery'));
			o.value('manual', _('Manual URL'));
			o.rmempty = false;
			o.cfgvalue = function(section_id) {
				return String((config[section_id] || {}).use_manual_streamer_url || '0') === '1'
					? 'manual'
					: 'auto';
			};
			o.write = function(section_id, value) {
				return uci.set('moblink-relay-service', section_id, 'use_manual_streamer_url',
					value === 'manual' ? '1' : '0');
			};

			o = s.option(form.Value, 'streamer_url', _('Manual streamer URL'));
			o.placeholder = 'ws://172.20.10.1:7777';
			o.rmempty = true;
			o.depends('_streamer_mode', 'manual');

		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;
		o.rmempty = false;
		o.placeholder = (config.globals || {}).default_password || '1234';

		o = s.option(form.Value, 'database', _('Identity database'));
		o.rmempty = false;
		o.placeholder = '/etc/moblink-relay-wgclient1.json';

			o = s.option(form.DummyValue, '_connection', _('Connection'));
			o.cfgvalue = function(section_id) {
				return (config[section_id] || {}).connection_status || _('waiting for streamer');
			};

			o = s.option(form.DummyValue, '_streamer_ip', _('Streamer IP'));
			o.cfgvalue = function(section_id) {
				return (config[section_id] || {}).streamer_ip || '-';
			};

			o = s.option(form.DummyValue, '_status', _('Status'));
			o.cfgvalue = function() {
				return _('inactive');
			};

		o = s.option(form.DummyValue, 'last_seen', _('Last seen'));
		o.cfgvalue = function(section_id) {
			return (config[section_id] || {}).last_seen || '-';
		};

			return m.render();
	}
});
