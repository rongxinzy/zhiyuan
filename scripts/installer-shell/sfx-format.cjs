'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SETUP_BYTES = 450 * 1024 * 1024;

function inspectSetup(file) {
  const size = fs.statSync(file).size;
  if (size < 36 || size > MAX_SETUP_BYTES) throw new Error('Invalid setup size');
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(2);
    fs.readSync(descriptor, header, 0, 2, 0);
    if (header.toString('ascii') !== 'MZ') throw new Error('Setup is not a Windows executable');
    const footer = Buffer.alloc(12);
    fs.readSync(descriptor, footer, 0, 12, size - 12);
    if (footer.toString('ascii', 8) !== 'ZYP1') throw new Error('Missing setup payload footer');
    const payloadBytes = Number(footer.readBigUInt64LE(0));
    const shellBytes = size - 12 - payloadBytes;
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 22 || shellBytes < 2) {
      throw new Error('Invalid setup payload length');
    }
    const dosHeader = Buffer.alloc(64);
    if (shellBytes < 64) throw new Error('Truncated Windows executable header');
    fs.readSync(descriptor, dosHeader, 0, 64, 0);
    const peOffset = dosHeader.readUInt32LE(60);
    if (peOffset < 64 || peOffset + 6 > shellBytes) throw new Error('Invalid PE header boundary');
    const peHeader = Buffer.alloc(6);
    fs.readSync(descriptor, peHeader, 0, 6, peOffset);
    if (peHeader.readUInt32LE(0) !== 0x4550 || peHeader.readUInt16LE(4) !== 0x8664) {
      throw new Error('Setup must be a Windows x64 PE executable');
    }
    fs.readSync(descriptor, header, 0, 2, shellBytes);
    if (header.toString('ascii') !== 'PK') throw new Error('Setup payload is not a ZIP archive');
    return {
      kind: 'webview2-single-file-setup',
      architecture: 'x64',
      installerBytes: size,
      shellBytes,
      payloadBytes,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendPayload(shell, zip, output) {
  if ([shell, zip].some(file => path.resolve(file) === path.resolve(output))) {
    throw new Error('Setup output must not overwrite its inputs');
  }
  const payloadBytes = fs.statSync(zip).size;
  if (fs.statSync(shell).size + payloadBytes + 12 > MAX_SETUP_BYTES) {
    throw new Error('Final setup exceeds the 450 MiB installer budget');
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.copyFileSync(shell, output);
  const input = fs.openSync(zip, 'r');
  const target = fs.openSync(output, 'a');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(input, chunk, 0, chunk.length, null)) > 0) {
      fs.writeSync(target, chunk, 0, count);
    }
    const footer = Buffer.alloc(12);
    footer.writeBigUInt64LE(BigInt(payloadBytes));
    footer.write('ZYP1', 8, 'ascii');
    fs.writeSync(target, footer);
  } finally {
    fs.closeSync(input);
    fs.closeSync(target);
  }
  return inspectSetup(output);
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0)
      hash.update(chunk.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { MAX_SETUP_BYTES, inspectSetup, appendPayload, hashFile };
