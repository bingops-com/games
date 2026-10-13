package server

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

func TestBrowserCloseLeavesButTransportDisconnectCanReconnect(t *testing.T) {
	for _, code := range []websocket.StatusCode{websocket.StatusGoingAway, 4000, websocket.StatusNormalClosure} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			ts, _ := start(t)
			owner, guest := player(t, ts, "CloseHost"), player(t, ts, "CloseGuest")
			roomCode := owner.want(200, "POST", "/api/tables", `{"game":"poudriere"}`)["code"].(string)
			next, send := owner.seat(roomCode, "")
			until(t, next, func(s map[string]any) bool { return s["t"] == "state" })
			other := auditSocket(t, guest, roomCode)
			until(t, next, func(s map[string]any) bool { return s["t"] == "state" && len(s["members"].([]any)) == 2 })
			send(`{"t":"start"}`)
			until(t, next, func(s map[string]any) bool { return s["phase"] == "playing" })
			if err := other.Close(code, "page closed"); err != nil {
				t.Fatal(err)
			}
			if code == websocket.StatusNormalClosure {
				until(t, next, func(s map[string]any) bool {
					if s["t"] != "state" || s["phase"] != "playing" {
						return false
					}
					members := s["members"].([]any)
					return len(members) == 2 && members[1].(map[string]any)["on"] == false
				})
				back, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/ws?code="+roomCode, &websocket.DialOptions{HTTPClient: guest.http})
				if err != nil {
					t.Fatal(err)
				}
				defer back.CloseNow()
				until(t, next, func(s map[string]any) bool {
					if s["t"] != "state" || s["phase"] != "playing" {
						return false
					}
					members := s["members"].([]any)
					return len(members) == 2 && members[1].(map[string]any)["on"] == true && members[1].(map[string]any)["seat"] == float64(1)
				})
			} else {
				result := until(t, next, func(s map[string]any) bool { return s["t"] == "state" && len(s["members"].([]any)) == 1 })
				if result["phase"] != "over" || result["void"] != true {
					t.Fatal("browser departure did not forfeit the current game")
				}
			}
		})
	}
}
