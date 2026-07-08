#!/bin/sh

STATUS_DIR=/tmp/moblink-relay-status
SERVICE_NAME=moblink-relay-service
INTERVAL="${MOBLINK_WATCHDOG_INTERVAL:-30}"
MISS_LIMIT="${MOBLINK_WATCHDOG_MISS_LIMIT:-2}"
RESTART_THROTTLE="${MOBLINK_WATCHDOG_RESTART_THROTTLE:-180}"
STATE_DIR=/tmp/moblink-relay-watchdog

mkdir -p "$STATE_DIR"

log_msg() {
	logger -t moblink-relay-watchdog "$*"
}

now() {
	date +%s
}

json_value() {
	local file="$1"
	local expr="$2"

	jsonfilter -q -i "$file" -e "$expr" 2>/dev/null
}

has_streamer_connection() {
	local host="$1"

	[ -n "$host" ] || return 1

	awk -v host="$host" '
		$0 !~ /(^| )tcp( |$)/ || $0 !~ /ESTABLISHED/ { next }
		!has_host($0, host) { next }
		{ found = 1; exit }
		END { exit found ? 0 : 1 }
		function has_host(line, host, token_count, tokens, i) {
			token_count = split(line, tokens, /[[:space:]]+/)
			for (i = 1; i <= token_count; i++) {
				if (tokens[i] == "src=" host || tokens[i] == "dst=" host) {
					return 1
				}
			}
			return 0
		}
	' /proc/net/nf_conntrack 2>/dev/null && return 0

	awk -v host="$host" '
		$0 !~ /(^| )tcp( |$)/ || $0 !~ /ESTABLISHED/ { next }
		!has_host($0, host) { next }
		{ found = 1; exit }
		END { exit found ? 0 : 1 }
		function has_host(line, host, token_count, tokens, i) {
			token_count = split(line, tokens, /[[:space:]]+/)
			for (i = 1; i <= token_count; i++) {
				if (tokens[i] == "src=" host || tokens[i] == "dst=" host) {
					return 1
				}
			}
			return 0
		}
	' /proc/net/ip_conntrack 2>/dev/null
}

restart_relay_instance() {
	local instance="$1"
	local current last restart_file

	[ -n "$instance" ] || return 0

	restart_file="$STATE_DIR/$instance.last_restart"
	current="$(now)"
	last="$(cat "$restart_file" 2>/dev/null || echo 0)"

	if [ $((current - last)) -lt "$RESTART_THROTTLE" ]; then
		return 0
	fi

	echo "$current" > "$restart_file"
	log_msg "restarting stale relay instance $instance"
	ubus call service signal "{\"name\":\"$SERVICE_NAME\",\"instance\":\"$instance\",\"signal\":15}" >/dev/null 2>&1 || true
}

check_status_file() {
	local file="$1"
	local name connected host miss_file misses

	[ -s "$file" ] || return 0

	name="${file##*/}"
	name="${name%.json}"
	connected="$(json_value "$file" '@.connected')"
	host="$(json_value "$file" '@.relays[0].streamer_host')"
	[ -n "$host" ] || host="$(json_value "$file" '@.streamers[0].host')"
	miss_file="$STATE_DIR/$name.misses"

	if [ "$connected" != "true" ] || [ -z "$host" ]; then
		rm -f "$miss_file"
		return 0
	fi

	if has_streamer_connection "$host"; then
		rm -f "$miss_file"
		return 0
	fi

	misses="$(cat "$miss_file" 2>/dev/null || echo 0)"
	misses=$((misses + 1))
	echo "$misses" > "$miss_file"

	if [ "$misses" -ge "$MISS_LIMIT" ]; then
		log_msg "$name reports connected streamer $host, but no established TCP conntrack entry exists"
		rm -f "$miss_file"
		restart_relay_instance "$name"
	fi
}

while true; do
	for file in "$STATUS_DIR"/*.json; do
		[ -e "$file" ] || continue
		check_status_file "$file"
	done

	sleep "$INTERVAL"
done
