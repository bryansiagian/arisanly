package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	accessTTL  = 15 * time.Minute
	refreshTTL = 7 * 24 * time.Hour
	issuer     = "arisanly"
	audience   = "arisanly-api"
)

type accessClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

func signAccess(secret []byte, userID, sessionID string) (string, error) {
	now := time.Now()
	claims := accessClaims{
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: issuer, Subject: userID, Audience: jwt.ClaimStrings{audience},
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(accessTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func parseAccess(secret []byte, raw string) (*accessClaims, error) {
	claims := &accessClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) {
		return secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(issuer),
		jwt.WithAudience(audience), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	if claims.Subject == "" || claims.SessionID == "" {
		return nil, errors.New("missing session claims")
	}
	return claims, nil
}

func newRefresh() (string, []byte, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", nil, err
	}
	raw := base64.RawURLEncoding.EncodeToString(random)
	return raw, refreshHash(raw), nil
}

func refreshHash(raw string) []byte {
	hash := sha256.Sum256([]byte(raw))
	return hash[:]
}
