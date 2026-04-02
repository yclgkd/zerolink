package filestore

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const (
	defaultUploadURLTTL   = 15 * time.Minute
	defaultDownloadURLTTL = 5 * time.Minute
	chunkObjectPrefix     = "files"
)

type FileStorageBackend string

const (
	FileStorageBackendR2    FileStorageBackend = "r2"
	FileStorageBackendMinIO FileStorageBackend = "minio"
)

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
	Region    string
}

type FileUploadInitiateRequest struct {
	ChannelUUID          string `json:"channelUuid"`
	ChunkCount           int    `json:"chunkCount"`
	TotalCiphertextBytes int64  `json:"totalCiphertextBytes"`
}

type FileUploadChunkTarget struct {
	Index     int    `json:"index"`
	UploadURL string `json:"uploadUrl"`
}

type FileUploadInitiateResponse struct {
	OK       bool                    `json:"ok"`
	UploadID string                  `json:"uploadId"`
	Chunks   []FileUploadChunkTarget `json:"chunks"`
}

type FileUploadCompleteChunk struct {
	Index           int    `json:"index"`
	ETag            string `json:"etag"`
	CiphertextBytes int64  `json:"ciphertextBytes"`
	CiphertextHash  string `json:"ciphertextHash"`
}

type MultipartFileRefChunk struct {
	Index           int    `json:"index"`
	StorageKey      string `json:"storageKey"`
	CiphertextBytes int64  `json:"ciphertextBytes"`
	CiphertextHash  string `json:"ciphertextHash"`
}

type MultipartFileRef struct {
	StorageBackend       FileStorageBackend      `json:"storageBackend"`
	ChunkSizeBytes       int64                   `json:"chunkSizeBytes"`
	ChunkCount           int                     `json:"chunkCount"`
	TotalPlaintextBytes  int64                   `json:"totalPlaintextBytes"`
	TotalCiphertextBytes int64                   `json:"totalCiphertextBytes"`
	BaseIV               string                  `json:"baseIv"`
	EncContentKey        string                  `json:"encContentKey"`
	Chunks               []MultipartFileRefChunk `json:"chunks"`
}

type FileUploadCompleteRequest struct {
	UploadID             string                    `json:"uploadId"`
	BaseIV               string                    `json:"baseIv"`
	EncContentKey        string                    `json:"encContentKey"`
	ChunkSizeBytes       int64                     `json:"chunkSizeBytes"`
	TotalPlaintextBytes  int64                     `json:"totalPlaintextBytes"`
	TotalCiphertextBytes int64                     `json:"totalCiphertextBytes"`
	Chunks               []FileUploadCompleteChunk `json:"chunks"`
}

type FileUploadCompleteResponse struct {
	OK      bool             `json:"ok"`
	FileRef MultipartFileRef `json:"fileRef"`
}

type FileDownloadChunkTarget struct {
	Index       int    `json:"index"`
	DownloadURL string `json:"downloadUrl"`
}

type FileFetchResponse struct {
	OK     bool                      `json:"ok"`
	Chunks []FileDownloadChunkTarget `json:"chunks"`
}

type Store struct {
	client *minio.Client
	bucket string
	region string
}

func NewMinIO(ctx context.Context, cfg Config) (*Store, error) {
	if cfg.Endpoint == "" {
		return nil, errors.New("minio endpoint is required")
	}
	if cfg.AccessKey == "" {
		return nil, errors.New("minio access key is required")
	}
	if cfg.SecretKey == "" {
		return nil, errors.New("minio secret key is required")
	}
	if cfg.Bucket == "" {
		return nil, errors.New("minio bucket is required")
	}

	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}

	store := &Store{
		client: client,
		bucket: cfg.Bucket,
		region: cfg.Region,
	}

	if err := store.ensureBucket(ctx); err != nil {
		return nil, err
	}

	return store, nil
}

func NewUploadID() (string, error) {
	return randomBase64URL(16)
}

func (s *Store) Initiate(ctx context.Context, uploadID string, chunkCount int) error {
	if err := validateUploadID(uploadID); err != nil {
		return err
	}
	if chunkCount <= 0 {
		return errors.New("chunkCount must be positive")
	}
	return s.ensureBucket(ctx)
}

func (s *Store) PutChunk(ctx context.Context, uploadID string, index int, body io.Reader, size int64) (string, error) {
	if err := validateUploadID(uploadID); err != nil {
		return "", err
	}
	if index < 0 {
		return "", errors.New("chunk index must be non-negative")
	}
	if size < 0 {
		return "", errors.New("chunk size must be non-negative")
	}
	if err := s.ensureBucket(ctx); err != nil {
		return "", err
	}

	objectKey := uploadObjectKey(uploadID, index)
	info, err := s.client.PutObject(ctx, s.bucket, objectKey, body, size, minio.PutObjectOptions{})
	if err != nil {
		return "", fmt.Errorf("put chunk %d: %w", index, err)
	}
	return normalizeETag(info.ETag), nil
}

