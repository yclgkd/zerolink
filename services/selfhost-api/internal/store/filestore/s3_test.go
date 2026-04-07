package filestore

import "testing"

func TestFileUploadInitiateRequestValidateAcceptsNanoIDUUID(t *testing.T) {
	t.Parallel()

	req := FileUploadInitiateRequest{
		ChannelUUID:          "aaaaaaaaaaaaaaaaaaaaa",
		ChunkCount:           1,
		TotalCiphertextBytes: 32,
	}

	if err := req.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
}

func TestFileUploadInitiateRequestValidateRejectsWrongLengthUUID(t *testing.T) {
	t.Parallel()

	req := FileUploadInitiateRequest{
		ChannelUUID:          "short",
		ChunkCount:           1,
		TotalCiphertextBytes: 32,
	}

	if err := req.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want invalid uuid error")
	}
}
