#!/bin/bash
# ==============================================================================
# AnalogAir - Pre-Shutdown Network Killer & Speaker Protection
# /usr/local/bin/analogair-pre-shutdown.sh
#
# Prevents OwnTone from reconnecting to AirPlay speakers or causing AVR receivers
# to wake up and switch active inputs when the Raspberry Pi shuts down or reboots.
# ==============================================================================

# Guard against duplicate concurrent execution
PIDFILE="/tmp/analogair-pre-shutdown.pid"
if [ -f "$PIDFILE" ]; then
    exit 0
fi
touch "$PIDFILE" 2>/dev/null || true

# 0. Cleanly deselect all OwnTone outputs and stop player via localhost API
# This ensures OwnTone's SQLite database (/var/cache/owntone/songs3.db) records selected=0 for all speakers
curl -s -X PUT http://127.0.0.1:3689/api/player/stop --connect-timeout 1 --max-time 1 2>/dev/null || true
OUTPUTS_JSON=$(curl -s http://127.0.0.1:3689/api/outputs --connect-timeout 1 --max-time 2 2>/dev/null || echo "")
if [ -n "$OUTPUTS_JSON" ]; then
    for oid in $(echo "$OUTPUTS_JSON" | grep -o '"id":[0-9]*' | cut -d: -f2); do
        curl -s -X PUT -H "Content-Type: application/json" -d '{"selected":false}' "http://127.0.0.1:3689/api/outputs/$oid" --connect-timeout 1 --max-time 1 2>/dev/null || true
    done
fi
rm -f /tmp/analogair_last_speakers.json /tmp/analogair_web_resync 2>/dev/null || true
for db in /home/*/.config/analogair/settings.db /root/.config/analogair/settings.db; do
    if [ -f "$db" ]; then
        sqlite3 "$db" "DROP TABLE IF EXISTS last_active_speakers;" 2>/dev/null || true
    fi
done

# 1. Drop all non-loopback outbound traffic via iptables immediately
# Prevents any packet from reaching AirPlay speakers, AVRs, or the LAN
iptables -I OUTPUT 1 -o lo -j ACCEPT 2>/dev/null || true
iptables -I OUTPUT 2 -j DROP 2>/dev/null || true
ip6tables -I OUTPUT 1 -o lo -j ACCEPT 2>/dev/null || true
ip6tables -I OUTPUT 2 -j DROP 2>/dev/null || true

# 2. Bring down all physical and wireless network interfaces (Ethernet & Wi-Fi)
for dev_path in /sys/class/net/*; do
    [ -e "$dev_path" ] || continue
    dev=$(basename "$dev_path")
    if [ "$dev" != "lo" ]; then
        ip link set "$dev" down 2>/dev/null || true
    fi
done

# 3. Stop network connection managers immediately
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop wpa_supplicant 2>/dev/null || true
systemctl stop systemd-networkd 2>/dev/null || true
systemctl stop dhcpcd 2>/dev/null || true

# 4. Terminate AnalogAir background processes to kill any auto-reconnect loops
pkill -9 -f "analogair_daemon.py" 2>/dev/null || true
pkill -9 -f "analogair_capture.py" 2>/dev/null || true
pkill -9 -f "arecord" 2>/dev/null || true
pkill -9 -f "ffmpeg" 2>/dev/null || true

# Also attempt user service stops across active sessions
for u in $(who | awk '{print $1}' | sort -u); do
    uid=$(id -u "$u" 2>/dev/null)
    if [ -n "$uid" ]; then
        XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user stop analogair-daemon.service analogair-capture.service 2>/dev/null || true
    fi
done

# 5. Terminate OwnTone immediately with network already dead (no teardown packets can escape)
systemctl stop owntone.service 2>/dev/null || true
systemctl stop owntone 2>/dev/null || true
pkill -9 owntone 2>/dev/null || true

# 6. Stop Avahi (mDNS / Bonjour) to halt network announcements
systemctl stop avahi-daemon.service 2>/dev/null || true
systemctl stop avahi-daemon 2>/dev/null || true
pkill -9 avahi-daemon 2>/dev/null || true

exit 0
