/* Linker script to configure memory regions. */

SEARCH_DIR(.)
GROUP(-lgcc -lc -lnosys)

/* FLASH/RAM origin/length hand-evaluated to the USE_WITH_BOOTLOADER branch: this
 * Makefile unconditionally sets USE_WITH_BOOTLOADER = true (never built standalone),
 * and some linker versions can't parse DEFINED() inside a MEMORY-region ternary (same
 * bug as 860C_850C/src/stm32_flash.ld - see 860C_FROM_SOURCE_BUILD.md). Same numeric
 * result either way. */
MEMORY
{
  /* 4k MBR, 104k Softdevice S130, 127k Application Data, 20k Bootloader, 1k Bootloader Settings */
  FLASH (rx)      : ORIGIN = (0x1b000), LENGTH = (256k - 4k - 104k - 20k - 1k)
  /* 11k Softdevice S130 */
  RAM (xrw)       : ORIGIN = (0x20002C00), LENGTH = (32k - 11k)
}

SECTIONS
{
  .fs_data :
  {
    PROVIDE(__start_fs_data = .);
    KEEP(*(.fs_data))
    PROVIDE(__stop_fs_data = .);
  } > RAM
  .pwr_mgmt_data :
  {
    PROVIDE(__start_pwr_mgmt_data = .);
    KEEP(*(.pwr_mgmt_data))
    PROVIDE(__stop_pwr_mgmt_data = .);
  } > RAM
} INSERT AFTER .data;

INCLUDE "nrf5x_common.ld"
