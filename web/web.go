package web

import (
	"flag"
	"fmt"
	"html/template"
	"io/ioutil"
	"net"
	"net/http"
	"os"
	"time"

	pprof_runtime "runtime/pprof"

	"github.com/golang/glog"
	"github.com/gorilla/mux"

	"github.com/chatml/chatml/util/log"
	"github.com/chatml/chatml/web/api"
	"github.com/chatml/chatml/web/blob"
	"github.com/chatml/chatml/web/stream"
)

var (
	listenAddress  = flag.String("web.listen-address", ":9090", "Address to listen on for the web interface, API, and telemetry.")
	enableQuit     = flag.Bool("web.enable-remote-shutdown", false, "Enable remote service shutdown.")
	useLocalAssets = flag.Bool("web.use-local-assets", false, "Read assets/templates from file instead of binary.")
)

type WebService struct {
	StatusHandler *ChatmlStatusHandler
	ApiService    *api.ApiService
	//StreamService *StreamService
	QuitDelegate func()

	router *mux.Router
}

func NewWebService() (*WebService, error) {

	_, err := stream.NewStreamService()
	if err != nil {
		log.Fatalf("Failed to create Stream Service: %s", err)
	}

	apiService, err := api.NewApiService()
	if err != nil {
		log.Fatalf("Failed to create API Service: %s", err)
	}

	webService := &WebService{
		router:     mux.NewRouter(),
		ApiService: apiService,
		//StreamService: streamService,
	}

	return webService, nil
}

func (ws *WebService) ServeForever() error {

	http.Handle("/favicon.ico", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "", 404)
	}))

	//http.Handle("/", chatml.InstrumentHandler(
	//"/", ws.StatusHandler,
	//))

	//http.Handle("/heap", chatml.InstrumentHandler(
	//"/heap", http.HandlerFunc(dumpHeap),
	//))

	if *enableQuit {
		http.Handle("/-/quit", http.HandlerFunc(ws.quitHandler))
	}

	log.Info("listening on ", *listenAddress)

	return http.ListenAndServe(*listenAddress, nil)
}

func (ws *WebService) quitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.Header().Add("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	fmt.Fprintf(w, "Requesting termination... Goodbye!")

	ws.QuitDelegate()
}

func getTemplateFile(name string) (string, error) {
	if *useLocalAssets {
		file, err := ioutil.ReadFile(fmt.Sprintf("web/templates/%s.html", name))
		if err != nil {
			glog.Errorf("Could not read %s template: %s", name, err)
			return "", err
		}
		return string(file), nil
	}
	file, err := blob.GetFile(blob.TemplateFiles, name+".html")
	if err != nil {
		glog.Errorf("Could not read %s template: %s", name, err)
		return "", err
	}
	return string(file), nil
}

func getTemplate(name string) (t *template.Template, err error) {
	t = template.New("_base")
	t.Funcs(template.FuncMap{
		"since": time.Since,
	})
	file, err := getTemplateFile("_base")
	if err != nil {
		log.Error("Could not read base template: ", err)
		return nil, err
	}
	t.Parse(file)

	file, err = getTemplateFile(name)
	if err != nil {
		log.Error("Could not read base template: ", err)
		return nil, err
	}
	t.Parse(file)
	return
}

func executeTemplate(w http.ResponseWriter, name string, data interface{}) {
	tpl, err := getTemplate(name)
	if err != nil {
		log.Error("Error preparing layout template: ", err)
		return
	}
	err = tpl.Execute(w, data)
	if err != nil {
		log.Error("Error executing template: ", err)
	}
}

func dumpHeap(w http.ResponseWriter, r *http.Request) {
	target := fmt.Sprintf("/tmp/%d.heap", time.Now().Unix())
	f, err := os.Create(target)
	if err != nil {
		log.Error("Could not dump heap: ", err)
	}
	fmt.Fprintf(w, "Writing to %s...", target)
	defer f.Close()
	pprof_runtime.WriteHeapProfile(f)
	fmt.Fprintf(w, "Done")
}

// MustBuildServerURL returns the server URL and panics in case an error occurs.
func MustBuildServerURL() string {
	_, port, err := net.SplitHostPort(*listenAddress)
	if err != nil {
		panic(err)
	}
	hostname, err := os.Hostname()
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("http://%s:%s", hostname, port)
}
