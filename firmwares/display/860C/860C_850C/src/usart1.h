/*
 * Bafang LCD 860C/850C firmware
 *
 * Copyright (C) Casainho, 2018, 2019, 2020
 *
 * Released under the GPL License, Version 3
 */

#ifndef _USART1_H_
#define _USART1_H_

#include "stdio.h"
#include "stdint.h"

void usart1_init(void);
/* Total bytes received since boot (see usart1.c) - surfaced on the boot
 * screen as a live "is the motor sending anything?" counter. */
extern volatile uint32_t ui32_usart1_rx_byte_count;
uint8_t* usart1_get_rx_buffer(void);
uint8_t usart1_received_package(void);
void usart1_reset_received_package(void);
void usart1_send_byte_and_block(uint8_t ui8_byte);
void usart1_start_dma_transfer(uint8_t ui8_len);

#endif
