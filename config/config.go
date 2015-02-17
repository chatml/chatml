package config

import (
	"fmt"
	"time"

	"code.google.com/p/goprotobuf/proto"
)

// Config encapsulates the configuration of a Chatml instance. It wraps the
// raw configuration protocol buffer to be able to add custom methods to it.
type Config struct {
	// The protobuf containing the actual configuration values.
	pb.ChatmlConfig
}

// String returns an ASCII serialization of the loaded configuration protobuf.
func (c Config) String() string {
	return proto.MarshalTextString(&c.ChatmlConfig)
}

// validateLabels validates whether label names have the correct format.
func (c Config) validateLabels(labels *pb.LabelPairs) error {
	if labels == nil {
		return nil
	}
	for _, label := range labels.Label {
		if !labelNameRE.MatchString(label.GetName()) {
			return fmt.Errorf("invalid label name '%s'", label.GetName())
		}
	}
	return nil
}

// Validate checks an entire parsed Config for the validity of its fields.
func (c Config) Validate() error {

	return nil
}

// GlobalLabels returns the global labels as a LabelSet.
func (c Config) GlobalLabels() clientmodel.LabelSet {
	labels := clientmodel.LabelSet{}
	if c.Global.Labels != nil {
		for _, label := range c.Global.Labels.Label {
			labels[clientmodel.LabelName(label.GetName())] = clientmodel.LabelValue(label.GetValue())
		}
	}
	return labels
}

// stringToDuration converts a string to a duration and dies on invalid format.
func stringToDuration(intervalStr string) time.Duration {
	duration, err := utility.StringToDuration(intervalStr)
	if err != nil {
		panic(err)
	}
	return duration
}
