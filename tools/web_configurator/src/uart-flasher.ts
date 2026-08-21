// Flashes 860C/850C display firmware over its UART bootloader - the real,
// hardware-verified flashing path for these displays (their SWD pins aren't
// practically reachable without opening a sealed case; see
// ../../UNIVERSAL_FIRMWARE_PLAN.md's "Open / ongoing" section). Reached
// through the display's normal 5-pin motor-controller connector via a
// generic USB-UART adapter (uart-transport.ts), not the ST-Link/SWD path
// display-flasher.ts uses for SW102.
//
// Protocol reimplemented from the reverse-engineered spec (logic-analyzer
// capture + disassembly, verified byte-exact against a real flashed image
// and confirmed end-to-end on real hardware including NAK/retry) rather than
// from any single reference tool's source - see the "Block format" and
// "Implementing a flasher" sections of that spec for the facts this is
// built from. No vendored code: this is a from-scratch reimplementation of a
// documented wire protocol, in this project's own style.

type LogFn = (line: string) => void;

// Protocol constants - see the spec's "Block format" table. BASE is an
// address-FIELD value the bootloader remaps by +0x1000 to get the real
// flash address (field 0x08004000 -> physical 0x08005000, where the app
// actually runs); this also happens to be the bootloader's own write-
// protection floor, so BASE must stay exactly this value - "correcting" it
// to the physical address shifts the image and bricks the boot.
const ADDRESS_FIELD_BASE = 0x08004000;
const BLOCK_PAYLOAD_SIZE = 2048;
const ADDRESS_FIELD_STRIDE = 0x800;
const TERMINATOR_BLOCK_COUNT = 2;

const MAGIC_DATA = 0xf0;
const MAGIC_LAST_DATA = 0xf1;
const MAGIC_TERMINATOR = 0xf2;

const SYNC_BYTE = 0x5a;
const READY_BYTE = 0xa5;
const ACK_BYTE = 0x85;
const NAK_BYTE = 0x8f;

const READY_POLL_INTERVAL_MS = 31;
const READY_TIMEOUT_MS = 60_000;
const BLOCK_ACK_TIMEOUT_MS = 2_000;
const BLOCK_RETRY_LIMIT = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One 2060-byte block: magic(2) | addressField_be32(4) | payload(2048) | checksum_be32(4) | CRLF(2). */
export function buildBootloaderBlock(magic: number, addressField: number, payload: Uint8Array): Uint8Array {
  if (payload.length !== BLOCK_PAYLOAD_SIZE) {
    throw new Error(`Bootloader block payload must be exactly ${BLOCK_PAYLOAD_SIZE} bytes, got ${payload.length}`);
  }

  const block = new Uint8Array(2 + 4 + BLOCK_PAYLOAD_SIZE + 4 + 2);
  const view = new DataView(block.buffer);

  block[0] = magic;
  block[1] = magic;
  view.setUint32(2, addressField >>> 0, false);
  block.set(payload, 6);

  let checksum = 0;
  for (const byte of payload) checksum = (checksum + byte) >>> 0;
  view.setUint32(6 + BLOCK_PAYLOAD_SIZE, checksum, false);

  block[6 + BLOCK_PAYLOAD_SIZE + 4] = 0x0d;
  block[6 + BLOCK_PAYLOAD_SIZE + 5] = 0x0a;
  return block;
}

/** Splits firmware bytes into the full block sequence (data blocks + terminators), ready to send in order. */
export function buildBootloaderBlocks(firmware: Uint8Array): Uint8Array[] {
  const blockCount = Math.ceil(firmware.length / BLOCK_PAYLOAD_SIZE) || 1;
  const blocks: Uint8Array[] = [];

  for (let i = 0; i < blockCount; i++) {
    const payload = new Uint8Array(BLOCK_PAYLOAD_SIZE);
    payload.set(firmware.subarray(i * BLOCK_PAYLOAD_SIZE, (i + 1) * BLOCK_PAYLOAD_SIZE));
    const magic = i === blockCount - 1 ? MAGIC_LAST_DATA : MAGIC_DATA;
    blocks.push(buildBootloaderBlock(magic, ADDRESS_FIELD_BASE + i * ADDRESS_FIELD_STRIDE, payload));
  }

  for (let i = 0; i < TERMINATOR_BLOCK_COUNT; i++) {
    blocks.push(buildBootloaderBlock(MAGIC_TERMINATOR, 0, new Uint8Array(BLOCK_PAYLOAD_SIZE)));
  }

  return blocks;
}

