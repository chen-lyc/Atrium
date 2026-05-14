package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func PrintReport(r *OracleReport, clientCount int) {
	divider := strings.Repeat("=", 62)

	fmt.Println(divider)
	fmt.Println("  Atrium WebSocket Benchmark Report")
	fmt.Println(divider)
	fmt.Println()

	fmt.Println("── Connection ─────────────────────────────────────────────")
	fmt.Printf("  Total clients:       %d\n", clientCount)
	if len(r.ConnectTimes) > 0 {
		cs := connectStats(r.ConnectTimes)
		fmt.Printf("  Connect p50/p90/p99: %s / %s / %s\n",
			durStr(cs.p50), durStr(cs.p90), durStr(cs.p99))
	}
	fmt.Println()

	fmt.Println("── Latency: Client Send → DB Write (Segment 1) ───────────")
	printLatency(&r.Seg1)
	if r.Seg1Expected > 0 {
		neverArrived := r.Seg1Expected - r.Seg1Found
		fmt.Printf("  Self-receives expected: %d\n", r.Seg1Expected)
		if neverArrived > 0 {
			fmt.Printf("  Never arrived (drain-edge): %d (%.1f%%)\n",
				neverArrived, float64(neverArrived)/float64(r.Seg1Expected)*100)
		}
		if r.Seg1DroppedBounds > 0 {
			fmt.Printf("  Dropped (out-of-bounds):   %d (clock-skew / outlier)\n", r.Seg1DroppedBounds)
		}
		fmt.Println()
	}

	fmt.Println("── Latency: DB Write → Client Receive (Segment 2) ────────")
	printLatency(&r.Seg2)

	fmt.Println("── Latency: Client Send → Client Receive (Total) ─────────")
	printLatency(&r.Total)

	fmt.Println("── Integrity ─────────────────────────────────────────────")
	fmt.Printf("  Expected receives:  %d\n", r.ExpectedReceives)
	fmt.Printf("  Actual receives:    %d\n", r.ActualReceives)
	lostPct := float64(r.Lost) / float64(r.ExpectedReceives) * 100
	dupPct := float64(r.Duplicated) / float64(r.ExpectedReceives) * 100
	fmt.Printf("  Lost:               %d (%.2f%%)\n", r.Lost, lostPct)
	fmt.Printf("  Duplicated:         %d (%.2f%%)\n", r.Duplicated, dupPct)
	fmt.Println()
	fmt.Println(divider)
}

type connStats struct {
	p50 time.Duration
	p90 time.Duration
	p99 time.Duration
}

func connectStats(times []time.Duration) connStats {
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	n := len(times)
	return connStats{
		p50: times[n*50/100],
		p90: times[n*90/100],
		p99: times[n*99/100],
	}
}

func printLatency(s *LatencyStats) {
	if s.Samples == 0 {
		fmt.Println("  (no data)")
		return
	}
	fmt.Printf("  Samples:            %d\n", s.Samples)
	fmt.Printf("  p50/p90/p99:        %s / %s / %s\n",
		durStr(s.P50), durStr(s.P90), durStr(s.P99))
	fmt.Println()
}

func durStr(d time.Duration) string {
	if d < time.Millisecond {
		return fmt.Sprintf("%dµs", d.Microseconds())
	}
	if d < time.Second {
		return fmt.Sprintf("%.2fms", float64(d.Microseconds())/1000)
	}
	return fmt.Sprintf("%.3fs", d.Seconds())
}
