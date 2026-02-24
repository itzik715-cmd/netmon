"""
Symmetric encryption for credentials stored in the database.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.
The encryption key is derived from settings.SECRET_KEY via HKDF.
"""
import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken
from app.config import settings

# Derive a stable 32-byte Fernet key from the app SECRET_KEY
_raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
_fernet = Fernet(base64.urlsafe_b64encode(_raw))


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns a base64-encoded ciphertext."""
    if not plaintext:
        return plaintext
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a ciphertext string. Returns the original plaintext.
    If decryption fails (e.g. legacy unencrypted value), returns the value as-is."""
    if not ciphertext:
        return ciphertext
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        # Value was stored before encryption was enabled — return as-is
        return ciphertext
