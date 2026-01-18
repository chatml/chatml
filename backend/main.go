package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chatml/chatml-backend/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9876"
	}

	router := server.NewRouter()

	log.Printf("ChatML backend starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
