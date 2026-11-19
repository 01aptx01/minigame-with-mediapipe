const SEGMENT_ID = '18538067';
const INFO_ID = '1549a966';
const DURATION_ID = '4489';
const TRACKS_ID = '1654ae6b';
const CLUSTER_ID = '1f43b675';

function readElementIdLength(firstByte: number): number {
  for (let length = 1; length <= 4; length += 1) {
    if (firstByte >= 2 ** (8 - length)) return length;
  }
  return 0;
}

function readElementSize(bytes: Uint8Array, offset: number): {
  length: number;
  value: number;
  unknown: boolean;
} | null {
  const firstByte = bytes[offset];
  if (firstByte === undefined) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (firstByte & marker) === 0) {
    length += 1;
    marker >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;

  let value = firstByte & (marker - 1);
  let unknown = value === marker - 1;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (bytes[offset + index] !== 0xff) unknown = false;
  }
  return { length, value, unknown };
}

function readHex(bytes: Uint8Array, start: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += bytes[start + index].toString(16).padStart(2, '0');
  }
  return result;
}

function encodeElementSize(value: number, preferredLength: number): Uint8Array | null {
  for (let length = preferredLength; length <= 8; length += 1) {
    const marker = 2 ** (8 - length);
    const maxValue = 2 ** (7 * length) - 2;
    if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) continue;
    const encoded = new Uint8Array(length);
    let remainder = value;
    for (let index = length - 1; index >= 0; index -= 1) {
      encoded[index] = remainder % 256;
      remainder = Math.floor(remainder / 256);
    }
    encoded[0] |= marker;
    return encoded;
  }
  return null;
}

function makeDurationElement(durationTicks: number): Uint8Array {
  const element = new Uint8Array(11);
  element[0] = 0x44;
  element[1] = 0x89;
  element[2] = 0x88;
  new DataView(element.buffer).setFloat64(3, durationTicks, false);
  return element;
}

function encodeUnsignedInteger(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remainder = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remainder % 256;
    remainder = Math.floor(remainder / 256);
  }
  return bytes;
}

/**
 * Add a finite WebM Duration element so local recordings expose a useful
 * duration and seek range in players that otherwise report Infinity.
 * If the container is unfamiliar, return the original blob unchanged.
 */
