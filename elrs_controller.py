import serial
import struct
import time
from dataclasses import dataclass, field
from typing import Optional

# --- CRSF Protocol Constants ---
CRSF_SYNC = 0xC8

# Frame types
CRSF_TYPE_GPS = 0x02
CRSF_TYPE_VARIO = 0x07
CRSF_TYPE_BATTERY_SENSOR = 0x08
CRSF_TYPE_BARO_ALT = 0x09
CRSF_TYPE_LINK_STATS = 0x14
CRSF_TYPE_RC_CHANNELS = 0x16
CRSF_TYPE_ATTITUDE = 0x1E
CRSF_TYPE_FLIGHT_MODE = 0x21

CRSF_ADDR_BROADCAST = 0x00
CRSF_ADDR_FLIGHT_CONTROLLER = 0xC8

ELRS_BAUDRATE = 420000

INVERTED_SIGNAL = False


@dataclass
class LinkStats:
    uplink_rssi_1: int = 0       # dBm * -1
    uplink_rssi_2: int = 0
    uplink_link_quality: int = 0  # 0-100%
    uplink_snr: int = 0          # dB
    active_antenna: int = 0
    rf_mode: int = 0
    uplink_tx_power: int = 0     # dBm
    downlink_rssi: int = 0
    downlink_link_quality: int = 0
    downlink_snr: int = 0


@dataclass
class Battery:
    voltage: float = 0.0   # Volts
    current: float = 0.0   # Amps
    capacity: int = 0      # mAh drawn
    remaining: int = 0     # 0-100%


@dataclass
class GPS:
    latitude: float = 0.0
    longitude: float = 0.0
    groundspeed: float = 0.0   # km/h
    heading: float = 0.0       # degrees
    altitude: int = 0          # m
    satellites: int = 0


@dataclass
class Attitude:
    roll: float = 0.0   # degrees
    pitch: float = 0.0  # degrees
    yaw: float = 0.0    # degrees


@dataclass
class Telemetry:
    link: Optional[LinkStats] = None
    battery: Optional[Battery] = None
    gps: Optional[GPS] = None
    attitude: Optional[Attitude] = None
    flight_mode: str = ""


