'use strict';
'require form';
'require view';

function addLogLevelOption(section) {
	var o = section.option(form.ListValue, 'log_level', _('Log level'));
	o.value('error', _('error'));
	o.value('warn', _('warn'));
	o.value('info', _('info'));
	o.value('debug', _('debug'));
	o.value('trace', _('trace'));
	o.default = 'info';
}

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('moblink-streamer', _('Moblink Streamer'),
			_('Configure the WebSocket listener, TUN network, and bonded UDP destination.'));

		s = m.section(form.NamedSection, 'main', 'service');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('Name'));
		o.placeholder = 'GL-AXT1800';

		o = s.option(form.Value, 'id', _('ID'));
		o.placeholder = 'optional';

		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;
		o.rmempty = false;

		o = s.option(form.Value, 'websocket_server_address', _('WebSocket listen address'));
		o.placeholder = '0.0.0.0';
		o.rmempty = false;

		o = s.option(form.Value, 'websocket_server_port', _('WebSocket listen port'));
		o.datatype = 'port';
		o.placeholder = '7777';
		o.rmempty = false;

		o = s.option(form.Value, 'tun_ip_network', _('TUN IP network'));
		o.placeholder = '10.3.3.0/24';
		o.rmempty = false;

		o = s.option(form.Value, 'destination_address', _('Destination address'));
		o.placeholder = '192.168.1.10';
		o.rmempty = false;

		o = s.option(form.Value, 'destination_port', _('Destination port'));
		o.datatype = 'port';
		o.placeholder = '5000';

		addLogLevelOption(s);

		o = s.option(form.Flag, 'no_log_timestamps', _('Disable log timestamps'));
		o.default = '1';

		return m.render();
	}
});