export async function addWebMDurationMetadata(
  blob: Blob,
  durationSeconds: number
): Promise<Blob> {
  if (!blob.type.toLowerCase().includes('webm') || !Number.isFinite(durationSeconds)) return blob;

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 16 || readHex(bytes, 0, 4) !== '1a45dfa3') return blob;
    let segmentStart = -1;
    let segmentSizeOffset = -1;
    let segmentSizeLength = 0;
    let segmentPayloadEnd = bytes.length;
    let infoStart = -1;
    let infoSizeOffset = -1;
    let infoSizeLength = 0;
    let infoPayloadStart = -1;
    let infoPayloadEnd = -1;
    let hasTracks = false;
    let hasCluster = false;

    for (let offset = 0; offset + 4 < bytes.length; ) {
      const idLength = readElementIdLength(bytes[offset]);
      if (idLength < 1 || offset + idLength >= bytes.length) break;
      const id = readHex(bytes, offset, idLength);
      const sizeOffset = offset + idLength;
      const size = readElementSize(bytes, sizeOffset);
      if (!size) break;
      const payloadStart = sizeOffset + size.length;
      const payloadEnd = size.unknown ? bytes.length : payloadStart + size.value;
      if (payloadEnd > bytes.length || payloadEnd < payloadStart) break;

      if (id === SEGMENT_ID) {
        segmentStart = offset;
        segmentSizeOffset = sizeOffset;
        segmentSizeLength = size.length;
        segmentPayloadEnd = payloadEnd;
        let childOffset = payloadStart;
        while (childOffset + 4 < segmentPayloadEnd) {
          const childIdLength = readElementIdLength(bytes[childOffset]);
          if (childIdLength < 1 || childOffset + childIdLength >= segmentPayloadEnd) break;
          const childId = readHex(bytes, childOffset, childIdLength);
          const childSizeOffset = childOffset + childIdLength;
          const childSize = readElementSize(bytes, childSizeOffset);
          if (!childSize) break;
          const childPayloadStart = childSizeOffset + childSize.length;
          const childPayloadEnd = childSize.unknown
            ? segmentPayloadEnd
            : childPayloadStart + childSize.value;
          if (childPayloadEnd > segmentPayloadEnd || childPayloadEnd < childPayloadStart) break;
          if (childId === INFO_ID) {
            if (childSize.unknown) break;
            infoStart = childOffset;
            infoSizeOffset = childSizeOffset;
            infoSizeLength = childSize.length;
            infoPayloadStart = childPayloadStart;
            infoPayloadEnd = childPayloadEnd;
          }
          if (childId === TRACKS_ID) hasTracks = true;
          if (childId === CLUSTER_ID) hasCluster = true;
          if (childSize.unknown || childPayloadEnd === childOffset) break;
          childOffset = childPayloadEnd;
        }
        break;
      }

      if (size.unknown || payloadEnd === offset) break;
      offset = payloadEnd;
    }

    if (
      segmentStart < 0 ||
      infoStart < 0 ||
      infoSizeOffset < 0 ||
      infoPayloadStart < 0 ||
      infoPayloadEnd < infoPayloadStart ||
      !hasTracks ||
      !hasCluster
    ) {
      return blob;
    }

    let timestampScale = 1_000_000;
    for (let offset = infoPayloadStart; offset + 1 < infoPayloadEnd; ) {
      const idLength = readElementIdLength(bytes[offset]);
      if (idLength < 1 || offset + idLength >= infoPayloadEnd) break;
      const id = readHex(bytes, offset, idLength);
      const sizeOffset = offset + idLength;
      const size = readElementSize(bytes, sizeOffset);
      if (!size || size.unknown) break;
      const payloadStart = sizeOffset + size.length;
      const payloadEnd = payloadStart + size.value;
      if (payloadEnd > infoPayloadEnd || payloadEnd < payloadStart) break;

      if (id === '2ad7b1' && size.value >= 1 && size.value <= 6) {
        timestampScale = 0;
        for (let index = payloadStart; index < payloadEnd; index += 1) {
          timestampScale = timestampScale * 256 + bytes[index];
        }
      }
      if (id === DURATION_ID && (size.value === 4 || size.value === 8)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + payloadStart, size.value);
        if (size.value === 8) view.setFloat64(0, durationSeconds * 1_000_000_000 / timestampScale, false);
        else view.setFloat32(0, durationSeconds * 1_000_000_000 / timestampScale, false);
        return new Blob([bytes], { type: blob.type || 'video/webm' });
      }
      offset = payloadEnd;
    }

    const durationElement = makeDurationElement(
      (durationSeconds * 1_000_000_000) / timestampScale
    );
    const newInfoSize = infoPayloadEnd - infoPayloadStart + durationElement.length;
    const newInfoSizeBytes = encodeElementSize(newInfoSize, infoSizeLength);
    if (!newInfoSizeBytes) return blob;
    const infoSizeDelta = newInfoSizeBytes.length - infoSizeLength + durationElement.length;
    const segmentSize = readElementSize(bytes, segmentSizeOffset);
    let newSegmentSizeBytes: Uint8Array | null = null;
    if (segmentSize && !segmentSize.unknown) {
      newSegmentSizeBytes = encodeElementSize(segmentSize.value + infoSizeDelta, segmentSizeLength);
      if (!newSegmentSizeBytes || newSegmentSizeBytes.length !== segmentSizeLength) return blob;
    }

    const result = new Uint8Array(bytes.length + infoSizeDelta);
    const infoHeaderPrefixEnd = infoSizeOffset;
    const oldInfoHeaderEnd = infoPayloadStart;
    result.set(bytes.subarray(0, infoHeaderPrefixEnd), 0);
    let cursor = infoHeaderPrefixEnd;
    result.set(newInfoSizeBytes, cursor);
    cursor += newInfoSizeBytes.length;
    result.set(bytes.subarray(oldInfoHeaderEnd, infoPayloadEnd), cursor);
    cursor += infoPayloadEnd - oldInfoHeaderEnd;
    result.set(durationElement, cursor);
    cursor += durationElement.length;
    result.set(bytes.subarray(infoPayloadEnd), cursor);

    if (newSegmentSizeBytes) {
      result.set(newSegmentSizeBytes, segmentSizeOffset);
    }

    return new Blob([result], { type: blob.type || 'video/webm' });
  } catch {
    return blob;
  }
}
