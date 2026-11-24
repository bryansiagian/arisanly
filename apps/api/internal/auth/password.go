package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Keep the parameters in the encoded hash so existing hashes can be identified
// if the work factor changes in a future release.
const passwordProfile = "$argon2id$v=19$m=19456,t=2,p=1$"

func derivePassword(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 2, 19*1024, 1, 32)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	encoding := base64.RawStdEncoding
	return passwordProfile + encoding.EncodeToString(salt) + "$" + encoding.EncodeToString(derivePassword(password, salt)), nil
}

func verifyPassword(password, encoded string) (bool, error) {
	data, ok := strings.CutPrefix(encoded, passwordProfile)
	if !ok {
		return false, errors.New("unknown password hash profile")
	}
	parts := strings.Split(data, "$")
	if len(parts) != 2 {
		return false, errors.New("invalid password hash")
	}
	salt, saltErr := base64.RawStdEncoding.DecodeString(parts[0])
	hash, hashErr := base64.RawStdEncoding.DecodeString(parts[1])
	if saltErr != nil || hashErr != nil || len(salt) != 16 || len(hash) != 32 {
		return false, errors.New("invalid password hash data")
	}
	return subtle.ConstantTimeCompare(derivePassword(password, salt), hash) == 1, nil
}
