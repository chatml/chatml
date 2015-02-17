OK_COLOR=\033[32;01m
NO_COLOR=\033[0m
ULIMIT=9000

TEST_ARTIFACTS = chatmld chatmld.race search_index
BUILDTAGS=debug

include Makefile.INCLUDE

release: all
	BUILDTAGS=release

all: binary test

$(GOCC): $(BUILD_PATH)/cache/$(GOPKG) $(FULL_GOPATH)
	@echo "$(OK_COLOR)==> Extracting $(GOPKG) into build directory $(NO_COLOR)"
	tar -C $(BUILD_PATH)/root -xzf $<
	touch $@

$(BUILD_PATH)/cache/$(GOPKG):
	@echo "$(OK_COLOR)==> Downloading GoLang compiler package $(NO_COLOR)"
	mkdir -p $(BUILD_PATH)/cache
	$(CURL) -L '$(GOURL)/$(GOPKG)' -o '$@'

assets:
	@echo "$(OK_COLOR)==> Compiling Assets$(NO_COLOR)"
	$(GO) get -u github.com/jteeuwen/go-bindata/...
	$(GOBINDATA) -nomemcopy -pkg=assets -tags=$(BUILDTAGS) \
		-debug=$(if $(findstring debug,$(BUILDTAGS)),true,false) \
		-o=assets/assets_$(BUILDTAGS).go \
		web/static/...

format:
	@echo "$(OK_COLOR)==> Formatting the code $(NO_COLOR)"
	find . -iname '*.go' | egrep -v "^\./\.build|./generated|\./Godeps|\.(l|y)\.go" | xargs -n1 $(GOFMT) -w -s=true
	find . -iname '*.go' | egrep -v "^\./\.build|./generated|\./Godeps|\.(l|y)\.go" | xargs -n1 $(GOIMPORT) -w

binary: build

build: assets config dependencies tools web
	$(GO) build -tags '$(BUILDTAGS)' -o chatmld $(BUILDFLAGS) .

docker: build
	@echo "$(OK_COLOR)==> Building docker image$(NO_COLOR)"
	docker build -t chatml-server:$(REV) .

tarball: $(ARCHIVE)

$(ARCHIVE): build
	@echo "$(OK_COLOR)==> Creating Archive$(NO_COLOR)"
	tar -czf $(ARCHIVE) chatml-server

clean:
	@echo "$(OK_COLOR)==> Cleaning up build environment$(NO_COLOR)"
	# $(MAKE) -C $(BUILD_PATH) clean
	rm -rf $(TEST_ARTIFACTS)
	rm -rf assets
	-rm $(ARCHIVE)
	-find . -type f -name '*~' -exec rm '{}' ';'
	-find . -type f -name '*#' -exec rm '{}' ';'
	-find . -type f -name '.#*' -exec rm '{}' ';'

config: dependencies
	# $(MAKE) -C config

dependencies: $(GOCC) $(FULL_GOPATH)
	@echo "$(OK_COLOR)==> Downloading dependencies$(NO_COLOR)"
	$(GO) get github.com/tools/godep
	$(GODEP) restore
	$(GO) get -d

documentation: search_index
	godoc -http=:6060 -index -index_files='search_index'

race_condition_binary: build
	$(GO) build -race -o chatmld.race $(BUILDFLAGS) .

race_condition_run: race_condition_binary
	./chatmld.race $(ARGUMENTS)

run: binary
	./chatmld -alsologtostderr -stderrthreshold=0 $(ARGUMENTS)

search_index:
	godoc -index -write_index -index_files='search_index'

server: config dependencies
	$(MAKE) -C server

tools: dependencies
	# $(MAKE) -C tools

web: config dependencies
	# $(MAKE) -C web

# $(FULL_GOPATH) is responsible for ensuring that the builder has not done anything
# stupid like working on Chatml outside of ${GOPATH}.
$(FULL_GOPATH):
	-[ -d "$(FULL_GOPATH)" ] || { mkdir -vp $(FULL_GOPATH_BASE) ; ln -s "$(PWD)" "$(FULL_GOPATH)" ; }
	[ -d "$(FULL_GOPATH)" ]

cover:
	go test -cover -coverprofile cover.out
	go tool cover -html=cover.out

vet:
	@echo "$(OK_COLOR)==> Running go vet $(NO_COLOR)"
	$(GO) vet .

ctags:
	@ctags -R --exclude=.build --exclude=test

tag:
	git tag $(VERSION)
	git push --tags

contributors:
	echo "Contributors to Chatml, both large and small:\n" > CONTRIBUTORS
	git log --raw | grep "^Author: " | sort | uniq | cut -d ' ' -f2- | sed 's/^/- /' | cut -d '<' -f1 >> CONTRIBUTORS

install-dev-tools:
	@echo "$(OK_COLOR)==> Installing development tools $(NO_COLOR)"
	go get github.com/onsi/ginkgo/ginkgo
	go get github.com/onsi/gomega
	go get golang.org/x/tools/cmd/vet
	go get github.com/jteeuwen/go-bindata/...

.PHONY: all install format clean config dependencies test doc vet cover tag ctags assets release contributors
