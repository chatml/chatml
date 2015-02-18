package golog

import (
	"bytes"
	"runtime"
	"testing"
	"time"

	"github.com/alexcesaro/log"
	"github.com/alexcesaro/log/logtest"
)

const testMessage = "Test Message!"

func TestOutput(t *testing.T) {
	logger, out := createTestLogger(log.Debug)

	logger.Emergency(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 EMERGENCY "+testMessage)

	logger.Alert(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 ALERT "+testMessage)

	logger.Critical(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 CRITICAL "+testMessage)

	logger.Error(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 ERROR "+testMessage)

	logger.Warning(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 WARNING "+testMessage)

	logger.Notice(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 NOTICE "+testMessage)

	logger.Info(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 INFO "+testMessage)

	logger.Debug(testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 DEBUG "+testMessage)

	logger.Log(log.Info, testMessage)
	logtest.AssertContains(t, out, "1985-06-17 18:30:59.012 INFO "+testMessage)

	logtest.AssertLineCount(t, out, 9)
}

func TestFormatedLogging(t *testing.T) {
	logger, out := createTestLogger(log.Info)

	logger.Infof("%d %s", 1, "test")
	logtest.AssertContains(t, out, "1 test")

	logtest.AssertLineCount(t, out, 1)
}

func TestNoneThreshold(t *testing.T) {
	testLogThreshold(t, log.None, map[log.Level]bool{
		log.Emergency: false,
		log.Alert:     false,
		log.Critical:  false,
		log.Error:     false,
		log.Warning:   false,
		log.Notice:    false,
		log.Info:      false,
		log.Debug:     false,
	})
}

func TestErrorThreshold(t *testing.T) {
	testLogThreshold(t, log.Error, map[log.Level]bool{
		log.Emergency: true,
		log.Alert:     true,
		log.Critical:  true,
		log.Error:     true,
		log.Warning:   false,
		log.Notice:    false,
		log.Info:      false,
		log.Debug:     false,
	})
}

func TestInfoThreshold(t *testing.T) {
	testLogThreshold(t, log.Info, map[log.Level]bool{
		log.Emergency: true,
		log.Alert:     true,
		log.Critical:  true,
		log.Error:     true,
		log.Warning:   true,
		log.Notice:    true,
		log.Info:      true,
		log.Debug:     false,
	})
}

func TestDebugThreshold(t *testing.T) {
	testLogThreshold(t, log.Debug, map[log.Level]bool{
		log.Emergency: true,
		log.Alert:     true,
		log.Critical:  true,
		log.Error:     true,
		log.Warning:   true,
		log.Notice:    true,
		log.Info:      true,
		log.Debug:     true,
	})
}

func TestConditionalLogging(t *testing.T) {
	logger, _ := createTestLogger(log.Error)

	if logger.LogInfo() {
		t.Error("LogInfo() should return false")
	}

	if !logger.LogError() {
		t.Error("LogError() should return true")
	}

	if !logger.LogEmergency() {
		t.Error("LogEmergency() should return true")
	}
}

func TestConcurrentLogging(t *testing.T) {
	logger, out := createTestLogger(log.Info)
	done := make(chan bool)

	logger.Info("Test")
	go func() {
		logger.Info("Test")
		done <- true
	}()
	logger.Info("Test")
	<-done

	logtest.AssertLineCount(t, out, 3)
}

func BenchmarkLogging(b *testing.B) {
	logger, _ := createTestLogger(log.Info)

	for i := 0; i < b.N; i++ {
		logger.Info(testMessage)
	}
}

func BenchmarkConcurrentLogging(b *testing.B) {
	logger, _ := createTestLogger(log.Info)

	oldMaxProcs := runtime.GOMAXPROCS(runtime.NumCPU())
	defer runtime.GOMAXPROCS(oldMaxProcs)

	finished := make(chan bool, b.N)

	for i := 0; i < b.N; i++ {
		go func() {
			logger.Info(testMessage)
			finished <- true
		}()
	}

	for i := 0; i < b.N; i++ {
		<-finished
	}
}

func testLogThreshold(t *testing.T, level log.Level, isLoggedList map[log.Level]bool) {
	logger, out := createTestLogger(level)

	logger.Emergency(logtest.Messages[log.Emergency])
	logger.Alert(logtest.Messages[log.Alert])
	logger.Critical(logtest.Messages[log.Critical])
	logger.Error(logtest.Messages[log.Error])
	logger.Warning(logtest.Messages[log.Warning])
	logger.Notice(logtest.Messages[log.Notice])
	logger.Info(logtest.Messages[log.Info])
	logger.Debug(logtest.Messages[log.Debug])

	for level, isLogged := range isLoggedList {
		if isLogged {
			logtest.AssertContains(t, out, logtest.Messages[level])
		} else {
			logtest.AssertNotContain(t, out, logtest.Messages[level])
		}
	}
}

func createTestLogger(level log.Level) (*Logger, *bytes.Buffer) {
	now = func() time.Time {
		return time.Date(1985, 06, 17, 18, 30, 59, 12345678, time.Local)
	}
	out := new(bytes.Buffer)

	return New(out, level), out
}
