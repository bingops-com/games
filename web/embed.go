// Package web embeds the built interface (the static export of the Next.js
// application) into the binary. Run "make web" before building.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:out
var files embed.FS

// Files is the interface, rooted at its index.html.
func Files() fs.FS {
	sub, err := fs.Sub(files, "out")
	if err != nil {
		panic(err)
	}
	return sub
}