/**
 * Continuously drains a SerialPort's readable side into a FIFO byte queue,
 * so callers can poll for a specific response byte with a timeout without
 * ever leaving a reader.read() call permanently outstanding (Web Serial
 * offers no built-in read timeout, and a reader only tolerates one
 * in-flight read() at a time).
 */
class SerialByteQueue {
  private readonly queue: number[] = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly pumpDone: Promise<void>;
  private stopped = false;

  constructor(port: SerialPort) {
    if (!port.readable) throw new Error("Serial port has no readable stream - is it still open?");
    this.reader = port.readable.getReader();
    this.pumpDone = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.stopped) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const byte of value) this.queue.push(byte);
      }
    } catch {
      // Port closed/disconnected mid-read - the pump just stops; waitForByte()
      // callers will time out rather than hang.
    }
  }

  /** Resolves with the next byte containing `wanted` among a batch of bytes read together (mirrors the protocol's "look for this byte anywhere in what just arrived" ACK/NAK detection), or null on timeout. */
  async waitForAnyByte(wanted: readonly number[], timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.queue.findIndex((b) => wanted.includes(b));
      if (hit !== -1) return this.queue.splice(0, hit + 1).pop()!;
      await sleep(5);
    }
    return null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      await this.reader.cancel();
    } catch {
      // Already closed/errored - nothing left to cancel.
    }
    await this.pumpDone.catch(() => {});
    this.reader.releaseLock();
  }
}

async function writeBlock(writer: WritableStreamDefaultWriter<Uint8Array>, block: Uint8Array): Promise<void> {
  await writer.write(block);
}

/**
 * Flashes raw 860C/850C firmware bytes (the prebuilt `.bin`, not an Intel
 * HEX - the bootloader protocol has its own fixed addressing scheme, so
 * there's no address-record parsing to get wrong) over an already-open
 * UART adapter connection. Returns the number of firmware bytes sent on
 * success; throws on handshake timeout or exhausted block retries.
 */
export async function flashUartBin(port: SerialPort, firmware: Uint8Array, onLog: LogFn): Promise<number> {
  if (!port.writable) throw new Error("Serial port has no writable stream - is it still open?");
  const writer = port.writable.getWriter();
  const reader = new SerialByteQueue(port);

  try {
    onLog("Waiting for display ready (power on the display now)…");
    const readyDeadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < readyDeadline) {
      await writer.write(new Uint8Array([SYNC_BYTE]));
      if ((await reader.waitForAnyByte([READY_BYTE], READY_POLL_INTERVAL_MS)) === READY_BYTE) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      throw new Error("Timed out waiting for the display's bootloader ready byte - power it on and try again.");
    }
    onLog("Display ready. Sending firmware…");

    const blocks = buildBootloaderBlocks(firmware);
    const dataBlockCount = blocks.length - TERMINATOR_BLOCK_COUNT;

    for (let i = 0; i < dataBlockCount; i++) {
      let acked = false;
      for (let attempt = 1; attempt <= BLOCK_RETRY_LIMIT && !acked; attempt++) {
        await writeBlock(writer, blocks[i]);
        const response = await reader.waitForAnyByte([ACK_BYTE, NAK_BYTE], BLOCK_ACK_TIMEOUT_MS);
        if (response === ACK_BYTE) {
          acked = true;
        } else if (attempt < BLOCK_RETRY_LIMIT) {
          onLog(
            `Block ${i + 1}/${dataBlockCount}: ${response === NAK_BYTE ? "NAK" : "no response"}, retrying (${attempt}/${BLOCK_RETRY_LIMIT})…`,
          );
        }
      }
      if (!acked) {
        throw new Error(`Display did not ACK block ${i + 1}/${dataBlockCount} after ${BLOCK_RETRY_LIMIT} attempts.`);
      }
      onLog(`Block ${i + 1}/${dataBlockCount} ACKed.`);
    }

    onLog("Sending end-of-transfer terminators…");
    for (let i = dataBlockCount; i < blocks.length; i++) {
      await writeBlock(writer, blocks[i]);
    }

    return firmware.length;
  } finally {
    await reader.stop();
    writer.releaseLock();
  }
}
