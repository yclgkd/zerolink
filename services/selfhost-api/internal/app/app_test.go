package app

import "testing"

func TestResolveMaxProtocolBodyBytesKeepsInlineFloor(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		fileMaxBytes int64
		want         int64
	}{
		{
			name:         "zero uses inline floor",
			fileMaxBytes: 0,
			want:         minInlineProtocolBodyBytes,
		},
		{
			name:         "smaller file limit keeps text ceiling",
			fileMaxBytes: 1_048_576,
			want:         minInlineProtocolBodyBytes,
		},
		{
			name:         "inline ceiling matches floor",
			fileMaxBytes: 2_097_152,
			want:         minInlineProtocolBodyBytes,
		},
		{
			name:         "larger file limit expands body cap",
			fileMaxBytes: 3_145_728,
			want:         12_582_912,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveMaxProtocolBodyBytes(tt.fileMaxBytes); got != tt.want {
				t.Fatalf("resolveMaxProtocolBodyBytes(%d) = %d, want %d", tt.fileMaxBytes, got, tt.want)
			}
		})
	}
}
