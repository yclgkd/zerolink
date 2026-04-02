package service

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
)

const (
	fileEnvelopeFixedBytes = int64(8)
	fileHeaderMaxBytes     = int64(16 * 1024)
	aesGCMTagBytes         = int64(16)
	aesPadLengthBytes      = int64(4)
)

func (input LockCommitInput) Validate() error {
	if !isValidUUID(input.UUID) {
		return badRequest("invalid uuid")
	}
	if !isBase64URL(input.LockChallengeID) {
		return badRequest("invalid lockChallengeId")
	}
	if !isLowerHex(input.LockProof, 64) {
		return badRequest("invalid lockProof")
	}
	if !input.ReceiverPubJWK.Valid() {
		return badRequest("invalid receiverPubJwk")
	}
	if !isLowerHex(input.ReceiverPubFpr, 64) {
		return badRequest("invalid receiverPubFpr")
	}
	if input.LockedAt < 0 {
		return badRequest("invalid lockedAt")
	}
	return nil
}

func (input CompoundCommitInput) Validate() error {
	if !isValidUUID(input.UUID) {
		return badRequest("invalid uuid")
	}
	if !isLowerHex(input.IntentHash, 64) {
		return badRequest("invalid intentHash")
	}
	if err := input.Intent.Validate(); err != nil {
		return err
	}
	assertionProvided := input.Assertion != nil
	softkeyProvided := input.SoftkeySignature != ""

	switch {
	case assertionProvided:
		if input.AdminMode != "" || softkeyProvided {
			return badRequest("invalid compound commit payload")
		}
		if !input.Assertion.Valid() {
			return badRequest("invalid assertion")
		}
	case softkeyProvided:
		if input.AdminMode != string(store.AdminModePassword) && input.AdminMode != string(store.AdminModeSoftkey) {
			return badRequest("invalid compound commit payload")
		}
		if !isLowerHex(input.SoftkeySignature, 0) {
			return badRequest("invalid softkeySignature")
		}
	case input.AdminMode != "":
		return badRequest("invalid compound commit payload")
	default:
		return badRequest("invalid compound commit payload")
	}
	return nil
}

func (intent ManageIntent) Validate() error {
	if intent.Op != "update" && intent.Op != "delete" {
		return badRequest("invalid intent")
	}
	if !isValidUUID(intent.UUID) {
		return badRequest("invalid intent")
	}
	if intent.Version < 0 || intent.Timestamp < 0 {
		return badRequest("invalid intent")
	}
	if !isBase64URL(intent.Nonce) || len(intent.Nonce) < 22 {
		return badRequest("invalid intent")
	}

	switch intent.Op {
	case "update":
		if len(intent.ExpireAt) == 0 {
			return badRequest("invalid intent")
		}
		if intent.PayloadKind != "" && intent.PayloadKind != "text" && intent.PayloadKind != "file" {
			return badRequest("invalid intent")
		}
		if !isLowerHex(intent.ReceiverPubFpr, 64) {
			return badRequest("invalid intent")
		}
		if (intent.CipherBundle == nil) == (intent.FileRef == nil) {
			return badRequest("invalid intent")
		}
		if intent.CipherBundle != nil && !intent.CipherBundle.Valid() {
			return badRequest("invalid intent")
		}
		if intent.FileRef != nil {
			if err := validateMultipartFileRef(*intent.FileRef); err != nil {
				return badRequest("invalid intent")
			}
			if intent.PayloadKind != "file" {
				return badRequest("invalid intent")
			}
		}
		if _, err := intent.ParseExpireAt(); err != nil {
			return badRequest("invalid intent")
		}
	case "delete":
		if len(intent.ExpireAt) > 0 {
			if _, err := intent.ParseExpireAt(); err != nil {
				return badRequest("invalid intent")
			}
		}
	}

	return nil
}

func (intent ManageIntent) ComputeHash() (string, error) {
	canonicalJSON, err := json.Marshal(intent.CanonicalValue())
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonicalJSON)
	return hex.EncodeToString(sum[:]), nil
}

