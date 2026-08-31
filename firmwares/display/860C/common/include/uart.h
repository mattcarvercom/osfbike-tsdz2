#pragma once

#include <stdint.h>

void uart_init(void);
const uint8_t* uart_get_rx_buffer_rdy(void);
uint8_t* uart_get_tx_buffer(void);
void uart_send_tx_buffer(uint8_t *tx_buffer, uint8_t ui8_len);

// 2026-08-28: was 29 - bumped to match the motor's UART_TX_BUFFER_LEN
// (firmwares/motor/tsdz2/src/main.h) after COMM_FRAME_TYPE_PERIODIC grew 6
// bytes (wheel perimeter, battery current max, target max power, battery
// capacity - see that frame's tx_buffer comment in ebike_app.c). The two
// sides must always agree: the motor always sends this many bytes for every
// frame type regardless of its actual payload (uart.c's TX ISR has no
// concept of "short" frames), and usart1.c's RX state machine sizes its own
// scratch buffer and out-of-bounds LEN check off this same constant.
#define UART_NUMBER_DATA_BYTES_TO_RECEIVE       35
#define UART_NUMBER_DATA_BYTES_TO_SEND          88

