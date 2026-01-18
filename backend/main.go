package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/server"
	"github.com/chatml/chatml-backend/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	s := store.New()
	router := server.NewRouter(s)

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
