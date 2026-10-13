package games

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSketchFillHistoryAndLimits(t *testing.T) {
	var s sketch
	apply := func(kind, raw string) error {
		t.Helper()
		ok, err := s.act(kind, json.RawMessage(raw))
		if !ok {
			t.Fatalf("%s was not a drawing action", kind)
		}
		return err
	}
	if err := apply("begin", `{"c":0,"w":1,"p":"0a0b"}`); err != nil {
		t.Fatal(err)
	}
	if err := apply("fill", `{"c":3,"p":"dwdw"}`); err != nil {
		t.Fatal(err)
	}
	if len(s.strokes) != 2 || !s.strokes[1].F || s.points != 2 {
		t.Fatalf("fill history: %+v", s)
	}
	view := s.view()
	view[1].C = 8
	if s.strokes[1].C != 3 {
		t.Fatal("view mutated the drawing")
	}
	if err := apply("more", `{"p":"0a0b"}`); err == nil {
		t.Fatal("a fill was extended as a stroke")
	}
	if err := apply("undo", "null"); err != nil {
		t.Fatal(err)
	}
	if len(s.strokes) != 1 || s.strokes[0].F || s.points != 1 {
		t.Fatalf("undo fill: %+v", s)
	}
	for _, raw := range []string{`{"c":3,"p":"dwdwdwdw"}`, `{"c":-1,"p":"dwdw"}`, `{"c":12,"p":"dwdw"}`, `{"c":3,"p":"zzzz"}`, `{"c":3,"p":"DWdw"}`, `{"c":3}`} {
		if err := apply("fill", raw); err == nil {
			t.Errorf("accepted invalid fill: %s", raw)
		}
	}
	if len(s.strokes) != 1 || s.points != 1 {
		t.Fatal("rejected fill changed history")
	}
	for range sketchFills {
		if err := apply("fill", `{"c":3,"p":"dwdw"}`); err != nil {
			t.Fatal(err)
		}
	}
	if err := apply("fill", `{"c":3,"p":"dwdw"}`); err == nil {
		t.Fatal("fill replay work is unbounded")
	}
	apply("undo", "null")
	if err := apply("fill", `{"c":8,"p":"dwdw"}`); err != nil {
		t.Fatal("undo did not free a fill slot:", err)
	}
	apply("clear", "null")
	if len(s.strokes) != 0 || s.points != 0 {
		t.Fatal("clear kept drawing operations")
	}
	if err := apply("fill", `{"c":3,"p":"rrrr"}`); err != nil {
		t.Fatal("edge point rejected:", err)
	}
	for _, cap := range []string{"points", "operations"} {
		limited := sketch{points: sketchPoints}
		if cap == "operations" {
			limited = sketch{strokes: make([]stroke, sketchStrokes)}
		}
		if _, err := limited.act("fill", json.RawMessage(`{"c":3,"p":"dwdw"}`)); err == nil {
			t.Errorf("fill bypassed %s limit", cap)
		}
	}
}

func TestSkribFillAndRoundEnd(t *testing.T) {
	for _, finish := range []string{"guessed", "timeout"} {
		t.Run(finish, func(t *testing.T) {
			g := newSkrib(2, rng(9), t0).(*skrib)
			drawer, guesser := g.drawer, (g.drawer+1)%2
			if err := act(g, drawer, t0, `{"t":"fill","c":3,"p":"dwdw"}`); err != nil {
				t.Fatal(err)
			}
			if len(g.sk.strokes) != 0 {
				t.Fatal("drawing started before word choice")
			}
			act(g, drawer, t0, `{"t":"choose","i":0}`)
			if err := act(g, guesser, t0, `{"t":"fill","c":3,"p":"dwdw"}`); err == nil {
				t.Fatal("a guesser filled the drawing")
			}
			if err := act(g, -1, t0, `{"t":"fill","c":3,"p":"dwdw"}`); err == nil {
				t.Fatal("a spectator filled the drawing")
			}
			if err := act(g, drawer, t0, `{"t":"fill","c":3,"p":"dwdw"}`); err != nil {
				t.Fatal(err)
			}
			if v := g.View(guesser, t0).(skView); v.Word != "" || len(v.Strokes) != 1 || !v.Strokes[0].F {
				t.Fatal("fill not shared, or secret word leaked")
			}
			now := t0.Add(time.Second)
			if finish == "guessed" {
				if err := act(g, guesser, now, `{"t":"guess","text":%q}`, g.word); err != nil {
					t.Fatal(err)
				}
			} else {
				now = g.deadline
				g.Tick(now)
			}
			v := g.View(-1, now).(skView)
			if v.Phase != "reveal" || v.Word != g.word || v.Deadline != ms(now.Add(skReveal)) {
				t.Fatalf("round end: %+v", v)
			}
			act(g, drawer, now, `{"t":"fill","c":8,"p":"dwdw"}`)
			if len(g.sk.strokes) != 1 {
				t.Fatal("drawing changed during round result")
			}
			if g.Tick(now.Add(skReveal-time.Millisecond)) || g.phase != "reveal" {
				t.Fatal("round result disappeared early")
			}
			g.Tick(now.Add(skReveal))
			if g.phase != "choose" || len(g.sk.strokes) != 0 || g.word != "" || g.drawer == drawer {
				t.Fatal("next round did not reset its drawing")
			}
		})
	}
}
