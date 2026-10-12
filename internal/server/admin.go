package server

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bingops-com/games/internal/store"
)

type adminAction struct {
	Reason string `json:"reason"`
	Status string `json:"status"`
}

func (s *Server) adminRoutes(api *http.ServeMux) {
	api.HandleFunc("POST /api/admin/login", s.adminLogin)
	api.HandleFunc("GET /api/admin/callback", s.adminCallback)
	api.HandleFunc("POST /api/admin/logout", s.handle(s.adminLogout))
	api.HandleFunc("GET /api/admin/me", s.adminHandle(false, func(_ context.Context, _ *http.Request, session adminSession) (any, error) {
		return map[string]any{"username": session.username, "csrf": session.csrf, "expiresAt": session.expires.UnixMilli()}, nil
	}))
	api.HandleFunc("GET /api/admin/overview", s.adminHandle(false, func(ctx context.Context, _ *http.Request, _ adminSession) (any, error) {
		counts, err := s.store.AdminCounts(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{"counts": counts, "rooms": s.hub.AdminRooms()}, nil
	}))
	api.HandleFunc("GET /api/admin/users", s.adminHandle(false, func(ctx context.Context, r *http.Request, _ adminSession) (any, error) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if utf8.RuneCountInString(q) > 16 {
			return nil, bad("Recherche trop longue")
		}
		before, beforeID := int64(math.MaxInt64), ""
		if raw := r.URL.Query().Get("before"); raw != "" {
			parts := strings.Split(raw, ".")
			if len(parts) != 2 || len(parts[1]) != 32 {
				return nil, bad("Page invalide")
			}
			var err error
			before, err = strconv.ParseInt(parts[0], 10, 64)
			if err != nil || before < 1 {
				return nil, bad("Page invalide")
			}
			beforeID = parts[1]
		}
		rows, err := s.store.AdminUsers(ctx, q, before, beforeID)
		next := ""
		if len(rows) == 50 {
			last := rows[len(rows)-1]
			next = strconv.FormatInt(last.Since, 10) + "." + last.ID
		}
		return map[string]any{"users": rows, "next": next}, err
	}))
	api.HandleFunc("GET /api/admin/reports", s.adminHandle(false, func(ctx context.Context, r *http.Request, _ adminSession) (any, error) {
		status := r.URL.Query().Get("status")
		if status != "open" && status != "resolved" && status != "dismissed" && status != "" {
			return nil, bad("Statut inconnu")
		}
		before, err := adminBefore(r)
		if err != nil {
			return nil, err
		}
		rows, err := s.store.AdminReports(ctx, status, before)
		return map[string]any{"reports": rows}, err
	}))
	api.HandleFunc("GET /api/admin/audit", s.adminHandle(false, func(ctx context.Context, r *http.Request, _ adminSession) (any, error) {
		before, err := adminBefore(r)
		if err != nil {
			return nil, err
		}
		rows, err := s.store.AdminAudit(ctx, before)
		return map[string]any{"entries": rows}, err
	}))
	api.HandleFunc("POST /api/admin/reports/{id}", s.adminHandle(true, func(ctx context.Context, r *http.Request, session adminSession) (any, error) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			return nil, bad("Signalement invalide")
		}
		body, err := readAdminAction(r)
		if err != nil {
			return nil, err
		}
		if body.Status != "resolved" && body.Status != "dismissed" {
			return nil, bad("Statut inconnu")
		}
		err = s.store.AdminResolveReport(ctx, id, body.Status, session.subject, session.username, body.Reason)
		if errors.Is(err, store.ErrNotFound) {
			return nil, httpError{409, "Signalement absent ou déjà traité"}
		}
		return map[string]bool{"ok": true}, err
	}))
	api.HandleFunc("POST /api/admin/users/{id}/revoke", s.adminHandle(true, func(ctx context.Context, r *http.Request, session adminSession) (any, error) {
		id := r.PathValue("id")
		if len(id) != 32 {
			return nil, bad("Joueur invalide")
		}
		body, err := readAdminAction(r)
		if err != nil {
			return nil, err
		}
		if err = s.store.AdminRevokeSessions(ctx, id, session.subject, session.username, body.Reason); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return nil, httpError{404, "Joueur introuvable"}
			}
			return nil, err
		}
		s.sockets.revoke("", id, "")
		return map[string]bool{"ok": true}, nil
	}))
}
func (s *Server) adminHandle(mutation bool, action func(context.Context, *http.Request, adminSession) (any, error)) http.HandlerFunc {
	return s.handle(func(w http.ResponseWriter, r *http.Request) (any, error) {
		session, err := s.requireAdmin(w, r, mutation)
		if err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		return action(ctx, r, session)
	})
}
func adminBefore(r *http.Request) (int64, error) {
	if raw := r.URL.Query().Get("before"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			return 0, bad("Page invalide")
		}
		return n, nil
	}
	return math.MaxInt64, nil
}
func readAdminAction(r *http.Request) (adminAction, error) {
	var body adminAction
	if err := readJSON(r, &body); err != nil {
		return body, err
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if n := utf8.RuneCountInString(body.Reason); n < 5 || n > 500 {
		return body, bad("Un motif de 5 à 500 caractères est requis")
	}
	return body, nil
}