func (s *Store) PresignedUpload(ctx context.Context, uploadID string, index int, ttl time.Duration) (string, error) {
	if err := validateUploadID(uploadID); err != nil {
		return "", err
	}
	if index < 0 {
		return "", errors.New("chunk index must be non-negative")
	}
	if ttl <= 0 {
		ttl = defaultUploadURLTTL
	}
	if err := s.ensureBucket(ctx); err != nil {
		return "", err
	}

	objectKey := uploadObjectKey(uploadID, index)
	u, err := s.client.PresignedPutObject(ctx, s.bucket, objectKey, ttl)
	if err != nil {
		return "", fmt.Errorf("presign upload chunk %d: %w", index, err)
	}
	return u.String(), nil
}

func (s *Store) CompleteUpload(ctx context.Context, req FileUploadCompleteRequest) (MultipartFileRef, error) {
	if err := req.Validate(); err != nil {
		return MultipartFileRef{}, err
	}
	if err := s.ensureBucket(ctx); err != nil {
		return MultipartFileRef{}, err
	}

	uploadID := req.UploadID
	chunks := make([]MultipartFileRefChunk, len(req.Chunks))
	var totalCiphertext int64
	for i, chunk := range req.Chunks {
		if chunk.Index != i {
			return MultipartFileRef{}, fmt.Errorf("chunks must be ordered from 0 to %d", len(req.Chunks)-1)
		}

		objectKey := uploadObjectKey(uploadID, chunk.Index)
		stat, err := s.client.StatObject(ctx, s.bucket, objectKey, minio.StatObjectOptions{})
		if err != nil {
			return MultipartFileRef{}, fmt.Errorf("stat chunk %d: %w", chunk.Index, err)
		}

		etag := normalizeETag(stat.ETag)
		if etag != normalizeETag(chunk.ETag) {
			return MultipartFileRef{}, fmt.Errorf("chunk %d etag mismatch", chunk.Index)
		}
		if stat.Size != chunk.CiphertextBytes {
			return MultipartFileRef{}, fmt.Errorf("chunk %d ciphertext bytes mismatch", chunk.Index)
		}

		totalCiphertext += stat.Size
		chunks[i] = MultipartFileRefChunk{
			Index:           chunk.Index,
			StorageKey:      objectKey,
			CiphertextBytes: stat.Size,
			CiphertextHash:  chunk.CiphertextHash,
		}
	}

	if totalCiphertext != req.TotalCiphertextBytes {
		return MultipartFileRef{}, fmt.Errorf("total ciphertext bytes mismatch: got %d want %d", totalCiphertext, req.TotalCiphertextBytes)
	}

	ref := MultipartFileRef{
		StorageBackend:       FileStorageBackendMinIO,
		ChunkSizeBytes:       req.ChunkSizeBytes,
		ChunkCount:           len(chunks),
		TotalPlaintextBytes:  req.TotalPlaintextBytes,
		TotalCiphertextBytes: totalCiphertext,
		BaseIV:               req.BaseIV,
		EncContentKey:        req.EncContentKey,
		Chunks:               chunks,
	}
	if err := ref.Validate(); err != nil {
		return MultipartFileRef{}, err
	}
	return ref, nil
}

func (s *Store) PresignedDownload(ctx context.Context, fileRef MultipartFileRef, index int, ttl time.Duration) (string, error) {
	if err := fileRef.Validate(); err != nil {
		return "", err
	}
	if index < 0 {
		return "", errors.New("chunk index must be non-negative")
	}
	if ttl <= 0 {
		ttl = defaultDownloadURLTTL
	}
	if err := s.ensureBucket(ctx); err != nil {
		return "", err
	}

	chunk, ok := fileRef.chunkByIndex(index)
	if !ok {
		return "", fmt.Errorf("chunk %d not found", index)
	}

	u, err := s.client.PresignedGetObject(ctx, s.bucket, chunk.StorageKey, ttl, nil)
	if err != nil {
		return "", fmt.Errorf("presign download chunk %d: %w", index, err)
	}
	return u.String(), nil
}

func (s *Store) DeleteUpload(ctx context.Context, fileRef MultipartFileRef) error {
	if err := fileRef.Validate(); err != nil {
		return err
	}
	if err := s.ensureBucket(ctx); err != nil {
		return err
	}

	for _, chunk := range fileRef.Chunks {
		if err := s.client.RemoveObject(ctx, s.bucket, chunk.StorageKey, minio.RemoveObjectOptions{}); err != nil {
			return fmt.Errorf("delete chunk %d: %w", chunk.Index, err)
		}
	}

	return nil
}

