#!/bin/sh

set -e

. /lib/functions.sh

CONFIG_FILE="${1:-moblink-relay-service}"
INTERVAL="${2:-1}"
SYNC_CHANGED=0

sanitize_name() {
	printf '%s' "$1" | sed 's/[^A-Za-z0-9_]/_/g'
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

	current="$(uci -q get "$key" 2>/dev/null || true)"
	if [ "$current" != "$value" ]; then
		uci -q set "$key=$value"
		mark_changed
	fi
}

sync_runtime_status() {
	local section="$1"
	local path raw connected streamer_ip active manual_streamer

	path="$(default_runtime_status_path "$section")"
	active="$(uci -q get "$CONFIG_FILE.$section.active" 2>/dev/null || echo 1)"

	if [ "$active" != "1" ]; then
		uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "inactive"
		uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" ""
		return 0
	fi

	if [ ! -f "$path" ]; then
		uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "waiting for streamer"
		uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" ""
		return 0
	fi

	raw="$(cat "$path" 2>/dev/null || true)"
	connected="$(printf '%s' "$raw" | jsonfilter -e '@.connected' 2>/dev/null || true)"
	streamer_ip="$(printf '%s' "$raw" | jsonfilter -e '@.relays[0].streamer_host' 2>/dev/null || true)"
	manual_streamer="$(printf '%s' "$raw" | jsonfilter -e '@.manual_streamer' 2>/dev/null || true)"

	if [ "$connected" = "true" ] || [ "$connected" = "1" ]; then
		if [ -n "$streamer_ip" ] && [ "$manual_streamer" != "true" ] && [ "$manual_streamer" != "1" ]; then
			if ! ping -c 1 -W 1 "$streamer_ip" >/dev/null 2>&1; then
				uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "waiting for streamer"
				uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" ""
				return 0
			fi
		fi

		if [ -n "$streamer_ip" ]; then
			uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "connected ($streamer_ip)"
			uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" "$streamer_ip"
		else
			uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "connected"
			uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" ""
		fi
	else
		uci_set_if_changed "$CONFIG_FILE.$section.connection_status" "waiting for streamer"
		uci_set_if_changed "$CONFIG_FILE.$section.streamer_ip" ""
	fi
}

while true; do
	SYNC_CHANGED=0
	config_load "$CONFIG_FILE"
	config_foreach sync_runtime_status relay

	if [ "$SYNC_CHANGED" -eq 1 ]; then
		uci -q commit "$CONFIG_FILE"
	fi

	sleep "$INTERVAL"
done
