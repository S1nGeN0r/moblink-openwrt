#!/bin/sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"

# shellcheck source=../feed/net/moblink/files/moblink-relay-common.sh
. "$ROOT_DIR/feed/net/moblink/files/moblink-relay-common.sh"

assert_success() {
	local description="$1"
	shift

	if ! "$@"; then
		printf 'FAIL: %s\n' "$description" >&2
		exit 1
	fi
}

assert_failure() {
	local description="$1"
	shift

	if "$@"; then
		printf 'FAIL: %s\n' "$description" >&2
		exit 1
	fi
}

assert_equal() {
	local description="$1"
	local expected="$2"
	local actual="$3"

	if [ "$actual" != "$expected" ]; then
		printf 'FAIL: %s: expected "%s", got "%s"\n' "$description" "$expected" "$actual" >&2
		exit 1
	fi
}

assert_success 'wwan device is policy routed' is_policy_routed_uplink wwan0 static
assert_success 'PPP device is policy routed' is_policy_routed_uplink ppp0 none
assert_success 'ModemManager protocol is policy routed' is_policy_routed_uplink eth2 modemmanager
assert_success 'QMI protocol is policy routed' is_policy_routed_uplink eth2 qmi
assert_failure 'ordinary DHCP ethernet needs a default route' is_policy_routed_uplink eth0 dhcp
assert_success 'WireGuard device is a VPN uplink' is_vpn_uplink wg0 static
assert_success 'AmneziaWG protocol is a VPN uplink' is_vpn_uplink custom0 amneziawg
assert_success 'AWG device is a VPN uplink' is_vpn_uplink awg0 static
assert_failure 'ordinary ethernet is not a VPN uplink' is_vpn_uplink eth0 dhcp
assert_success 'IPv4 literal is recognized' is_ipv4_literal 192.0.2.10
assert_failure 'DNS hostname is not an IPv4 literal' is_ipv4_literal streamer.lan
assert_failure 'out-of-range IPv4 is rejected' is_ipv4_literal 192.0.2.256
assert_failure 'short IPv4 is rejected' is_ipv4_literal 192.0.2
AVAILABLE_INTERFACES=" "
mark_interface_available eth0
mark_interface_available eth0
mark_interface_available wwan0
assert_equal 'available interfaces are recorded once' \
	' eth0 wwan0 ' \
	"$AVAILABLE_INTERFACES"
assert_equal 'relay database is section-specific' \
	'/etc/moblink-relay-relay_phone_2.json' \
	"$(default_database_path 'relay-phone.2')"

assert_equal 'VLAN is escaped literally' 'eth0\.10' "$(escape_interface_pattern eth0.10)"
assert_equal 'regex metacharacters are escaped' 'x\[1\]\+\(a\)\{2\}\|\^\$\?\*\\z' \
	"$(escape_interface_pattern 'x[1]+(a){2}|^$?*\z')"

uci() {
	case "$2" in
		get) printf '%s' relay ;;
		set) printf 'FAIL: discovery must not overwrite an existing section\n' >&2; exit 1 ;;
	esac
}
CONFIG_FILE=moblink-relay-service
GLOBAL_DEFAULT_PASSWORD=1234
SYNC_CHANGED=0
GLOBAL_AUTO_CREATE_RELAYS=0
ensure_relay_section eth0 'eth0 (wan)'
GLOBAL_AUTO_CREATE_RELAYS=1
ensure_relay_section eth0 'eth0 (wan)'
assert_equal 'existing user section is unchanged' 0 "$SYNC_CHANGED"

printf 'relay-common tests passed\n'