func (ref MultipartFileRef) Validate() error {
	if ref.StorageBackend != FileStorageBackendMinIO && ref.StorageBackend != FileStorageBackendR2 {
		return fmt.Errorf("unsupported storage backend %q", ref.StorageBackend)
	}
	if ref.ChunkSizeBytes <= 0 {
		return errors.New("chunkSizeBytes must be positive")
	}
	if ref.ChunkCount <= 0 {
		return errors.New("chunkCount must be positive")
	}
	if ref.TotalPlaintextBytes <= 0 {
		return errors.New("totalPlaintextBytes must be positive")
	}
	if ref.TotalCiphertextBytes <= 0 {
		return errors.New("totalCiphertextBytes must be positive")
	}
	if !isBase64URL(ref.BaseIV) {
		return errors.New("baseIv must be base64url")
	}
	if !isBase64URL(ref.EncContentKey) {
		return errors.New("encContentKey must be base64url")
	}
	if len(ref.Chunks) == 0 {
		return errors.New("chunks must not be empty")
	}
	if len(ref.Chunks) != ref.ChunkCount {
		return errors.New("chunks length must equal chunkCount")
	}

	var totalCiphertext int64
	for i, chunk := range ref.Chunks {
		if chunk.Index != i {
			return fmt.Errorf("chunk %d index mismatch", i)
		}
		if chunk.StorageKey == "" {
			return fmt.Errorf("chunk %d storageKey is required", i)
		}
		if chunk.CiphertextBytes <= 0 {
			return fmt.Errorf("chunk %d ciphertextBytes must be positive", i)
		}
		if !isHexString(chunk.CiphertextHash, 64) {
			return fmt.Errorf("chunk %d ciphertextHash must be lowercase hex", i)
		}
		totalCiphertext += chunk.CiphertextBytes
	}

	if totalCiphertext != ref.TotalCiphertextBytes {
		return fmt.Errorf("totalCiphertextBytes must match chunk sum")
	}
	return nil
}

func (req FileUploadInitiateRequest) Validate() error {
	if req.ChannelUUID == "" {
		return errors.New("channelUuid is required")
	}
	if !isBase64URL(req.ChannelUUID) {
		return errors.New("channelUuid must be base64url")
	}
	if req.ChunkCount <= 0 {
		return errors.New("chunkCount must be positive")
	}
	if req.TotalCiphertextBytes <= 0 {
		return errors.New("totalCiphertextBytes must be positive")
	}
	return nil
}

func (req FileUploadCompleteRequest) Validate() error {
	if !isBase64URL(req.UploadID) {
		return errors.New("uploadId must be base64url")
	}
	if !isBase64URL(req.BaseIV) {
		return errors.New("baseIv must be base64url")
	}
	if !isBase64URL(req.EncContentKey) {
		return errors.New("encContentKey must be base64url")
	}
	if req.ChunkSizeBytes <= 0 {
		return errors.New("chunkSizeBytes must be positive")
	}
	if req.TotalPlaintextBytes <= 0 {
		return errors.New("totalPlaintextBytes must be positive")
	}
	if req.TotalCiphertextBytes <= 0 {
		return errors.New("totalCiphertextBytes must be positive")
	}
	if len(req.Chunks) == 0 {
		return errors.New("chunks must not be empty")
	}
	for i, chunk := range req.Chunks {
		if chunk.Index < 0 {
			return fmt.Errorf("chunk %d index must be non-negative", i)
		}
		if chunk.ETag == "" {
			return fmt.Errorf("chunk %d etag is required", i)
		}
		if chunk.CiphertextBytes <= 0 {
			return fmt.Errorf("chunk %d ciphertextBytes must be positive", i)
		}
		if !isHexString(chunk.CiphertextHash, 64) {
			return fmt.Errorf("chunk %d ciphertextHash must be lowercase hex", i)
		}
	}
	return nil
}

func (ref MultipartFileRef) chunkByIndex(index int) (MultipartFileRefChunk, bool) {
	for _, chunk := range ref.Chunks {
		if chunk.Index == index {
			return chunk, true
		}
	}
	return MultipartFileRefChunk{}, false
}

func (s *Store) ensureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check minio bucket %s: %w", s.bucket, err)
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{Region: s.region}); err != nil {
		return fmt.Errorf("create minio bucket %s: %w", s.bucket, err)
	}
	return nil
}

func uploadObjectKey(uploadID string, index int) string {
	return fmt.Sprintf("%s/%s/%04d.bin", chunkObjectPrefix, uploadID, index)
}

func validateUploadID(uploadID string) error {
	if !isBase64URL(uploadID) {
		return errors.New("uploadId must be base64url")
	}
	return nil
}

func normalizeETag(etag string) string {
	return strings.Trim(etag, `"`)
}

func randomBase64URL(size int) (string, error) {
	if size <= 0 {
		return "", errors.New("size must be positive")
	}
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func isBase64URL(value string) bool {
	if value == "" {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil
}

func isHexString(value string, length int) bool {
	if len(value) != length {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}
