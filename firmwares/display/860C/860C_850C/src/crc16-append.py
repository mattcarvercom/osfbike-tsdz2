#!/usr/bin/env python3
# Appends a 2-byte little-endian CRC16 (Modbus poly 0xA001, init 0xFFFF -
# byte-for-byte the same algorithm as common/src/utils.c's crc16(), just
# batched instead of streamed) to a just-linked main.bin, so
# utils.c's firmware_integrity_check_ok() has something to compare its own
# boot-time recompute against. Must run after objcopy -O binary and before
# the file is treated as "the flashable image" - see the Makefile's
# main.bin target for where this is invoked, and stm32_flash.ld's
# _flash_image_end comment for why appending (rather than patching some
# mid-file slot) is safe here: main.bin's last section with FLASH-resident
# content is .data's load copy, so nothing after this point ever collides
# with real app content, and the UART bootloader protocol
# (uart-flasher.ts's buildBootloaderBlocks()) pads any file length to its
# 2048-byte block size regardless, so 2 extra trailing bytes cost nothing.
import sys


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <main.bin>", file=sys.stderr)
        return 1

    path = sys.argv[1]
    with open(path, "rb") as f:
        image = f.read()

    crc = crc16(image)
    with open(path, "ab") as f:
        f.write(bytes([crc & 0xFF, (crc >> 8) & 0xFF]))

    print(f"crc16-append.py: {path}: {len(image)} bytes, CRC16 0x{crc:04x} appended")
    return 0


if __name__ == "__main__":
    sys.exit(main())
