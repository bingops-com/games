package games

import "testing"

func TestSketchCoordinatesStayOnCanvas(t *testing.T) {
	for _, p := range []string{"zzzz", "rs00", "00rs"} {
		if validPoints(p) {
			t.Fatalf("out-of-bounds coordinates accepted: %s", p)
		}
	}
	if !validPoints("0000rrrr") {
		t.Fatal("valid edge coordinates refused")
	}
}
