import * as openpgp from "openpgp";
import fs from "fs";

export function readPubKey(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export function readKeyFile(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export async function cryptoEncrypt(
  pubKeyPath: string | undefined,
  message: string,
): Promise<Uint8Array> {
  if (!pubKeyPath) {
    throw new Error("PGP encryption requires --encryptPubKeyfile");
  }
  return cryptoEncryptWithKeystring(readPubKey(pubKeyPath), message);
}

export async function cryptoEncryptWithKeystring(
  pubkeyString: string,
  message: string,
): Promise<Uint8Array> {
  const publicKey = await openpgp.readKey({ armoredKey: pubkeyString });
  const pgpMessage = await openpgp.createMessage({ text: message });
  const encrypted = await openpgp.encrypt({
    message: pgpMessage,
    encryptionKeys: publicKey,
  });
  return Buffer.from(encrypted, "utf-8");
}

export async function cryptoDecrypt(
  keyfilePath: string | undefined,
  encrypted: Uint8Array,
  password?: string,
): Promise<string> {
  if (!keyfilePath) {
    throw new Error("PGP decryption requires private key file");
  }
  return cryptoDecryptWithKeystring(
    fs.readFileSync(keyfilePath, "utf-8"),
    encrypted,
    password,
  );
}

export async function cryptoDecryptWithKeystring(
  keyString: string,
  encrypted: Uint8Array,
  password?: string,
): Promise<string> {
  const privateKey = await openpgp.readKey({ armoredKey: keyString });
  let decryptedKey = privateKey;
  if (password) {
    decryptedKey = await openpgp.decryptKey({
      privateKey,
      passphrase: password,
    });
  }

  const message = await openpgp.readMessage({
    armoredMessage: Buffer.from(encrypted).toString("utf-8"),
  });

  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: decryptedKey,
  });

  return typeof data === "string" ? data : data.toString();
}

export async function genEncryptKeys(
  outfile: string,
  password?: string,
  keyLength = 3072,
  name = "",
  email = "no email",
): Promise<void> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "rsa",
    rsaBits: keyLength,
    userIDs: [{ name, email }],
    passphrase: password,
  });

  const dir = outfile.includes("/")
    ? outfile.substring(0, outfile.lastIndexOf("/"))
    : "";
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(`${outfile}_key.asc`, privateKey, "utf-8");
  fs.writeFileSync(`${outfile}_pub.asc`, publicKey, "utf-8");
}

