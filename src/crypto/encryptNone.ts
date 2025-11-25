import { ethers } from "ethers";

export function readPubKey(_path: string): string {
  return "";
}

export async function cryptoEncrypt(
  _pubKeyPath: string | undefined,
  message: string,
): Promise<Uint8Array> {
  return ethers.toUtf8Bytes(message);
}

export async function cryptoEncryptWithKeystring(
  _key: string,
  message: string,
): Promise<Uint8Array> {
  return ethers.toUtf8Bytes(message);
}

export async function cryptoDecrypt(
  _keyfilePath: string | undefined,
  encrypted: Uint8Array,
  _password?: string,
): Promise<string> {
  return ethers.toUtf8String(encrypted);
}

export async function cryptoDecryptWithKeystring(
  _key: string,
  encrypted: Uint8Array,
  _password?: string,
): Promise<string> {
  return ethers.toUtf8String(encrypted);
}

export async function genEncryptKeys(
  outfile: string,
  _password?: string,
): Promise<void> {
  // no key generation for plain text; create placeholder files
  const fs = await import("fs");
  fs.writeFileSync(`${outfile}_key.asc`, "");
  fs.writeFileSync(`${outfile}_pub.asc`, "");
}

