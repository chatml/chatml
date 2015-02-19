all: generated/config.pb.go

SUFFIXES:

include ../Makefile.INCLUDE

generated/config.pb.go: config.proto
	@echo "$(OK_COLOR)==> Compiling Protocol Buffers into Golang file$(NO_COLOR)"
	$(PROTOC) --proto_path=$(PREFIX)/include:. --go_out=generated/ config.proto
