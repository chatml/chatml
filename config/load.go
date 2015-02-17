package config

import (
	"io/ioutil"

	"code.google.com/p/goprotobuf/proto"

	pb "github.com/chatml/server/config/generated"
)

// LoadFromString returns a config parsed from the provided string.
func LoadFromString(configStr string) (Config, error) {
	configProto := pb.ChatmlConfig{}
	if err := proto.UnmarshalText(configStr, &configProto); err != nil {
		return Config{}, err
	}
	if configProto.Global == nil {
		configProto.Global = &pb.GlobalConfig{}
	}
	for _, job := range configProto.Job {
		if job.ScrapeInterval == nil {
			job.ScrapeInterval = proto.String(configProto.Global.GetScrapeInterval())
		}
	}

	config := Config{configProto}
	err := config.Validate()

	return config, err
}

// LoadFromFile returns a config parsed from the file of the provided name.
func LoadFromFile(fileName string) (Config, error) {
	configStr, err := ioutil.ReadFile(fileName)
	if err != nil {
		return Config{}, err
	}

	return LoadFromString(string(configStr))
}
