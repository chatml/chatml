package stdlog

import (
	"bytes"
	"io"
	"testing"

	"github.com/alexcesaro/log"
	"github.com/alexcesaro/log/logtest"
)

var (
	testStream      = new(bytes.Buffer)
	testlogToStderr = false
)

func TestGetFromFlags(t *testing.T) {
	logger := getLogger("info", "none")

	logger.Debug(logtest.Messages[log.Debug])
	logtest.AssertNotContain(t, testStream, logtest.Messages[log.Debug])

	logger.Info(logtest.Messages[log.Info])
	logtest.AssertContains(t, testStream, logtest.Messages[log.Info])
	logtest.AssertLineCount(t, testStream, 1)

	logger = getLogger("info", "error")

	logger.Info(logtest.Messages[log.Info])
	logtest.AssertNotContain(t, testStream, logtest.Messages[log.Info])

	logger.Error(logtest.Messages[log.Error])
	logtest.AssertContains(t, testStream, logtest.Messages[log.Error])
	logtest.AssertLineCount(t, testStream, 2)
}

func getLogger(threshold, flushThreshold string) log.Logger {
	getStream = func(logToStderr bool) io.Writer {
		return testStream
	}
	thresholdName = &threshold
	logToStderr = &testlogToStderr
	flushThresholdName = &flushThreshold

	testStream.Reset()
	logger = nil

	return GetFromFlags()
}
