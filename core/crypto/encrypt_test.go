package crypto

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	tests := []struct {
		name      string
		plaintext string
	}{
		{"simple string", "hello world"},
		{"empty string", ""},
		{"unicode", "Hello, \u4e16\u754c! \U0001f600"},
		{"long string", strings.Repeat("abcdefghij", 1000)},
		{"special chars", "key=value&foo=bar\nnewline\ttab"},
		{"json payload", `{"token":"abc123","refresh":"xyz789"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encrypted, err := Encrypt(tt.plaintext)
			if err != nil {
				t.Fatalf("Encrypt(%q): %v", tt.plaintext, err)
			}

			if encrypted == tt.plaintext && tt.plaintext != "" {
				t.Error("encrypted output should differ from plaintext")
			}

			decrypted, err := Decrypt(encrypted)
			if err != nil {
				t.Fatalf("Decrypt: %v", err)
			}

			if decrypted != tt.plaintext {
				t.Errorf("round-trip mismatch: got %q, want %q", decrypted, tt.plaintext)
			}
		})
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	// Each encryption should use a unique nonce, producing different output.
	plaintext := "same input"
	ct1, err := Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	ct2, err := Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if ct1 == ct2 {
		t.Error("encrypting the same plaintext twice should produce different ciphertexts (unique nonces)")
	}
}

func TestEncryptOutputIsValidBase64(t *testing.T) {
	ct, err := Encrypt("test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base64.StdEncoding.DecodeString(ct); err != nil {
		t.Errorf("encrypted output is not valid base64: %v", err)
	}
}

func TestDecryptInvalidBase64(t *testing.T) {
	_, err := Decrypt("not-valid-base64!!!")
	if err == nil {
		t.Error("expected error for invalid base64 input")
	}
}

func TestDecryptTruncatedCiphertext(t *testing.T) {
	// A valid base64 string but too short to contain a nonce.
	short := base64.StdEncoding.EncodeToString([]byte{0x01, 0x02})
	_, err := Decrypt(short)
	if err == nil {
		t.Error("expected error for truncated ciphertext")
	}
}

func TestDecryptCorruptedCiphertext(t *testing.T) {
	ct, err := Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}

	// Decode, flip a byte, re-encode.
	raw, _ := base64.StdEncoding.DecodeString(ct)
	raw[len(raw)-1] ^= 0xFF
	corrupted := base64.StdEncoding.EncodeToString(raw)

	_, err = Decrypt(corrupted)
	if err == nil {
		t.Error("expected error when decrypting corrupted ciphertext")
	}
}

func TestDeriveKeyDeterministic(t *testing.T) {
	k1, err := deriveKey()
	if err != nil {
		t.Fatal(err)
	}
	k2, err := deriveKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(k1) != 32 {
		t.Errorf("key length: got %d, want 32", len(k1))
	}
	if string(k1) != string(k2) {
		t.Error("deriveKey should return the same key on repeated calls")
	}
}
