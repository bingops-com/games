package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id with the parameters OWASP recommends (19 MiB, 2 passes, 1 lane).
const (
	argonTime   = 2
	argonMemory = 19 * 1024
	argonLanes  = 1
	argonKeyLen = 32
)

// Hashing takes 19 MiB each time: no more than a few at once.
var hashing = make(chan struct{}, 4)

func hashPassword(password string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	hashing <- struct{}{}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonLanes, argonKeyLen)
	<-hashing
	enc := base64.RawStdEncoding
	return fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonLanes, enc.EncodeToString(salt), enc.EncodeToString(key))
}

// A hash nobody's password matches, compared against when the account does
// not exist so that the answer takes as long either way.
var dummyHash = hashPassword("no account has this password")

func checkPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" {
		return false
	}
	var version int
	var memory, time uint32
	var lanes uint8
	if _, err := fmt.Sscanf(parts[1], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &memory, &time, &lanes); err != nil {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[3])
	want, err2 := enc.DecodeString(parts[4])
	if err1 != nil || err2 != nil {
		return false
	}
	hashing <- struct{}{}
	got := argon2.IDKey([]byte(password), salt, time, memory, lanes, uint32(len(want)))
	<-hashing
	return subtle.ConstantTimeCompare(got, want) == 1
}
