package config

import (
	"regexp"
	"time"

	"github.com/chatml/chatml/util"
	"github.com/golang/protobuf/proto"

	pb "github.com/chatml/chatml/config/generated"
)

var labelNameRE = regexp.MustCompile("^[a-zA-Z_][a-zA-Z0-9_]*$")

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

// Validate checks an entire parsed Config for the validity of its fields.
func (c Config) Validate() error {

	return nil
}

// stringToDuration converts a string to a duration and dies on invalid format.
func stringToDuration(intervalStr string) time.Duration {
	duration, err := util.StringToDuration(intervalStr)
	if err != nil {
		panic(err)
	}
	return duration
}
