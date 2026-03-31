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
	ChannelID string
	Payload   []byte
}

type Verifier interface {
	VerifyAssertion(ctx context.Context, input AssertionInput) error
	VerifyAttestation(ctx context.Context, input AttestationInput) error
}

type NoopVerifier struct{}

func (NoopVerifier) VerifyAssertion(context.Context, AssertionInput) error {
	return ErrNotImplemented
}

func (NoopVerifier) VerifyAttestation(context.Context, AttestationInput) error {
	return ErrNotImplemented
}
