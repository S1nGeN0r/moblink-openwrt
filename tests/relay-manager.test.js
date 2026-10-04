'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,
	'../feed/luci/luci-app-moblink/htdocs/luci-static/resources/view/moblink/relay-manager.js'), 'utf8');

function harness() {
	const state = { config: { globals: { '.name': 'globals', enabled: '1' },
		relay_eth0: { '.name': 'relay_eth0', '.type': 'relay', interface: 'eth0', enabled: '1' } },
		reads: [], files: {}, networks: [], polls: new Set(), storage: new Map() };
	const context = {
		URL, _: s => s, Number,
		form: {},
		rpc: { declare: () => async () => ({ localtime: 11800, uptime: 1000 }) },
		uci: { sections: () => Object.values(state.config) },
		fs: { read: async file => { state.reads.push(file); return state.files[file] || ''; } },
		L: { resolveDefault: (promise, fallback) => promise.catch(() => fallback) },
		network: { flushCache: async () => {}, getNetworks: async () => state.networks },
		poll: { add: cb => state.polls.add(cb), remove: cb => state.polls.delete(cb) },
		window: { localStorage: { getItem: k => state.storage.get(k) ?? null, setItem: (k, v) => state.storage.set(k, v) } },
		E: (tag, attrs, text) => ({ tag, attrs, textContent: text || '' })
	};

	vm.createContext(context);
	vm.runInContext('String.prototype.format = function(...args) { let i=0; return this.replace(/%s/g, () => args[i++]); };', context);
	const api = vm.runInContext('(function(){' + source.replace('return view.extend({',
		'return { relayRuntimeDetails, validateStreamerUrl, isVpnUplink, updateRuntimeFields, attachRuntimeLifecycle, addRelayGrid }; return view.extend({') + '})()', context);
	return { api, state };
}

const runtime = relays => ({ schema_version: 2, updated_at: 1791153222, updated_uptime: 1000, process_id: 42, relays });

test('GridSection text values preserve the live runtime elements', () => {
	const { api, state } = harness();
	const fields = {};
	const section = { option(type, name) {
		return fields[name] = { value() {}, depends() {} };
	} };
	api.addRelayGrid({ section: () => section }, {
		config: state.config, candidatesByDevice: {}, active: true,
		runtimeStatuses: { relay_eth0: runtime([{ connected: true, streamer_ip: '192.0.2.10' }]) },
		routerUptime: 1000
	});
	for (const [option, field] of [['_connection', 'connection'], ['_streamer_ip', 'streamerIp'], ['_status', 'status']]) {
		const node = fields[option].textvalue('relay_eth0');
		assert.equal(node.tag, 'span');
		assert.equal(node.attrs['data-moblink-runtime-field'], field);
		assert.equal(node.attrs['data-moblink-runtime-section'], 'relay_eth0');
	}
});

test('authentication, not presence of a relay or unrelated TCP, determines status', () => {
	const { api, state } = harness();
	let status = runtime([{ connected: false, streamer_host: 'streamer.lan' }]);
	status.connected = true;
	const details = () => api.relayRuntimeDetails('relay_eth0', true, { relay_eth0: status }, 1000, state.config);
	assert.equal(details().connection, 'connecting');
	status = runtime([{ connected: true, streamer_host: 'streamer.lan', streamer_ip: '192.0.2.10' }]);
	assert.equal(details().connection, 'connected (192.0.2.10)');
	status = runtime([{ wrong_password: true, connected: false }]);
	assert.equal(details().connection, 'wrong password');
	status.updated_uptime = 980;
	assert.equal(details().connection, 'status unavailable');
	status = { connected: true, relays: [] };
	assert.equal(details().connection, 'status unavailable');
	state.config.relay_eth0.enabled = '0';
	assert.equal(details().connection, 'disabled');
});

test('all authenticated streamers are considered, not only the first', () => {
	const { api, state } = harness();
	const status = runtime([{ connected: false, streamer_host: 'old.lan' },
		{ connected: true, streamer_ip: '192.0.2.20' }]);
	assert.equal(api.relayRuntimeDetails('relay_eth0', true, { relay_eth0: status }, 1000, state.config).connection,
		'connected (192.0.2.20)');
});

test('manual URLs require WS and support DNS and IPv6 literals', () => {
	const { api } = harness();
	for (const value of ['ws://streamer.lan:7777', 'ws://192.0.2.10:7777', 'ws://[::1]:7777'])
		assert.equal(api.validateStreamerUrl(value), true);
	for (const value of ['', 'wss://streamer.lan', 'http://streamer.lan', 'ws://', 'ws://user:pass@host', 'ws://host:99999', 'ws://host/#secret'])
		assert.notEqual(api.validateStreamerUrl(value), true);
	assert.equal(api.isVpnUplink('custom0', 'amneziawg'), true);
	assert.equal(api.isVpnUplink('awg0', 'static'), true);
});

test('polling reads newly saved sections and reevaluates network availability', async () => {
	const { api, state } = harness();
	const node = { getAttribute: key => key.endsWith('-section') ? 'new_relay' : 'connection', textContent: '' };
	const root = { querySelectorAll: () => [node] };
	await api.updateRuntimeFields(root);
	state.config.new_relay = { '.name': 'new_relay', '.type': 'relay', interface: 'eth0' };
	state.files['/tmp/moblink-relay-status/new_relay.json'] = JSON.stringify(runtime([{ connected: true, streamer_ip: '192.0.2.30' }]));
	state.networks = [{ isUp: () => true, getIfname: () => 'eth0', getName: () => 'wan' }];
	await api.updateRuntimeFields(root);
	assert.equal(node.textContent, 'connected (192.0.2.30)');
	assert.ok(state.reads.includes('/tmp/moblink-relay-status/new_relay.json'));
	state.networks = [];
	await api.updateRuntimeFields(root);
	assert.equal(node.textContent, 'inactive');
});

test('Save re-render restores collapse handlers without extra poll registrations', async () => {
	const { api, state } = harness();
	state.storage.set('moblink.relayManager.globalSettingsCollapsed', '1');
	const rootAttrs = {};
	let heading, body;
	const root = { isConnected: true, querySelectorAll: () => [],
		getAttribute: k => rootAttrs[k], setAttribute: (k,v) => { rootAttrs[k]=v; },
		removeAttribute: k => { delete rootAttrs[k]; },
		querySelector: () => ({ closest: () => ({ querySelector: () => heading }) }) };
	const map = { renderContents() {
		const attrs = {}, listeners = {};
		body = { style: {}, nextElementSibling: null };
		heading = { style: {}, nextElementSibling: body, classList: { toggle() {} },
			getAttribute: k => attrs[k], setAttribute: (k,v) => { attrs[k]=v; },
			querySelector: () => null, appendChild() {}, addEventListener: (k,cb) => { listeners[k]=cb; }, listeners };
		return Promise.resolve(root);
	} };
	api.attachRuntimeLifecycle(map);
	await map.renderContents();
	assert.equal(body.style.display, 'none');
	assert.equal(state.polls.size, 1);
	await map.renderContents();
	assert.equal(body.style.display, 'none');
	assert.equal(state.polls.size, 1);
	heading.listeners.click();
	assert.equal(body.style.display, '');
	root.isConnected = false;
	await [...state.polls][0]();
	assert.equal(state.polls.size, 0);
});
