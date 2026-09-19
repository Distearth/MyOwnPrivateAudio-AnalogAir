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

echo "[AnalogAir] Pre-shutdown: Severing all network links FIRST to prevent speaker reconnect..."

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
