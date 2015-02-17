package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"runtime/pprof"
	"strconv"
	"sync"
	"time"

	"bitbucket.org/radsense/chatml-server/src/chatml/server"

	"github.com/chatml/server/configuration"
	"github.com/chatml/server/util"
	"github.com/chatml/server/util/log"
	"github.com/chatml/server/util/signal"
	"github.com/chatml/server/web"
)

const (
	Version string = "0.0.1"
	GitSHA  string = "alpha"
)

var (
	configFile   = flag.String("config.file", "chatml.conf", "Chatml configuration file name")
	printVersion = flag.Bool("version", false, "Print version information.")
	fileName     = flag.String("config", "config.toml", "Config file written in TOML format")
	wantsVersion = flag.Bool("version", false, "Get version number")
	maxprocs     = flag.Int("gomaxprocs", defaultMaxprocs, "GOMAXPROCS")
	debug        = flag.Bool("debug", false, "Dump goroutine stack traces upon receiving interrupt signal")
)

type chatml struct {
	webService *web.WebService

	closeOnce sync.Once
}

func NewChatml() *chatml {
	conf, err = config.LoadFromFile(*configFile)
	if err != nil {
		log.Fatalf("Error loading configuration from %s: %v", *configFile, err)
	}

	flags := map[string]string{}
	flag.VisitAll(func(f *flag.Flag) {
		flags[f.Name] = f.Value.String()
	})
	chatmlStatus := &web.ChatmlStatusHandler{
		BuildInfo: BuildInfo,
		Config:    conf.String(),
		Flags:     flags,
		Birth:     time.Now(),
	}

	webService := &web.WebService{
		StatusHandler: chatmlStatus,
	}

	c := &chatml{
		webService: webService,
	}
	webService.QuitDelegate = c.Close
	return c
}

func (c *chatml) Serve() {

	signal.Trap(c.Close())

	go func() {
		err := c.webService.ServeForever()
		if err != nil {
			log.Fatal(err)
		}
	}()

	log.Info("See you next time!")
}

// Close cleanly shuts down the Chatml server.
func (c *chatml) Close() {
	c.closeOnce.Do(c.close)
}

func (c *chatml) close() {
	log.Info("Shutdown has been requested; subsytems are closing:")

	// Note: Before closing the remaining subsystems (storage, ...), we have
	// to wait until p.unwrittenSamples is actually drained. Therefore,
	// remaining shut-downs happen in Serve().
}

func setMaxProcs() {

}

func main() {

	var err error
	var defaultMaxprocs int
	if defaultMaxprocs, err = strconv.Atoi(os.Getenv("GOMAXPROCS")); err != nil {
		defaultMaxprocs = runtime.NumCPU()
	}

	var maxprocs int
	var debug bool
	ver := fmt.Sprintf("Chatml Server v%s (git: %s)", Version, GitSHA)

	flag.IntVar(&maxprocs, "gomaxprocs", defaultMaxprocs, "GOMAXPROCS")

	// Parse all the command flags
	flag.Parse()

	// Set appropriate GOMAXPROCS
	runtime.GOMAXPROCS(maxprocs)
	log.Infof("GOMAXPROCS is set to %d", maxprocs)
	if maxprocs < runtime.NumCPU() {
		log.Infof("GOMAXPROCS (%d) is less than number of CPUs (%d), this may reduce performance. You can change it via environment variable GOMAXPROCS or by passing CLI parameter -gomaxprocs", maxprocs, runtime.NumCPU())
	}

	// If they just want the version, print and exit
	if wantsVersion != nil && *wantsVersion {
		fmt.Println(ver)
		return
	}

	// Dump goroutine stacktraces upon receiving interrupt signal
	if debug {
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt)
		go func() {
			for _ = range c {
				pprof.Lookup("goroutine").WriteTo(os.Stderr, 1)
			}
		}()
	}

	// Load the configuration and set the Version
	config := configuration.LoadConfiguration(*fileName)
	config.Version = ver

	// Try to create the pid file, exits with error if we can't'
	if err := util.CreatePidFile(config.PidFile); err != nil {
		panic(err)
	}

	server, err := server.NewServer(config, Version)
	if err != nil {
		time.Sleep(time.Second) // sleep for the log to flush
		panic(err)
	}

	err = server.ListenAndServe()
	if err != nil {
		log.Errorf("ListenAndServe failed: %s", err)
	}

	for {
	}

	log.Info("Terminating Chatml Server...Goodbye!")

}