def crc8_dvb_s2(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = (crc << 1) ^ 0xD5
            else:
                crc <<= 1
            crc &= 0xFF
    return crc


def parse_link_stats(data: bytes) -> LinkStats:
    return LinkStats(
        uplink_rssi_1=data[0],
        uplink_rssi_2=data[1],
        uplink_link_quality=data[2],
        uplink_snr=data[3] - 128,  # signed
        active_antenna=data[4],
        rf_mode=data[5],
        uplink_tx_power=data[6],
        downlink_rssi=data[7],
        downlink_link_quality=data[8],
        downlink_snr=data[9] - 128,
    )


def parse_battery(data: bytes) -> Battery:
    voltage = struct.unpack_from('>H', data, 0)[0] / 10.0
    current = struct.unpack_from('>H', data, 2)[0] / 10.0
    capacity = struct.unpack_from('>I', data, 4)[0] >> 8
    remaining = data[7]
    return Battery(voltage=voltage, current=current, capacity=capacity, remaining=remaining)


def parse_attitude(data: bytes) -> Attitude:
    roll = struct.unpack_from('>h', data, 0)[0] / 10000.0 * (180 / 3.14159265)
    pitch = struct.unpack_from('>h', data, 2)[0] / 10000.0 * (180 / 3.14159265)
    yaw = struct.unpack_from('>h', data, 4)[0] / 10000.0 * (180 / 3.14159265)
    return Attitude(roll=roll, pitch=pitch, yaw=yaw)


def parse_gps(data: bytes) -> GPS:
    lat = struct.unpack_from('>i', data, 0)[0] / 1e7
    lon = struct.unpack_from('>i', data, 4)[0] / 1e7
    speed = struct.unpack_from('>H', data, 8)[0] / 10.0
    heading = struct.unpack_from('>H', data, 10)[0] / 100.0
    alt = struct.unpack_from('>H', data, 12)[0] - 1000
    sats = data[14]
    return GPS(lat, lon, speed, heading, alt, sats)


def parse_telemetry(frame_type: int, data: bytes) -> Telemetry:
    t = Telemetry()
    if frame_type == CRSF_TYPE_LINK_STATS and len(data) >= 10:
        t.link = parse_link_stats(data)
    elif frame_type == CRSF_TYPE_BATTERY_SENSOR and len(data) >= 8:
        t.battery = parse_battery(data)
    elif frame_type == CRSF_TYPE_GPS and len(data) >= 15:
        t.gps = parse_gps(data)
    elif frame_type == CRSF_TYPE_ATTITUDE and len(data) >= 6:
        t.attitude = parse_attitude(data)
    elif frame_type == CRSF_TYPE_FLIGHT_MODE:
        t.flight_mode = data.rstrip(b'\x00').decode('utf-8', errors='replace')
    return t


class ELRSController:
    """
    Combined TX + Telemetry interface.
    Connect PC -> ELRS TX module via UART (JR bay pins or USB-UART).
    Sends RC channels, reads telemetry back.
    """

    def __init__(self, port: str, baudrate: int = ELRS_BAUDRATE):
        self.serial = serial.Serial(port, baudrate, timeout=0.0)
        self.channels = [992] * 16
        self.telemetry = Telemetry()

    def set_channel(self, ch: int, value: int):
        if 500 < value < 2500:
            value = int((value - 880) * (1811 - 172) / (2160 - 880) + 172)
        self.channels[ch] = max(172, min(1811, value))

    def set_channels_all(self, values: list):
        for i, v in enumerate(values[:16]):
            self.set_channel(i, v)

    def build_rc_packet(self) -> bytes:
        payload = bytearray(22)
        for i, ch_val in enumerate(self.channels):
            bit_pos = i * 11
            byte_idx = bit_pos // 8
            bit_shift = bit_pos % 8
            val = ch_val & 0x7FF

            existing = int.from_bytes(payload[byte_idx:byte_idx + 3], 'little')
            existing |= val << bit_shift
            payload[byte_idx:byte_idx + 3] = existing.to_bytes(3, 'little')

        pkt_type_and_payload = bytes([CRSF_TYPE_RC_CHANNELS]) + bytes(payload)
        frame = bytes([CRSF_SYNC, len(pkt_type_and_payload)]) + pkt_type_and_payload
        frame += bytes([crc8_dvb_s2(pkt_type_and_payload)])
        return frame

    def send_channels(self):
        packet = self.build_rc_packet()
        if INVERTED_SIGNAL:
            packet = bytes(b ^ 0xFF for b in packet)
        self.serial.write(packet)

    def read_telemetry(self) -> bool:
        """Read pending telemetry frames. Returns True if any frame was read."""
        got_any = False
        while self.serial.in_waiting > 0:
            byte = self.serial.read(1)[0]
            if byte != CRSF_SYNC:
                continue
            length = self.serial.read(1)[0]
            if length < 2 or length > 64:
                continue
            payload = self.serial.read(length)
            if len(payload) < length:
                break

            if crc8_dvb_s2(payload[:-1]) != payload[-1]:
                continue

            frame_type = payload[0]
            data = payload[1:-1]
            t = parse_telemetry(frame_type, data)

            if t.link is not None:
                self.telemetry.link = t.link
                got_any = True
            if t.battery is not None:
                self.telemetry.battery = t.battery
                got_any = True
            if t.gps is not None:
                self.telemetry.gps = t.gps
                got_any = True
            if t.attitude is not None:
                self.telemetry.attitude = t.attitude
                got_any = True
            if t.flight_mode:
                self.telemetry.flight_mode = t.flight_mode
                got_any = True
        return got_any

    def close(self):
        self.serial.close()


class ELRSReceiver:
    """Read RC channels from ELRS RX via UART (CRSF output from receiver)."""

    def __init__(self, port: str, baudrate: int = ELRS_BAUDRATE):
        self.serial = serial.Serial(port, baudrate, timeout=0.5)
        self.channels = [1500] * 16

    def update(self) -> bool:
        if self.serial.in_waiting < 4:
            return False
        byte = self.serial.read(1)[0]
        if byte != CRSF_SYNC:
            return False
        length = self.serial.read(1)[0]
        if length < 2:
            return False
        payload = self.serial.read(length)
        if len(payload) < length:
            return False
        if crc8_dvb_s2(payload[:-1]) != payload[-1]:
            return False

        frame_type = payload[0]
        data = payload[1:-1]
        if frame_type == CRSF_TYPE_RC_CHANNELS and len(data) >= 22:
            for i in range(16):
                bit_offset = i * 11
                byte_offset = bit_offset // 8
                bit_shift = bit_offset % 8
                raw = int.from_bytes(data[byte_offset:byte_offset + 3], 'little')
                self.channels[i] = (raw >> bit_shift) & 0x7FF
            return True
        return False

    @property
    def channels_us(self) -> list:
        return [int(880 + (v - 172) * (2160 - 880) / (1811 - 172)) for v in self.channels]

    def close(self):
        self.serial.close()


# ============== Usage Example ==============

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ELRS PC Controller with Telemetry")
    parser.add_argument("--port", default="COM3", help="Serial port")
    parser.add_argument("--mode", choices=["tx", "rx"], default="tx",
                        help="tx = control robot + read telemetry, rx = read channels from receiver")
    args = parser.parse_args()

    if args.mode == "tx":
        ctrl = ELRSController(args.port)
        print(f"ELRS TX connected on {args.port}")
        print("Sending RC + reading telemetry...\n")

        ctrl.set_channel(0, 1500)  # Roll
        ctrl.set_channel(1, 1500)  # Pitch
        ctrl.set_channel(2, 1200)  # Throttle
        ctrl.set_channel(3, 1500)  # Yaw
        ctrl.set_channel(4, 1000)  # ARM (AUX1)
        ctrl.set_channel(5, 1500)  # AUX2

        last_print = time.time()
        try:
            while True:
                ctrl.send_channels()
                ctrl.read_telemetry()

                if time.time() - last_print > 0.5:
                    t = ctrl.telemetry
                    parts = []
                    if t.link:
                        parts.append(
                            f"RSSI={-t.link.uplink_rssi_1}dBm  "
                            f"SNR={t.link.uplink_snr}dB  "
                            f"LQ={t.link.uplink_link_quality}%  "
                            f"TxPwr={t.link.uplink_tx_power}dBm"
                        )
                    if t.battery:
                        parts.append(
                            f"BAT={t.battery.voltage:.1f}V  "
                            f"{t.battery.current:.1f}A  "
                            f"{t.battery.capacity}mAh  "
                            f"{t.battery.remaining}%"
                        )
                    if t.gps and t.gps.satellites > 0:
                        parts.append(
                            f"GPS={t.gps.latitude:.5f},{t.gps.longitude:.5f}  "
                            f"{t.gps.groundspeed:.0f}km/h  "
                            f"{t.gps.altitude}m  "
                            f"{t.gps.satellites}sats"
                        )
                    if t.attitude:
                        parts.append(
                            f"ATT R={t.attitude.roll:.1f} P={t.attitude.pitch:.1f} Y={t.attitude.yaw:.1f}"
                        )
                    if t.flight_mode:
                        parts.append(f"MODE={t.flight_mode}")

                    print(" | ".join(parts) if parts else "(waiting for telemetry...)")
                    last_print = time.time()

                time.sleep(0.004)  # ~250 Hz

        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            ctrl.close()

    else:
        rx = ELRSReceiver(args.port)
        print(f"ELRS RX connected on {args.port}")
        print("Reading channels...")
        try:
            while True:
                if rx.update():
                    us = rx.channels_us
                    print(f"Ch: {us[0]:4d} {us[1]:4d} {us[2]:4d} {us[3]:4d} | "
                          f"AUX: {us[4]:4d} {us[5]:4d} {us[6]:4d} {us[7]:4d}")
        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            rx.close()
