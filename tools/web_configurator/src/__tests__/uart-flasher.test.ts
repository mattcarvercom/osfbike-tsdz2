import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBootloaderBlock, buildBootloaderBlocks } from "../uart-flasher.ts";

function readU32BE(block: Uint8Array, offset: number): number {
  return new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(offset, false);
}

test("buildBootloaderBlock: lays out magic/address/payload/checksum/CRLF at the documented offsets", () => {
  const payload = new Uint8Array(2048);
  payload[0] = 0x01;
  payload[1] = 0x02;
  payload[2047] = 0xff;

  const block = buildBootloaderBlock(0xf0, 0x08004000, payload);

  assert.equal(block.length, 2060);
  assert.deepEqual([...block.slice(0, 2)], [0xf0, 0xf0]);
  assert.equal(readU32BE(block, 2), 0x08004000);
  assert.deepEqual(block.slice(6, 2054), payload);
  assert.equal(readU32BE(block, 2054), 0x01 + 0x02 + 0xff); // big-endian sum of the 2048 payload bytes
  assert.deepEqual([...block.slice(2058, 2060)], [0x0d, 0x0a]);
});

test("buildBootloaderBlock: rejects a payload that isn't exactly 2048 bytes", () => {
  assert.throws(() => buildBootloaderBlock(0xf0, 0x08004000, new Uint8Array(100)), /2048 bytes/);
});

test("buildBootloaderBlocks: single-block firmware gets F1F1 (last data), zero-padded, plus 2 terminators", () => {
  const firmware = new Uint8Array(10).fill(0xaa);
  const blocks = buildBootloaderBlocks(firmware);

  assert.equal(blocks.length, 3); // 1 data block + 2 terminators
  assert.deepEqual([...blocks[0].slice(0, 2)], [0xf1, 0xf1]);
  assert.equal(readU32BE(blocks[0], 2), 0x08004000);
  assert.deepEqual([...blocks[0].slice(6, 16)], new Array(10).fill(0xaa));
  assert.deepEqual([...blocks[0].slice(16, 2054)], new Array(2038).fill(0)); // zero-padded tail

  for (const term of blocks.slice(1)) {
    assert.deepEqual([...term.slice(0, 2)], [0xf2, 0xf2]);
    assert.equal(readU32BE(term, 2), 0); // terminator address field is 0
    assert.equal(readU32BE(term, 2054), 0); // zero payload -> zero checksum
  }
});

test("buildBootloaderBlocks: multi-block firmware - F0F0 for every block but the last, address field steps by 0x800 per block", () => {
  const firmware = new Uint8Array(2048 * 3 + 5).fill(0x11); // 3 full blocks + a partial 4th
  const blocks = buildBootloaderBlocks(firmware);

  assert.equal(blocks.length, 4 + 2); // 4 data blocks + 2 terminators
  assert.deepEqual([...blocks[0].slice(0, 2)], [0xf0, 0xf0]);
  assert.deepEqual([...blocks[1].slice(0, 2)], [0xf0, 0xf0]);
  assert.deepEqual([...blocks[2].slice(0, 2)], [0xf0, 0xf0]);
  assert.deepEqual([...blocks[3].slice(0, 2)], [0xf1, 0xf1]); // only the final data block

  assert.equal(readU32BE(blocks[0], 2), 0x08004000);
  assert.equal(readU32BE(blocks[1], 2), 0x08004000 + 0x800);
  assert.equal(readU32BE(blocks[2], 2), 0x08004000 + 2 * 0x800);
  assert.equal(readU32BE(blocks[3], 2), 0x08004000 + 3 * 0x800);
});
