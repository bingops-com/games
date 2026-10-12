package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

type asset struct {
	body  []byte
	gz    []byte // nil when compressing does not help
	ctype string
	etag  string
}

// The interface is small: it is read once, compressed once, and served from
// memory.
type static struct {
	files map[string]*asset
}

var compressible = map[string]bool{".html": true, ".js": true, ".css": true, ".svg": true, ".json": true, ".txt": true, ".webmanifest": true}

func newStatic(root fs.FS) (*static, error) {
	s := &static{files: map[string]*asset{}}
	err := fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		ext := path.Ext(p)
		a := &asset{body: body, ctype: mime.TypeByExtension(ext)}
		switch ext {
		case ".webmanifest":
			a.ctype = "application/manifest+json"
		}
		if a.ctype == "" {
			a.ctype = "application/octet-stream"
		}
		sum := sha256.Sum256(body)
		a.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
		if compressible[ext] {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(body)
			zw.Close()
			if buf.Len() < len(body)*9/10 {
				a.gz = buf.Bytes()
			}
		}
		s.files["/"+p] = a
		return nil
	})
	return s, err
}

func (s *static) find(p string) *asset {
	p = path.Clean("/" + p)
	for _, candidate := range []string{p, p + ".html", path.Join(p, "index.html")} {
		if a := s.files[candidate]; a != nil {
			return a
		}
	}
	return nil
}

func (s *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Méthode non autorisée", http.StatusMethodNotAllowed)
		return
	}
	status := http.StatusOK
	a := s.find(r.URL.Path)
	if a == nil {
		status = http.StatusNotFound
		if a = s.files["/404.html"]; a == nil {
			http.Error(w, "Introuvable", status)
			return
		}
	}
	h := w.Header()
	h.Set("Content-Type", a.ctype)
	h.Set("ETag", a.etag)
	h.Add("Vary", "Accept-Encoding")
	// Next.js names these files after their content: they never change.
	if h.Get("Cache-Control") == "no-store" {
		// The administrator gate controls the caching of its pages.
	} else if strings.HasPrefix(r.URL.Path, "/_next/static/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if status == http.StatusOK && h.Get("Cache-Control") != "no-store" && r.Header.Get("If-None-Match") == a.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := a.body
	if a.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = a.gz
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}
