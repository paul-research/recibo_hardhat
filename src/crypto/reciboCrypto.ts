import path from "path";
import fs from "fs";
import { ethers } from "ethers";
import * as encryptPgp from "./encryptPgp";
import * as encryptNone from "./encryptNone";

type CryptoModule = {
  readPubKey?: (file: string) => string;
  cryptoEncrypt: (
    fileOrKey: string | undefined,
    message: string,
  ) => Promise<Uint8Array>;
  cryptoEncryptWithKeystring?: (
    keyString: string,
    message: string,
  ) => Promise<Uint8Array>;
  cryptoDecrypt?: (
    file: string | undefined,
    data: Uint8Array,
    password?: string,
  ) => Promise<string>;
  cryptoDecryptWithKeystring?: (
    key: string,
    data: Uint8Array,
    password?: string,
  ) => Promise<string>;
  genEncryptKeys?: (
    outfile: string,
    password?: string,
    keyLength?: number,
    name?: string,
    email?: string,
  ) => Promise<void>;
};

export class ReciboCrypto {
  static VERSION = "circle-0.2beta";
  static ENCRYPT_PGP = "pgp";
  static NOENCRYPT = "none";

  static getCryptoModule(encryptAlgId: string): CryptoModule {
    if (encryptAlgId === ReciboCrypto.ENCRYPT_PGP) {
      return encryptPgp;
    }
    if (encryptAlgId === ReciboCrypto.NOENCRYPT) {
      return encryptNone;
    }
    throw new Error(
      `Encryption algorithm '${encryptAlgId}' not supported. Valid options are: ${ReciboCrypto.ENCRYPT_PGP}, ${ReciboCrypto.NOENCRYPT}`,
    );
  }

  static async encryptMessage(
    encryptAlgId: string,
    pubKeyFile: string | undefined,
    plaintext: string,
  ): Promise<Uint8Array> {
    const cryptoModule = ReciboCrypto.getCryptoModule(encryptAlgId);
    return cryptoModule.cryptoEncrypt(pubKeyFile, plaintext);
  }

  static async decryptMessage(
    encryptAlgId: string,
    keyFile: string | undefined,
    ciphertext: Uint8Array,
    password?: string,
  ): Promise<string> {
    const cryptoModule = ReciboCrypto.getCryptoModule(encryptAlgId);
    if (!cryptoModule.cryptoDecrypt) {
      throw new Error(`Algorithm ${encryptAlgId} does not support decrypt`);
    }
    return cryptoModule.cryptoDecrypt(keyFile, ciphertext, password);
  }

  static generateEncryptMetadata(options: {
    encryptAlgId?: string;
    mime?: string;
    encryptPubKeyFile?: string;
    responsePubKeyFile?: string;
    responseEncryptAlgId?: string;
  }): string {
    const {
      encryptAlgId,
      mime,
      encryptPubKeyFile,
      responsePubKeyFile,
      responseEncryptAlgId,
    } = options;

    const metadata: Record<string, unknown> = {
      version: ReciboCrypto.VERSION,
      encrypt: encryptAlgId,
    };

    if (mime) {
      metadata.mime = mime;
    }

    if (encryptAlgId && encryptPubKeyFile) {
      const module = ReciboCrypto.getCryptoModule(encryptAlgId);
      if (module.readPubKey) {
        metadata.encrypt_pub_key = module.readPubKey(
          path.resolve(encryptPubKeyFile),
        );
      } else if (fs.existsSync(encryptPubKeyFile)) {
        metadata.encrypt_pub_key = fs.readFileSync(
          encryptPubKeyFile,
          "utf-8",
        );
      }
    }

    if (responseEncryptAlgId) {
      metadata.response_encrypt_alg_id = responseEncryptAlgId;
    }

    if (responsePubKeyFile && responseEncryptAlgId) {
      const module = ReciboCrypto.getCryptoModule(responseEncryptAlgId);
      if (module.readPubKey) {
        metadata.response_pub_key = module.readPubKey(
          path.resolve(responsePubKeyFile),
        );
      } else if (fs.existsSync(responsePubKeyFile)) {
        metadata.response_pub_key = fs.readFileSync(
          responsePubKeyFile,
          "utf-8",
        );
      }
    }

    return JSON.stringify(metadata, null, 2);
  }

  static encodeCiphertext(ciphertext: Uint8Array): Uint8Array {
    return ciphertext;
  }

  static ciphertextToHex(ciphertext: Uint8Array): string {
    return ethers.hexlify(ciphertext);
  }
}

