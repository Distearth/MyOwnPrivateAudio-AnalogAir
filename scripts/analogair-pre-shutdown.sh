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

echo "[AnalogAir] Pre-shutdown: Terminating OwnTone and severing all network links..."

# 1. Terminate OwnTone immediately so no AirPlay keep-alives or teardowns are transmitted
systemctl stop owntone.service 2>/dev/null || true
systemctl stop owntone 2>/dev/null || true
pkill -9 owntone 2>/dev/null || true

# 2. Stop Avahi (mDNS / Bonjour) to halt network speaker announcements
systemctl stop avahi-daemon.service 2>/dev/null || true
systemctl stop avahi-daemon 2>/dev/null || true
pkill -9 avahi-daemon 2>/dev/null || true

# 3. Drop all non-loopback outbound traffic via iptables immediately
iptables -I OUTPUT 1 -o lo -j ACCEPT 2>/dev/null || true
iptables -I OUTPUT 2 -j DROP 2>/dev/null || true
ip6tables -I OUTPUT 1 -o lo -j ACCEPT 2>/dev/null || true
ip6tables -I OUTPUT 2 -j DROP 2>/dev/null || true

# 4. Bring down all physical and wireless network interfaces (Ethernet & Wi-Fi)
for dev_path in /sys/class/net/*; do
    [ -e "$dev_path" ] || continue
    dev=$(basename "$dev_path")
    if [ "$dev" != "lo" ]; then
        ip link set "$dev" down 2>/dev/null || true
    fi
done

# 5. Stop NetworkManager and wireless supplicants
systemctl stop NetworkManager 2>/dev/null || true
systemctl stop wpa_supplicant 2>/dev/null || true

exit 0
