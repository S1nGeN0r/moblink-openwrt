#!/bin/sh
set -eu
ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
MOBLINK_WATCHDOG_SOURCE_ONLY=1
# shellcheck source=../feed/net/moblink/files/moblink-relay-watchdog.sh
. "$ROOT_DIR/feed/net/moblink/files/moblink-relay-watchdog.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
STATE_DIR="$TEST_DIR/state"
mkdir "$STATE_DIR"
printf '{}\n' > "$TEST_DIR/relay_test.json"
SCHEMA=2
PID=42
LIVE_PID=42
UPDATED=1000
NOW=1000
SIGNALS=0
SIGNAL_OK=1
json_value() {
	case "$2" in
		'@.schema_version') printf '%s' "$SCHEMA" ;;
		'@.process_id') printf '%s' "$PID" ;;
		'@.updated_at') printf '%s' "$UPDATED" ;;
	esac
}
instance_pid() { printf '%s' "$LIVE_PID"; }
now() { printf '%s' "$NOW"; }
log_msg() { :; }
ubus() {
	[ "$SIGNAL_OK" = 1 ] || return 1
	[ "$3" = signal ]
	SIGNALS=$((SIGNALS + 1))
}
check() { check_status_file "$TEST_DIR/relay_test.json"; }
expect_signals() {
	[ "$SIGNALS" = "$1" ] || { printf 'unexpected signals: %s, expected %s\n' "$SIGNALS" "$1"; exit 1; }
}
check
check
expect_signals 0
NOW=1200
SCHEMA=1
check
check
expect_signals 0
SCHEMA=2
UPDATED=''
check
check
expect_signals 0
UPDATED=1000
LIVE_PID=99
check
check
expect_signals 0
LIVE_PID=''
check
expect_signals 0
LIVE_PID=42
check
expect_signals 0
check
expect_signals 1
check
check
expect_signals 1
NOW=1500
UPDATED=1500
check
expect_signals 1
UPDATED=1000
SIGNAL_OK=0
check
check
expect_signals 1
SIGNAL_OK=1
check
check
expect_signals 2
# A replaced process must accumulate its own misses.
NOW=1800
check
PID=43
LIVE_PID=43
check
expect_signals 2
check
expect_signals 3
printf 'relay-watchdog tests passed\n'
