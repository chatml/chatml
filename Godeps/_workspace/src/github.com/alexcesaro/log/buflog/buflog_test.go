package buflog

import (
	"bytes"
	"testing"

	"github.com/alexcesaro/log"
	"github.com/alexcesaro/log/logtest"
)

const testMessage = "Test Message!"

func TestBufferedLogging(t *testing.T) {
	logger, out := createLogger(log.Info, log.Error)

	logger.Debug(logtest.Messages[log.Debug])
	logtest.AssertNotContain(t, out, logtest.Messages[log.Debug])

	logger.Info(logtest.Messages[log.Info])
	logtest.AssertNotContain(t, out, logtest.Messages[log.Info])

	logger.Error(logtest.Messages[log.Error])
	logtest.AssertNotContain(t, out, logtest.Messages[log.Debug])
	logtest.AssertContains(t, out, logtest.Messages[log.Info])
	logtest.AssertContains(t, out, logtest.Messages[log.Error])

	logger.Warning(logtest.Messages[log.Warning])
	logtest.AssertContains(t, out, logtest.Messages[log.Warning])

	logger.Alert(logtest.Messages[log.Alert])
	logtest.AssertContains(t, out, logtest.Messages[log.Alert])

	logtest.AssertLineCount(t, out, 4)
}

func BenchmarkBufferedLogging(b *testing.B) {
	logger, _ := createLogger(log.Info, log.Error)

	for i := 0; i < b.N; i++ {
		logger.Info(testMessage)
	}
	logger.Error(testMessage)
}

func createLogger(threshold log.Level, flushThreshold log.Level) (*Logger, *bytes.Buffer) {
	out := new(bytes.Buffer)

	return New(out, threshold, flushThreshold), out
}
