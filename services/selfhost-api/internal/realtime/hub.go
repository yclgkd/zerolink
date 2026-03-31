package realtime

import "context"

type Publisher interface {
	PublishChannelState(ctx context.Context, channelID string) error
	Close() error
}

type NopHub struct{}

func (NopHub) PublishChannelState(context.Context, string) error {
	return nil
}

func (NopHub) Close() error {
	return nil
}
