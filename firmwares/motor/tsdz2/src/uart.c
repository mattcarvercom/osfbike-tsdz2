/*
 * TongSheng TSDZ2 motor controller firmware/
 *
 * Copyright (C) Casainho, MSpider65 2020.
 *
 * Released under the GPL License, Version 3
 */

#include "uart.h"
#include "stm8s.h"
#include "stm8s_uart2.h"
#include "interrupts.h"
#include "main.h"

extern volatile uint8_t ui8_tx_buffer[UART_TX_BUFFER_LEN];

static volatile uint8_t ui8_tx_index;

void uart2_init(void)
{
    UART2_DeInit();

    // Stock Tongsheng displays (DZ40 etc.) run this link at 9600 baud - the
    // 860C/850C's own UART1 is hardcoded to 19200 (firmwares/display/860C/
    // 860C_850C/src/usart1.c), a fixed property of that display's real
    // firmware, not something this side can negotiate. The
    // ENABLE_860C_LVGL_UART port (main.h/ebike_app.c) changed this link's
    // frame format (CRC16/STX framing) to match the 860C's protocol but
    // never updated the baud rate to match - found 2026-08-24 chasing a
    // "stuck at Connecting to motor" report that survived a TX/RX swap,
    // which a baud mismatch (as opposed to a wiring problem) explains
    // exactly: unsynced garbage regardless of which wire is which.
#if ENABLE_860C_LVGL_UART
    UART2_Init((uint32_t) 19200,
#else
    UART2_Init((uint32_t) 9600,
#endif
            UART2_WORDLENGTH_8D,
            UART2_STOPBITS_1,
            UART2_PARITY_NO,
            UART2_SYNCMODE_CLOCK_DISABLE,
            UART2_MODE_TXRX_ENABLE);

    UART2_ITConfig(UART2_IT_RXNE_OR, ENABLE);
	
	// Set UART2 IRQ priority to level 1 :0=lowest - 3=highest(default value)
    ITC_SetSoftwarePriority(UART2_IRQHANDLER, ITC_PRIORITYLEVEL_2);
    ITC_SetSoftwarePriority(UART2_TX_IRQHANDLER, ITC_PRIORITYLEVEL_1);
}

// Fastest call rate to empty the buffer needs to be above: 9 bytes × 10 bits/byte ÷ 9600 bits/s = ~9.4ms 
void uart2_send_buffer_start(void)
{
    ui8_tx_index = 0;
    UART2_ITConfig(UART2_IT_TXE, ENABLE);
}

INTERRUPT_HANDLER(UART2_TX_IRQHandler, UART2_TX_IRQHANDLER)
{
    if (ui8_tx_index < UART_TX_BUFFER_LEN) {
        UART2_SendData8(ui8_tx_buffer[ui8_tx_index]);
        ui8_tx_index++;
    }
    else {
        UART2_ITConfig(UART2_IT_TXE, DISABLE);
    }
}

int uart_put_char(int c)
{
  //Write a character to the UART2
  UART2_SendData8(c);

  //Loop until the end of transmission
  while (UART2_GetFlagStatus(UART2_FLAG_TXE) == RESET);

  return((unsigned char)c);
}

int uart_get_char(void)
{
  uint8_t c = 0;

  /* Loop until the Read data register flag is SET */
  while (UART2_GetFlagStatus(UART2_FLAG_RXNE) == RESET) ;

  c = UART2_ReceiveData8();

  return (c);
}
