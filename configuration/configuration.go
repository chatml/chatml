package configuration

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"strconv"
	"time"

	"github.com/BurntSushi/toml"

	"github.com/chatml/server/util/log"
)

type Size int

const (
	ONE_MEGABYTE int64 = 1024 * 1024
	ONE_GIGABYTE       = 1024 * ONE_MEGABYTE
	// Maximum integer representable by a word (32bit or 64bit depending
	// on the architecture)
	MAX_INT = int64(^uint(0) >> 1)
)

func (d *Size) UnmarshalText(text []byte) error {
	str := string(text)
	length := len(str)
	size, err := strconv.ParseInt(string(text[:length-1]), 10, 64)
	if err != nil {
		return err
	}
	switch suffix := text[len(text)-1]; suffix {
	case 'm':
		size *= ONE_MEGABYTE
	case 'g':
		size *= ONE_GIGABYTE
	default:
		return fmt.Errorf("Unknown size suffix %c", suffix)
	}
	if size > MAX_INT {
		return fmt.Errorf("Size %d cannot be represented by an int", size)
	}
	*d = Size(size)
	return nil
}

type duration struct {
	time.Duration
}

func (d *duration) UnmarshalText(text []byte) error {
	if len(text) == 0 {
		return nil
	}
	var err error
	d.Duration, err = time.ParseDuration(string(text))
	return err
}

type ApiConfig struct {
	SslPort     int    `toml:"ssl-port"`
	SslCertPath string `toml:"ssl-cert"`
	Port        int
	ReadTimeout duration `toml:"read-timeout"`
}

type StorageConfig struct {
	Path string `toml:"path"`
}

type LoggingConfig struct {
	File  string `toml:"file"`
	Level string `toml:"level"`
}

type TomlConfiguration struct {
	HttpApi           ApiConfig     `toml:"api"`
	Storage           StorageConfig `toml:"storage"`
	Logging           LoggingConfig `toml:"logging"`
	Hostname          string        `toml:"hostname"`
	BindAddress       string        `toml:"bind-address"`
	ReportingDisabled bool          `toml:"reporting-disabled"`
	PidFile           string        `toml:"pid_file"`
}

type Configuration struct {
	ApiHttpSslPort    int
	ApiHttpCertPath   string
	ApiHttpPort       int
	ApiReadTimeout    time.Duration
	StoragePath       string
	ReportingDisabled bool
	Hostname          string
	LogFile           string
	LogLevel          string
	BindAddress       string
	PidFile           string
	Version           string
}

func LoadConfiguration(fileName string) *Configuration {
	log.Infof("Loading configuration file %s", fileName)
	config, err := parseTomlConfiguration(fileName)
	if err != nil {
		log.Error("Couldn't parse configuration file: " + fileName)
		panic(err)
	}
	return config
}

func parseTomlConfiguration(filename string) (*Configuration, error) {
	body, err := ioutil.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	tomlConfiguration := &TomlConfiguration{}
	_, err = toml.Decode(string(body), tomlConfiguration)
	if err != nil {
		return nil, err
	}

	apiReadTimeout := tomlConfiguration.HttpApi.ReadTimeout.Duration
	if apiReadTimeout == 0 {
		apiReadTimeout = 5 * time.Second
	}

	config := &Configuration{
		ApiHttpPort:       tomlConfiguration.HttpApi.Port,
		ApiHttpCertPath:   tomlConfiguration.HttpApi.SslCertPath,
		ApiHttpSslPort:    tomlConfiguration.HttpApi.SslPort,
		ApiReadTimeout:    apiReadTimeout,
		StoragePath:       tomlConfiguration.Storage.Path,
		LogFile:           tomlConfiguration.Logging.File,
		LogLevel:          tomlConfiguration.Logging.Level,
		Hostname:          tomlConfiguration.Hostname,
		BindAddress:       tomlConfiguration.BindAddress,
		ReportingDisabled: tomlConfiguration.ReportingDisabled,
		PidFile:           tomlConfiguration.PidFile,
	}

	return config, nil
}

func parseJsonConfiguration(fileName string) (*Configuration, error) {
	log.Info("Loading Config from " + fileName)
	config := &Configuration{}

	data, err := ioutil.ReadFile(fileName)
	if err == nil {
		err = json.Unmarshal(data, config)
		if err != nil {
			return nil, err
		}
	} else {
		log.Error("Couldn't load configuration file: " + fileName)
		panic(err)
	}

	return config, nil
}

func (self *Configuration) ApiHttpPortString() string {
	if self.ApiHttpPort <= 0 {
		return ""
	}

	return fmt.Sprintf("%s:%d", self.BindAddress, self.ApiHttpPort)
}

func (self *Configuration) ApiHttpSslPortString() string {
	return fmt.Sprintf("%s:%d", self.BindAddress, self.ApiHttpSslPort)
}

func (self *Configuration) HostnameOrDetect() string {
	if self.Hostname != "" {
		return self.Hostname
	} else {
		n, err := os.Hostname()
		if err == nil {
			return n
		} else {
			return "localhost"
		}
	}
}
