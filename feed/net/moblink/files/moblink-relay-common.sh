sanitize_name() {
	printf '%s' "$1" | sed 's/[^A-Za-z0-9_]/_/g'
}

relay_section_name() {
	printf 'relay_%s' "$(sanitize_name "$1")"
}

default_database_path() {
	printf '/etc/moblink-relay-%s.json' "$(sanitize_name "$1")"
}

default_runtime_status_path() {
	printf '/tmp/moblink-relay-status/%s.json' "$(sanitize_name "$1")"
}

mark_changed() {
	SYNC_CHANGED=1
}

uci_set_if_changed() {
	local key="$1"
	local value="$2"
	local current

	current="$(uci -q get "$key" 2>/dev/null)"
	if [ "$current" != "$value" ]; then
		uci -q set "$key=$value"
		mark_changed
	fi
}

is_vpn_uplink() {
	local device="$1"
	local proto="$2"

	case "$proto" in
		wg*|wireguard|*vpn*|tailscale)
			return 0
		;;
	esac

	case "$device" in
		wg*|tun*|tap*|tailscale*|zt*)
			return 0
		;;
	esac

	return 1
}

get_label_for_interface() {
	local device="$1"
	local networks="$2"
	local proto="$3"
	local label=""

	if [ -n "$networks" ]; then
		label="$networks"
	fi

	case "$proto" in
		""|dhcp|dhcpv6|static)
			:
		;;
		*)
			if [ -n "$label" ]; then
				label="$label; $proto"
			else
				label="$proto"
			fi
		;;
	esac

	if [ -n "$label" ]; then
		printf '%s (%s)' "$device" "$label"
	else
		printf '%s' "$device"
	fi
}

ensure_relay_section() {
	local device="$1"
	local detected_label="$2"
	local section

	section="$(relay_section_name "$device")"
	ACTIVE_INTERFACES="${ACTIVE_INTERFACES}${device} "

	if [ "$GLOBAL_AUTO_CREATE_RELAYS" -ne 1 ] && [ -z "$(uci -q get "$CONFIG_FILE.$section" 2>/dev/null)" ]; then
		return 0
	fi

	uci_set_if_changed "$CONFIG_FILE.$section" relay
	uci_set_if_changed "$CONFIG_FILE.$section.interface" "$device"
	uci_set_if_changed "$CONFIG_FILE.$section.auto_created" "1"
	uci_set_if_changed "$CONFIG_FILE.$section.detected_label" "$detected_label"

	if [ -z "$(uci -q get "$CONFIG_FILE.$section.enabled" 2>/dev/null)" ]; then
		uci -q set "$CONFIG_FILE.$section.enabled=1"
		mark_changed
	fi

	if [ -z "$(uci -q get "$CONFIG_FILE.$section.password" 2>/dev/null)" ]; then
		uci -q set "$CONFIG_FILE.$section.password=$GLOBAL_DEFAULT_PASSWORD"
		mark_changed
	fi

	if [ -z "$(uci -q get "$CONFIG_FILE.$section.database" 2>/dev/null)" ]; then
		uci -q set "$CONFIG_FILE.$section.database=$(default_database_path "$device")"
		mark_changed
	fi

}

process_detected_uplinks() {
	local dump keys key up l3_device proto routes route_key target mask has_default name networks detected_label

	dump="$(ubus call network.interface dump 2>/dev/null)" || return 0
	json_load "$dump" || return 0
	json_select interface || return 0
	json_get_keys keys

	for key in $keys; do
		json_select "$key"
		json_get_var up up

		if [ "$up" != "1" ] && [ "$up" != "true" ]; then
			json_select ..
			continue
		fi

		json_get_var l3_device l3_device
		[ -n "$l3_device" ] || json_get_var l3_device device
		json_get_var proto proto
		json_get_var name interface
		[ -n "$name" ] || name="$key"

		if [ -z "$l3_device" ] || [ "$l3_device" = "lo" ]; then
			json_select ..
			continue
		fi

		if [ "$GLOBAL_EXCLUDE_VPN_UPLINKS" -eq 1 ] && is_vpn_uplink "$l3_device" "$proto"; then
			json_select ..
			continue
		fi

		has_default=0
		if json_select route 2>/dev/null; then
			json_get_keys routes
			for route_key in $routes; do
				json_select "$route_key"
				json_get_var target target
				json_get_var mask mask

				if { [ "$target" = "0.0.0.0" ] || [ "$target" = "::" ]; } && [ "$mask" = "0" ]; then
					has_default=1
				fi

				json_select ..
				[ "$has_default" -eq 1 ] && break
			done
			json_select ..
		fi

		if [ "$has_default" -eq 1 ]; then
			networks="$name"
			detected_label="$(get_label_for_interface "$l3_device" "$networks" "$proto")"
			ensure_relay_section "$l3_device" "$detected_label"
		fi

		json_select ..
	done
}
