all: generated/config.pb.go

SUFFIXES:

include ../Makefile.INCLUDE

generated/config.pb.go: config.proto
	go get github.com/golang/protobuf/protoc-gen-go
	$(PROTOC) --proto_path=$(PREFIX)/include:. --go_out=generated/ config.proto
