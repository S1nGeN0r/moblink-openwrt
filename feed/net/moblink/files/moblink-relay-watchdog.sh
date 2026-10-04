#!/bin/sh

STATUS_DIR=/tmp/moblink-relay-status
SERVICE_NAME=moblink-relay-service
INTERVAL="${MOBLINK_WATCHDOG_INTERVAL:-30}"
MISS_LIMIT="${MOBLINK_WATCHDOG_MISS_LIMIT:-2}"
STALE_AFTER="${MOBLINK_WATCHDOG_STALE_AFTER:-120}"
RESTART_THROTTLE="${MOBLINK_WATCHDOG_RESTART_THROTTLE:-180}"
STATE_DIR=/tmp/moblink-relay-watchdog

log_msg() {
	logger -t moblink-relay-watchdog "$*"
}

now() {
	date +%s
}

json_value() {
	jsonfilter -q -i "$1" -e "$2" 2>/dev/null
}

instance_pid() {
	local service running pid
	service="$(ubus call service list "{\"name\":\"$SERVICE_NAME\"}" 2>/dev/null)" || return 1
	running="$(jsonfilter -q -s "$service" -e "@[\"$SERVICE_NAME\"].instances[\"$1\"].running" 2>/dev/null)"
	[ "$running" = true ] || return 1
	pid="$(jsonfilter -q -s "$service" -e "@[\"$SERVICE_NAME\"].instances[\"$1\"].pid" 2>/dev/null)"
	case "$pid" in ''|*[!0-9]*) return 1 ;; esac
	[ "$pid" -gt 0 ] || return 1
	printf '%s' "$pid"
}

restart_relay_instance() {
	local instance="$1" pid="$2" current last restart_file
	[ "$(instance_pid "$instance")" = "$pid" ] || return 0
	restart_file="$STATE_DIR/$instance.last_restart"
	current="$(now)"
	last="$(cat "$restart_file" 2>/dev/null || echo 0)"
	[ $((current - last)) -ge "$RESTART_THROTTLE" ] || return 0
	if ubus call service signal "{\"name\":\"$SERVICE_NAME\",\"instance\":\"$instance\",\"signal\":15}" >/dev/null 2>&1; then
		printf '%s\n' "$current" > "$restart_file"
		log_msg "restarting $instance: runtime heartbeat stalled (pid $pid)"
	fi
}

check_status_file() {
	local file="$1" name pid updated schema current miss_file previous_pid misses
	name="${file##*/}"
	name="${name%.json}"
	case "$name" in ''|*[!A-Za-z0-9_]*) return 0 ;; esac
	miss_file="$STATE_DIR/$name.misses"
	[ -s "$file" ] || { rm -f "$miss_file"; return 0; }
	schema="$(json_value "$file" '@.schema_version')"
	pid="$(json_value "$file" '@.process_id')"
	updated="$(json_value "$file" '@.updated_at')"
	case "$pid:$updated" in *[!0-9:]*|:*|*:) rm -f "$miss_file"; return 0 ;; esac
	# Unknown telemetry never justifies a restart. Rust handles WebSocket recovery.
	if [ "$schema" != 2 ] || [ "$pid" -le 0 ] || [ "$updated" -le 0 ] ||
		[ "$(instance_pid "$name")" != "$pid" ]; then
		rm -f "$miss_file"
		return 0
	fi
	current="$(now)"
	if [ $((current - updated)) -lt "$STALE_AFTER" ]; then
		rm -f "$miss_file"
		return 0
	fi
	previous_pid=0
	misses=0
	if [ -f "$miss_file" ]; then
		read -r previous_pid misses < "$miss_file"
	fi
	[ "$previous_pid" = "$pid" ] || misses=0
	misses=$((misses + 1))
	printf '%s %s\n' "$pid" "$misses" > "$miss_file"
	if [ "$misses" -ge "$MISS_LIMIT" ]; then
		rm -f "$miss_file"
		restart_relay_instance "$name" "$pid"
	fi
}

main() {
	mkdir -p "$STATE_DIR"
	while true; do
		for file in "$STATUS_DIR"/*.json; do
			[ -e "$file" ] || continue
			check_status_file "$file"
		done
		sleep "$INTERVAL"
	done
}

[ "${MOBLINK_WATCHDOG_SOURCE_ONLY:-0}" = 1 ] || main
