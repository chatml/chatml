include ../Makefile.INCLUDE

all: blob/files.go

SUFFIXES:

blob/files.go: $(shell find templates/ static/ -type f)
    # Note that embed-static.sh excludes map files and the
    # non-minified bootstrap files.
    ../utility/embed-static.sh static templates | $(GOFMT) > $@

clean:
    -rm -f blob/files.go

.PHONY: clean
