package webauthn

import (
	"context"
	"errors"
)

var ErrNotImplemented = errors.New("webauthn verification not implemented")

type AssertionInput struct {
	ChannelID string
	Payload   []byte
}

type AttestationInput struct {
	ChannelID               string
	AttestationObjectB64u   string
	ClientDataJSONB64u      string
	ExpectedRPID            string
	ExpectedOrigin          string
	ExpectedChallenge       []byte
	RequireUserVerification bool
}

type AttestationResult struct {
	Verified     bool
	Format       string
	CredentialID string
	PublicKey    string
	SignCount    int64
	AAGUID       string
	Warning      string
}

type Verifier interface {
	VerifyAssertion(ctx context.Context, input AssertionInput) error
	VerifyAttestation(ctx context.Context, input AttestationInput) (AttestationResult, error)
}

type NoopVerifier struct{}

func (NoopVerifier) VerifyAssertion(context.Context, AssertionInput) error {
	return ErrNotImplemented
}

func (NoopVerifier) VerifyAttestation(context.Context, AttestationInput) (AttestationResult, error) {
	return AttestationResult{}, ErrNotImplemented
}
