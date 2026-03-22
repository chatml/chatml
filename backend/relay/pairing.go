package relay

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/url"
	"strings"
)

const (
	// base62Chars is the character set for base62 encoding.
	base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	// tokenLength is the number of base62 characters in a pairing token.
	// 32 base62 characters ≈ 190 bits of entropy.
	tokenLength = 32
)

// GeneratePairingToken generates a cryptographically random base62 token.
func GeneratePairingToken() (string, error) {
	max := big.NewInt(int64(len(base62Chars)))
	var sb strings.Builder
	sb.Grow(tokenLength)

	for i := 0; i < tokenLength; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("crypto/rand failed: %w", err)
		}
		sb.WriteByte(base62Chars[n.Int64()])
	}
	return sb.String(), nil
}

// BuildQRCodeData constructs the data string encoded in the QR code.
// The mobile app scans this and extracts the relay URL and token.
func BuildQRCodeData(token, relayURL string) string {
	return fmt.Sprintf("chatml://pair?token=%s&relay=%s", token, url.QueryEscape(relayURL))
}