func (intent ManageIntent) CanonicalValue() map[string]any {
	switch intent.Op {
	case "update":
		expireAt, _ := intent.ParseExpireAt()
		payload := map[string]any{
			"op":             intent.Op,
			"uuid":           intent.UUID,
			"version":        intent.Version,
			"timestamp":      intent.Timestamp,
			"nonce":          intent.Nonce,
			"receiverPubFpr": intent.ReceiverPubFpr,
			"expireAt":       nullableInt64ToAny(expireAt),
		}
		if intent.PayloadKind != "" {
			payload["payloadKind"] = intent.PayloadKind
		}
		if intent.CipherBundle != nil {
			payload["cipherBundle"] = map[string]any{
				"ciphertext":     intent.CipherBundle.Ciphertext,
				"iv":             intent.CipherBundle.IV,
				"aad":            intent.CipherBundle.AAD,
				"encContentKey":  intent.CipherBundle.EncContentKey,
				"ciphertextHash": intent.CipherBundle.CiphertextHash,
				"padBlock":       intent.CipherBundle.PadBlock,
			}
		}
		if intent.FileRef != nil {
			payload["fileRef"] = intent.FileRef
		}
		return payload
	default:
		return map[string]any{
			"op":        intent.Op,
			"uuid":      intent.UUID,
			"version":   intent.Version,
			"timestamp": intent.Timestamp,
			"nonce":     intent.Nonce,
		}
	}
}

func (intent ManageIntent) ParseExpireAt() (*int64, error) {
	if len(intent.ExpireAt) == 0 || string(intent.ExpireAt) == "null" {
		return nil, nil
	}
	var value int64
	if err := json.Unmarshal(intent.ExpireAt, &value); err != nil {
		return nil, err
	}
	if value < 0 {
		return nil, errors.New("invalid expireAt")
	}
	return &value, nil
}

func (bundle CipherBundle) Valid() bool {
	return isBase64URL(bundle.Ciphertext) &&
		isBase64URL(bundle.IV) &&
		isBase64URL(bundle.AAD) &&
		isBase64URL(bundle.EncContentKey) &&
		isLowerHex(bundle.CiphertextHash, 64) &&
		bundle.PadBlock > 0 &&
		bundle.PadBlock <= padBlockMax
}

func validateMultipartFileRef(fileRef filestore.MultipartFileRef) error {
	if err := fileRef.Validate(); err != nil {
		return err
	}
	if fileRef.StorageBackend != filestore.FileStorageBackendMinIO {
		return fmt.Errorf("unsupported storage backend %q", fileRef.StorageBackend)
	}
	return nil
}

func (a AssertionJSON) Valid() bool {
	if a.Type != "public-key" {
		return false
	}
	if !isBase64URL(a.ID) || !isBase64URL(a.RawID) {
		return false
	}
	if !isBase64URL(a.Response.ClientDataJSON) ||
		!isBase64URL(a.Response.AuthenticatorData) ||
		!isBase64URL(a.Response.Signature) {
		return false
	}
	return a.Response.UserHandle == nil || *a.Response.UserHandle == "" || isBase64URL(*a.Response.UserHandle)
}

func (j RSAPublicKeyJWK) Valid() bool {
	if j.KTY != "RSA" || j.ALG != "RSA-OAEP-256" || !j.Ext {
		return false
	}
	if !isBase64URL(j.N) || !isBase64URL(j.E) {
		return false
	}
	return len(j.KeyOps) == 1 && j.KeyOps[0] == "encrypt"
}

func validateDeliveryChannel(channel *store.Channel, receiverPubFpr string) error {
	if channel.State != store.ChannelStateLocked && channel.State != store.ChannelStateDelivered {
		return lockForbidden("delivery transition requires locked or delivered state")
	}
	if channel.ReceiverPubFpr == nil {
		return lockForbidden("delivery requires a locked receiver identity")
	}
	if !constantTimeEqualString(receiverPubFpr, *channel.ReceiverPubFpr) {
		return lockForbidden("intent receiverPubFpr does not match locked receiver fingerprint")
	}
	return nil
}

func parseFutureExpireAt(intent ManageIntent, now time.Time) (*int64, error) {
	expireAt, err := intent.ParseExpireAt()
	if err != nil {
		return nil, badRequest("invalid intent")
	}
	if expireAt != nil && *expireAt <= now.UnixMilli() {
		return nil, timestampOutOfRange("expireAt must be a future timestamp")
	}
	return expireAt, nil
}

