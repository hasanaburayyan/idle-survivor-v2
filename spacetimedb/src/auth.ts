import { sha256 } from '@noble/hashes/sha2';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const SCRYPT_N = 1 << 13;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const HASH_BYTES = 32;

export function deriveSalt(
  senderHex: string,
  timestampMicros: bigint,
  normalizedUsername: string
): string {
  const material =
    senderHex + ':' + timestampMicros.toString() + ':' + normalizedUsername;
  return bytesToHex(sha256(utf8ToBytes(material)));
}

export function hashPassword(password: string, saltHex: string): string {
  const saltBytes = utf8ToBytes(saltHex);
  const pwBytes = utf8ToBytes(password);
  const out = scrypt(pwBytes, saltBytes, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: HASH_BYTES,
  });
  return bytesToHex(out);
}
