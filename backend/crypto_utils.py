import base64
import hashlib
import json
import os
import secrets as _secrets
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")


def decrypt_payload(encrypted_data: str) -> dict:
    """
    Decrypt data encrypted by CryptoJS AES.
    CryptoJS uses OpenSSL-compatible format with "Salted__" prefix.
    """
    raw = base64.b64decode(encrypted_data)

    if raw[:8] != b"Salted__":
        raise ValueError("Invalid encrypted data format")

    salt = raw[8:16]
    ciphertext = raw[16:]

    key, iv = _evp_bytes_to_key(ENCRYPTION_KEY.encode(), salt, 32, 16)

    cipher = AES.new(key, AES.MODE_CBC, iv)
    decrypted = unpad(cipher.decrypt(ciphertext), AES.block_size)

    return json.loads(decrypted.decode("utf-8"))


def encrypt_value(plaintext: str) -> str:
    """
    Encrypt a plaintext string for vault storage using AES-256-CBC.
    Returns a base64-encoded string in OpenSSL EVP format (Salted__ prefix).
    """
    salt = _secrets.token_bytes(8)
    key, iv = _evp_bytes_to_key(ENCRYPTION_KEY.encode(), salt, 32, 16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ciphertext = cipher.encrypt(pad(plaintext.encode("utf-8"), AES.block_size))
    raw = b"Salted__" + salt + ciphertext
    return base64.b64encode(raw).decode("utf-8")


def decrypt_value(encrypted_data: str) -> str:
    """
    Decrypt a vault-stored encrypted string.
    Returns the original plaintext.
    """
    raw = base64.b64decode(encrypted_data)
    if raw[:8] != b"Salted__":
        raise ValueError("Invalid encrypted data format")
    salt = raw[8:16]
    ciphertext = raw[16:]
    key, iv = _evp_bytes_to_key(ENCRYPTION_KEY.encode(), salt, 32, 16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    return unpad(cipher.decrypt(ciphertext), AES.block_size).decode("utf-8")


def _evp_bytes_to_key(password: bytes, salt: bytes, key_len: int, iv_len: int):
    """
    OpenSSL EVP_BytesToKey key derivation function.
    Used by CryptoJS for password-based encryption.
    """
    dtot = b""
    d = b""
    while len(dtot) < key_len + iv_len:
        d = hashlib.md5(d + password + salt).digest()
        dtot += d
    return dtot[:key_len], dtot[key_len:key_len + iv_len]