func validateCipherBundle(
	bundle CipherBundle,
	intent ManageIntent,
	receiverPubFpr string,
	maxFileBytes int64,
) error {
	ciphertextBytes, err := base64.RawURLEncoding.DecodeString(bundle.Ciphertext)
	if err != nil {
		return cipherBundleInvalid("cipherBundle.ciphertext is not valid base64url")
	}

	cipherHash := sha256.Sum256(ciphertextBytes)
	if !constantTimeEqualString(hex.EncodeToString(cipherHash[:]), bundle.CiphertextHash) {
		return cipherBundleInvalid("cipherBundle.ciphertextHash does not match ciphertext")
	}

	expectedAAD := encodeBase64URL([]byte(fmt.Sprintf("%s||%d||%s", intent.UUID, intent.Version, receiverPubFpr)))
	if !constantTimeEqualString(expectedAAD, bundle.AAD) {
		return cipherBundleInvalid("cipherBundle.aad does not match the expected binding")
	}

	if intent.PayloadKind == "file" {
		maxCiphertextBytes := resolveMaxFileCiphertextBytes(maxFileBytes, bundle.PadBlock)
		if int64(len(ciphertextBytes)) > maxCiphertextBytes {
			return cipherBundleInvalid("cipherBundle.ciphertext exceeds the configured inline file limit")
		}
	}

	return nil
}

func resolveMaxFileCiphertextBytes(maxFileBytes int64, padBlock int64) int64 {
	maxPlaintextBytes := maxFileBytes + fileEnvelopeFixedBytes + fileHeaderMaxBytes
	paddedPlaintextBytes := ((aesPadLengthBytes + maxPlaintextBytes + padBlock - 1) / padBlock) * padBlock
	return paddedPlaintextBytes + aesGCMTagBytes
}

func buildStoredUpdateDeliveryProofJSON(adminMode store.AdminMode, input CompoundCommitInput) (json.RawMessage, error) {
	meta := map[string]any{
		"version":   input.Intent.Version,
		"timestamp": input.Intent.Timestamp,
		"nonce":     input.Intent.Nonce,
		"expireAt":  nullableInt64ToAny(mustParseExpireAt(input.Intent)),
	}
	if input.Intent.PayloadKind != "" {
		meta["payloadKind"] = input.Intent.PayloadKind
	}

	var payload map[string]any
	if adminMode == store.AdminModeWebAuthn {
		if input.Assertion == nil {
			return nil, errors.New("assertion required for webauthn delivery proof")
		}
		payload = map[string]any{
			"adminMode": "webauthn",
			"meta":      meta,
			"proof": map[string]any{
				"clientDataJSON":    input.Assertion.Response.ClientDataJSON,
				"authenticatorData": input.Assertion.Response.AuthenticatorData,
				"signature":         input.Assertion.Response.Signature,
			},
		}
	} else {
		payload = map[string]any{
			"adminMode": string(adminMode),
			"meta":      meta,
			"proof": map[string]any{
				"softkeySignature": input.SoftkeySignature,
			},
		}
	}

	return json.Marshal(payload)
}

func buildDecryptFetchDeliveryAuthJSON(channel *store.Channel) (json.RawMessage, error) {
	var proof map[string]any
	if err := json.Unmarshal(channel.UpdateDeliveryProof, &proof); err != nil {
		return nil, err
	}

	adminMode, _ := proof["adminMode"].(string)
	meta, _ := proof["meta"].(map[string]any)
	detachedProof, _ := proof["proof"].(map[string]any)

	if adminMode == "webauthn" {
		credential, err := decodeStoredWebAuthnCredential(channel.AdminCredential)
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{
			"adminMode": adminMode,
			"meta":      meta,
			"signer": map[string]any{
				"credentialId": credential.CredentialID,
				"publicKey":    credential.PublicKey,
			},
			"proof": detachedProof,
		})
	}

	credential, err := decodeStoredSoftkeyCredential(channel.AdminCredential)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"adminMode": adminMode,
		"meta":      meta,
		"signer": map[string]any{
			"softkeyPubJwk": credential.SoftkeyPubJWK,
		},
		"proof": detachedProof,
	})
}

func computeExpectedCompoundChallengeBytes(
	uuid string,
	intentHash string,
	challenge *store.ActiveChallenge,
	op string,
) ([]byte, error) {
	challengeIDBytes, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeID)
	if err != nil {
		return nil, err
	}
	challengeSeedBytes, err := base64.RawURLEncoding.DecodeString(*challenge.ChallengeSeed)
	if err != nil {
		return nil, err
	}

	if op == "update" {
		chunks := make([]byte, 0, len("GL-delivery-proof")+len(uuid)+len(intentHash))
		chunks = append(chunks, []byte("GL-delivery-proof")...)
		chunks = append(chunks, []byte(uuid)...)
		chunks = append(chunks, []byte(intentHash)...)
		sum := sha256.Sum256(chunks)
		return sum[:], nil
	}

	chunks := make([]byte, 0, len("GLv2.5")+len(uuid)+len(challengeIDBytes)+len(intentHash)+len(challengeSeedBytes))
	chunks = append(chunks, []byte("GLv2.5")...)
	chunks = append(chunks, []byte(uuid)...)
	chunks = append(chunks, challengeIDBytes...)
	chunks = append(chunks, []byte(intentHash)...)
	chunks = append(chunks, challengeSeedBytes...)
	sum := sha256.Sum256(chunks)
	return sum[:], nil
}

