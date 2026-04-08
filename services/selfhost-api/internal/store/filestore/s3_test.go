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

func TestParseS3EndpointAcceptsHostWithoutScheme(t *testing.T) {
	t.Parallel()

	endpoint, useSSL, err := parseS3Endpoint("garage:3900", false)
	if err != nil {
		t.Fatalf("parseS3Endpoint() error = %v, want nil", err)
	}
	if endpoint != "garage:3900" {
		t.Fatalf("endpoint = %q, want garage:3900", endpoint)
	}
	if useSSL {
		t.Fatal("useSSL = true, want false")
	}
}

func TestParseS3EndpointAcceptsHTTPSURL(t *testing.T) {
	t.Parallel()

	endpoint, useSSL, err := parseS3Endpoint("https://files.example.com", false)
	if err != nil {
		t.Fatalf("parseS3Endpoint() error = %v, want nil", err)
	}
	if endpoint != "files.example.com" {
		t.Fatalf("endpoint = %q, want files.example.com", endpoint)
	}
	if !useSSL {
		t.Fatal("useSSL = false, want true")
	}
}

func TestParseS3EndpointRejectsPath(t *testing.T) {
	t.Parallel()

	if _, _, err := parseS3Endpoint("https://files.example.com/storage", true); err == nil {
		t.Fatal("parseS3Endpoint() error = nil, want invalid path error")
	}
}
