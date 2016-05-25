#!/bin/bash

[ -e `dirname $0`/../global/global.inc.sh ] && . `dirname $0`/../global/global.inc.sh

USB_ID_WLAN0="1-1.3"
STATUS_FILE=/home/pi/raspicam-timelapse/config/last_status.inc.sh
CONFIG_FILE=/home/pi/raspicam-timelapse/config/check-network.conf
SAVE_VARIABLE_PREFIX=STATUS_

do_reboot() {
    log "Rebooting"
    sync
    /bin/systemctl reboot
}

usb_reset() {
    log "Reinitialize USB WiFi Stick"
    echo $USB_ID_WLAN0 > /sys/bus/usb/drivers/usb/unbind
    modprobe -rv 8192cu
    sleep 5s
    modprobe -v 8192cu
    sleep 5s
    echo $USB_ID_WLAN0 > /sys/bus/usb/drivers/usb/bind
    sleep 2s
}

dhcpd_restart() {
    /bin/systemctl restart dhcpcd
}

network_stop() {
    log "Stopping Network"
    /bin/systemctl daemon-reload
    /bin/systemctl stop networking.service
    /bin/systemctl stop dhcpcd
    pkill wpa_supplicant
    pkill dhcpcd
}

network_start() {
    log "Starting Network"
    /bin/systemctl start dhcpcd
    /bin/systemctl start networking.service
}

print_current_network_status() {
    log "Output of: ip addr"
    ip addr

    log "Output of: ip route"
    ip route

    log "Output of: ip -6 route"
    ip -6 route

    log "Output of: iwconfig wlan0"
    iwconfig wlan0

    log "Output of: iwlist wlan0 scanning | grep SSID"
    iwlist wlan0 scanning | grep SSID
}

check_modulo() {
    local counter=$1
    local limit=$2
    [ $counter -gt 0 ] && (( $counter % $limit == 0 ))
}

# Locking
[ -e `dirname $0`/../global/bash-locking.inc.sh ] && . `dirname $0`/../global/bash-locking.inc.sh

#### 
logrotate

exec >> $LOG
exec 2>> $LOG

DEFAULT_GATEWAY_V4=$(ip -4 route show default | awk '/^default/ {print $3}')
DEFAULT_GATEWAY_V6=$(ip -6 route show default | awk '/^default/ {print $3"%"$5}')

IPV4_PING_DEST=$DEFAULT_GATEWAY_V4
IPV6_PING_DEST=$DEFAULT_GATEWAY_V6

IPV4_ENABLED=0
IPV6_ENABLED=0

PING_LIMIT_1=5
PING_LIMIT_2=10
PING_LIMIT_3=60
PING_LIMIT_4=70

# load config file
if [ -e $CONFIG_FILE ]
then
    . $CONFIG_FILE
fi

# load status file
if [ -e $STATUS_FILE ]
then
    . $STATUS_FILE
fi

# reboot detection:
CURRENT_STATUS_UPTIME=$(cut -d"." -f1 /proc/uptime)

if [ -z $STATUS_UPTIME ] || [ $CURRENT_STATUS_UPTIME -lt $STATUS_UPTIME ]; then
    STATUS_FAILED_V4=0
    STATUS_FAILED_V6=0
fi

STATUS_UPTIME=$CURRENT_STATUS_UPTIME

# save variables to file which start with $SAVE_VARIABLE_PREFIX
trap 'save_variables > $STATUS_FILE' EXIT

# v6
if [ $IPV6_ENABLED -eq 0 ]; then
    # set it to zero for easier error conditions
    STATUS_FAILED_V6=0
else
    if [ "$IPV6_PING_DEST" != "" ] && ping6 -c5 -q $IPV6_PING_DEST > /dev/null; then
        STATUS_FAILED_V6=0
    else
        STATUS_FAILED_V6=$(( ${STATUS_FAILED_V6:-0} + 1 ))
    fi
    
    if [ "$STATUS_FAILED_V6" -eq 0 ]; then
        log "Ping v6 $IPV6_PING_DEST: OK"
    else
        log "Ping v6 ${IPV6_PING_DEST:-no v6 address to ping}: ERROR"
    fi
fi
# v4
if [ $IPV4_ENABLED -eq 0 ]; then
    # set it to zero for easier error conditions
    STATUS_FAILED_V4=0
else
    if [ "$IPV4_PING_DEST" != "" ] && ping -c5 -q $IPV4_PING_DEST > /dev/null; then
        STATUS_FAILED_V4=0
    else
        STATUS_FAILED_V4=$(( ${STATUS_FAILED_V4:-0} + 1 ))
    fi
    
    if [ "$STATUS_FAILED_V4" -eq 0 ]; then
        log "Ping v4 $IPV4_PING_DEST: OK"
    else
        log "Ping v4 ${IPV4_PING_DEST:-no v4 address to ping}: ERROR"
    fi
fi

if [ $IPV4_ENABLED -eq 1 ] || [ $IPV6_ENABLED -eq 1 ]; then
    if [ $IPV6_ENABLED -eq 1 ] && check_modulo $STATUS_FAILED_V6 $PING_LIMIT_4; then
        log "exiting with error code for watchdog"
        exit 1
    elif [ $IPV6_ENABLED -eq 1 ] && check_modulo $STATUS_FAILED_V6 $PING_LIMIT_3; then
        print_current_network_status
        do_reboot
    elif [ $IPV6_ENABLED -eq 0 ] && [ $IPV4_ENABLED -eq 1 ] && check_modulo $STATUS_FAILED_V4 $PING_LIMIT_3; then
        print_current_network_status
        do_reboot
    elif check_modulo $STATUS_FAILED_V4 $PING_LIMIT_1 && [ $IPV6_ENABLED -eq 1 ] && [ $STATUS_FAILED_V6 -eq 0 ]; then
        print_current_network_status
        dhcpd_restart
    elif check_modulo $STATUS_FAILED_V4 $PING_LIMIT_1 || 
        check_modulo $STATUS_FAILED_V6 $PING_LIMIT_1; then
        print_current_network_status
        network_stop
        if check_modulo $STATUS_FAILED_V6 $PING_LIMIT_2 || ([ $IPV6_ENABLED -eq 0 ] && check_modulo $STATUS_FAILED_V4 $PING_LIMIT_2 ); then
            usb_reset
        fi
        network_start
    fi
fi

exit 0