func computeLockProof(uuid string, challengeID string, challengeValue string, lockKey string) (string, error) {
	challengeIDBytes, err := base64.RawURLEncoding.DecodeString(challengeID)
	if err != nil {
		return "", err
	}
	challengeValueBytes, err := base64.RawURLEncoding.DecodeString(challengeValue)
	if err != nil {
		return "", err
	}
	lockKeyBytes, err := base64.RawURLEncoding.DecodeString(lockKey)
	if err != nil {
		return "", err
	}

	chunks := make([]byte, 0, len("GL-lock")+len(uuid)+len(challengeIDBytes)+len(challengeValueBytes)+len(lockKeyBytes))
	chunks = append(chunks, []byte("GL-lock")...)
	chunks = append(chunks, []byte(uuid)...)
	chunks = append(chunks, challengeIDBytes...)
	chunks = append(chunks, challengeValueBytes...)
	chunks = append(chunks, lockKeyBytes...)
	sum := sha256.Sum256(chunks)
	return hex.EncodeToString(sum[:]), nil
}

func computeReceiverFingerprint(jwk RSAPublicKeyJWK) (string, error) {
	modulusBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return "", err
	}
	exponentBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return "", err
	}

	exponent := 0
	for _, value := range exponentBytes {
		exponent = (exponent << 8) | int(value)
	}
	if exponent == 0 {
		return "", errors.New("invalid exponent")
	}

	publicKey := &rsa.PublicKey{N: new(big.Int).SetBytes(modulusBytes), E: exponent}
	spkiBytes, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(spkiBytes)
	return hex.EncodeToString(sum[:]), nil
}

func verifySoftkeySignature(jwk ECDSAPublicKeyJWK, payload []byte, signatureHex string) error {
	if !jwk.Valid() {
		return errors.New("invalid softkey public key")
	}
	if len(signatureHex) != 128 || !isLowerHex(signatureHex, 128) {
		return errors.New("invalid signature hex encoding")
	}

	signatureBytes, err := hex.DecodeString(signatureHex)
	if err != nil {
		return errors.New("invalid signature hex encoding")
	}
	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return err
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		return err
	}
	if len(xBytes) != 32 || len(yBytes) != 32 {
		return errors.New("invalid P-256 key coordinates")
	}

	publicKey := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(xBytes), Y: new(big.Int).SetBytes(yBytes)}
	if !elliptic.P256().IsOnCurve(publicKey.X, publicKey.Y) {
		return errors.New("public key point not on curve")
	}
	digest := sha256.Sum256(payload)
	if !ecdsa.Verify(publicKey, digest[:], new(big.Int).SetBytes(signatureBytes[:32]), new(big.Int).SetBytes(signatureBytes[32:])) {
		return errors.New("signature verification failed")
	}
	return nil
}

func decodeStoredWebAuthnCredential(raw json.RawMessage) (webAuthnStoredCredential, error) {
	var credential webAuthnStoredCredential
	if err := json.Unmarshal(raw, &credential); err != nil {
		return webAuthnStoredCredential{}, err
	}
	return credential, nil
}

func decodeStoredSoftkeyCredential(raw json.RawMessage) (softkeyStoredCredential, error) {
	var credential softkeyStoredCredential
	if err := json.Unmarshal(raw, &credential); err != nil {
		return softkeyStoredCredential{}, err
	}
	return credential, nil
}

func resolveChannelAdminMode(channel *store.Channel) store.AdminMode {
	if channel.AdminMode == nil || *channel.AdminMode == "" {
		return store.AdminModeWebAuthn
	}
	return *channel.AdminMode
}

func (s *ProtocolService) randomBase64URL(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := s.randomRead(buffer); err != nil {
		return "", internalError(fmt.Errorf("generate random challenge: %w", err))
	}
	return encodeBase64URL(buffer), nil
}

func constantTimeEqualString(left string, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func isLowerHex(value string, exactLen int) bool {
	if value == "" {
		return false
	}
	if exactLen > 0 && len(value) != exactLen {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func unixMilliToTime(value int64) time.Time {
	return time.UnixMilli(value).UTC()
}

func nullableInt64ToAny(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func mustParseExpireAt(intent ManageIntent) *int64 {
	value, _ := intent.ParseExpireAt()
	return value
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
